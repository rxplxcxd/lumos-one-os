"""Save-game discovery, deterministic packing (stable SHA-256 for sync comparisons) and safe,
atomic restore for Lumos Cloud."""
from __future__ import annotations

import asyncio
import glob
import gzip
import hashlib
import io
import json
import os
import shutil
import tarfile
import time
from pathlib import Path

from .module import Module
from .server import RpcError

H = Path.home()
KNOWN = [
    ("retroarch", "RetroArch (Saves & States)", ["~/.var/app/org.libretro.RetroArch/config/retroarch/saves", "~/.var/app/org.libretro.RetroArch/config/retroarch/states", "~/.config/retroarch/saves", "~/.config/retroarch/states"]),
    ("ppsspp", "PPSSPP", ["~/.var/app/org.ppsspp.PPSSPP/config/ppsspp/PSP/SAVEDATA", "~/.config/ppsspp/PSP/SAVEDATA"]),
    ("dolphin", "Dolphin (GC/Wii)", ["~/.var/app/org.DolphinEmu.dolphin-emu/data/dolphin-emu/GC", "~/.var/app/org.DolphinEmu.dolphin-emu/data/dolphin-emu/Wii/title"]),
    ("pcsx2", "PCSX2 Memory Cards", ["~/.var/app/net.pcsx2.PCSX2/config/PCSX2/memcards", "~/.config/PCSX2/memcards"]),
    ("melonds", "melonDS", ["~/.var/app/net.kuribo64.melonDS/config/melonDS/saves"]),
    ("prism", "Prism Launcher (Minecraft)", ["~/.var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher/instances"]),
]


def _iter_files(paths: list[Path]):
    for base in paths:
        for root, dirs, files in os.walk(base):
            dirs[:] = sorted(d for d in dirs if not d.startswith(".lumos-bak"))
            for f in sorted(files):
                p = Path(root) / f
                if p.is_file() and not p.is_symlink():
                    yield base, p


def manifest_sig(paths: list[Path]) -> str:
    h = hashlib.sha256()
    for base, p in _iter_files(paths):
        st = p.stat()
        h.update(f"{base.name}/{p.relative_to(base)}\0{st.st_size}\0{int(st.st_mtime)}\n".encode())
    return h.hexdigest()


def deterministic_tar(paths: list[Path]) -> bytes:
    """tar.gz whose bytes only depend on file names, contents and mtimes (sorted, no owners, gzip mtime=0)."""
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.PAX_FORMAT) as tar:
        for idx, base in enumerate(paths):
            tar.addfile(_dir_info(f"{idx}-{base.name}"))
        for base, p in _iter_files(paths):
            idx = paths.index(base)
            ti = tarfile.TarInfo(f"{idx}-{base.name}/{p.relative_to(base).as_posix()}")
            st = p.stat()
            ti.size, ti.mtime, ti.mode = st.st_size, int(st.st_mtime), 0o644
            ti.uid = ti.gid = 0
            ti.uname = ti.gname = ""
            with p.open("rb") as f:
                tar.addfile(ti, f)
    gz = io.BytesIO()
    with gzip.GzipFile(fileobj=gz, mode="wb", mtime=0, compresslevel=6) as g:
        g.write(raw.getvalue())
    return gz.getvalue()


def _dir_info(name):
    ti = tarfile.TarInfo(name)
    ti.type, ti.mode, ti.mtime = tarfile.DIRTYPE, 0o755, 0
    return ti


def safe_extract(archive: Path, targets: list[Path]):
    """Extract into temp dirs next to each target and swap atomically; refuse unsafe members."""
    with tarfile.open(archive, "r:gz") as tar:
        members = tar.getmembers()
        for m in members:
            if m.issym() or m.islnk() or m.isdev() or os.path.isabs(m.name) or ".." in Path(m.name).parts:
                raise ValueError(f"Unsicherer Archiveintrag: {m.name}")
        staging = {}
        for idx, target in enumerate(targets):
            prefix = f"{idx}-{target.name}"
            tmp = target.parent / f".lumos-restore-{target.name}-{int(time.time())}"
            tmp.mkdir(parents=True, exist_ok=True)
            for m in members:
                if m.name == prefix or not m.name.startswith(prefix + "/"):
                    continue
                rel = m.name[len(prefix) + 1:]
                dest = tmp / rel
                if m.isdir():
                    dest.mkdir(parents=True, exist_ok=True)
                elif m.isfile():
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with tar.extractfile(m) as src, open(dest, "wb") as out:
                        shutil.copyfileobj(src, out)
                    os.utime(dest, (m.mtime, m.mtime))
            staging[target] = tmp
    for target, tmp in staging.items():
        bak = target.parent / f".lumos-bak-{target.name}"
        if bak.exists():
            shutil.rmtree(bak)
        if target.exists():
            os.replace(target, bak)
        os.replace(tmp, target)


class SavesModule(Module):
    name = "saves"

    def __init__(self, ctx):
        super().__init__(ctx)
        self.cache_dir = self.cfg.cache_dir / "saves"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.hash_cache_file = self.cache_dir / "hashes.json"
        try:
            self.hash_cache = json.loads(self.hash_cache_file.read_text())
        except (OSError, ValueError):
            self.hash_cache = {}

    def methods(self):
        return {"saves.list": self.list, "saves.pack": self.pack, "saves.restore": self.restore, "saves.manifest": self.manifest}

    async def manifest(self, p):
        """File list (path, size, mtime, sha256) for the cloud conflict diff viewer."""
        if self.cfg.simulate:
            return self.ctx["sim"].save_manifest(p.get("id"))
        sets = self.discover()
        if p.get("id") not in sets:
            raise RpcError("Spielstand nicht gefunden", "ENOENT")

        def work():
            paths = sets[p["id"]]["paths"]
            out = []
            for base, f in _iter_files(paths):
                st = f.stat()
                h = hashlib.sha256(f.read_bytes()).hexdigest() if st.st_size < 64 * 1024 * 1024 else None
                out.append({"path": f"{base.name}/{f.relative_to(base).as_posix()}", "size": st.st_size, "mtime": int(st.st_mtime * 1000), "sha256": h})
            return out[:5000]

        return await asyncio.get_running_loop().run_in_executor(None, work)

    def discover(self) -> dict[str, dict]:
        sets = {}
        for sid, title, cands in KNOWN:
            paths = [Path(os.path.expanduser(c)) for c in cands if os.path.isdir(os.path.expanduser(c))]
            if paths:
                sets[sid] = {"id": sid, "title": title, "paths": paths}
        lib = self.ctx["library"]
        root = lib.steam_root()
        if root:
            names = {str(g["appid"]): g["name"] for g in lib.steam_games()}
            for remote in glob.glob(str(root / "userdata" / "*" / "*" / "remote")):
                appid = Path(remote).parent.name
                if appid in names:
                    sets[f"steam-{appid}"] = {"id": f"steam-{appid}", "title": names[appid], "paths": [Path(remote)]}
        for extra in self.cfg.extra_save_paths:
            p = Path(os.path.expanduser(extra))
            if p.is_dir():
                sets[f"custom-{p.name}"] = {"id": f"custom-{p.name}", "title": p.name, "paths": [p]}
        return sets

    def _hash(self, s) -> tuple[str, bytes | None]:
        sig = manifest_sig(s["paths"])
        cached = self.hash_cache.get(s["id"])
        if cached and cached["sig"] == sig:
            return cached["sha256"], None
        data = deterministic_tar(s["paths"])
        sha = hashlib.sha256(data).hexdigest()
        self.hash_cache[s["id"]] = {"sig": sig, "sha256": sha}
        self.hash_cache_file.write_text(json.dumps(self.hash_cache))
        return sha, data

    async def list(self, _p=None):
        if self.cfg.simulate:
            return self.ctx["sim"].saves
        loop = asyncio.get_running_loop()

        def work():
            out = []
            for s in self.discover().values():
                files = list(_iter_files(s["paths"]))
                size = sum(p.stat().st_size for _, p in files)
                mtime = max((p.stat().st_mtime for _, p in files), default=0)
                sha, _ = self._hash(s)
                out.append({"id": s["id"], "title": s["title"], "path": str(s["paths"][0]), "size": size, "mtime": int(mtime * 1000), "hash": sha, "files": len(files)})
            return sorted(out, key=lambda x: -x["mtime"])

        return await loop.run_in_executor(None, work)

    async def pack(self, p):
        sid = p.get("id")
        sets = self.discover()
        if sid not in sets:
            raise RpcError("Spielstand nicht gefunden", "ENOENT")
        loop = asyncio.get_running_loop()

        def work():
            sha, data = self._hash(sets[sid])
            if data is None:
                data = deterministic_tar(sets[sid]["paths"])
            out = self.cfg.cache_dir / "saves" / f"{sid}.tar.gz"
            out.write_bytes(data)
            return {"id": sid, "archive": str(out), "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}

        return await loop.run_in_executor(None, work)

    async def restore(self, p):
        sid, archive = p.get("id"), Path(p.get("archive", ""))
        if not str(archive.resolve()).startswith(str(self.cfg.cache_dir.resolve()) + os.sep):
            raise RpcError("Archiv außerhalb des Caches", "EPERM")
        sets = self.discover()
        if sid not in sets:
            raise RpcError("Ziel für Spielstand unbekannt (Spiel installiert?)", "ENOENT")
        await asyncio.get_running_loop().run_in_executor(None, safe_extract, archive, sets[sid]["paths"])
        self.hash_cache.pop(sid, None)
        archive.unlink(missing_ok=True)
        return {"ok": True}
