"""System updates (OTA / USB / PC app) on top of updater/lumos_update, plus storage cleanup and
the pairing-protected sync endpoint used by the "Lumos Sync & Update" PC client."""
from __future__ import annotations

import asyncio
import glob
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
from pathlib import Path

from .module import Module
from .server import RpcError
from .util import priv, run, which

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "updater"))
from lumos_update.installer import Installer, UpdateError  # noqa: E402
from lumos_update.ota import download, find_update  # noqa: E402
from lumos_update.package import read_manifest  # noqa: E402

try:
    from websockets.asyncio.server import serve
except ImportError:  # pragma: no cover
    serve = None


def _size(p: Path) -> int:
    if p.is_file():
        return p.stat().st_size
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())


class UpdateModule(Module):
    name = "update"
    SYNC_PORT = 7421

    def __init__(self, ctx):
        super().__init__(ctx)
        root = self.cfg.update_root
        if self.cfg.simulate or not os.access(root if root.exists() else root.parent, os.W_OK):
            root = self.cfg.data_dir / "system"
        self.inst = Installer(root, self.cfg.update_pubkey, allow_unsigned=self.cfg.simulate)
        self.available = None
        self.staged = None
        self.busy = asyncio.Lock()
        self.pair_code = None
        self.pair_until = 0.0
        self.tokens_file = self.cfg.data_dir / "sync_tokens.json"
        self.uploads: dict[str, dict] = {}
        self._sync_server = None

    def current_version(self):
        from . import __version__

        return self.inst.current() or __version__

    def methods(self):
        return {
            "update.status": self.status,
            "update.check": self.check,
            "update.download": self.download,
            "update.apply": self.apply,
            "update.rollback": self.rollback,
            "update.cleanup": self.cleanup,
            "update.usb_scan": self.usb_scan,
            "update.pair_start": self.pair_start,
        }

    def _progress(self, stage, pct):
        self.emit("update.progress", {"stage": stage, "percent": round(pct, 1)})

    async def status(self, _p=None):
        st = self.inst.status()
        return {"current": self.current_version(), "previous": st["previous"], "releases": st["releases"], "available": self.available, "staged": self.staged, "root": str(self.inst.root)}

    async def check(self, p):
        loop = asyncio.get_running_loop()
        if self.cfg.simulate:
            await asyncio.sleep(1)
            self.available = {"version": "1.1.0", "channel": p.get("channel", "stable"), "size": 184_000_000, "notes": "• Neue Hintergründe\n• Schnelleres Face ID\n• Joy-Con-Hot-Plug-Fixes", "url": None}
            return self.available
        self.available = await loop.run_in_executor(None, find_update, self.cfg.update_url, self.current_version(), p.get("channel", "stable"))
        return self.available

    async def download(self, _p=None):
        if not self.available:
            raise RpcError("Kein Update verfügbar", "ENOENT")
        async with self.busy:
            loop = asyncio.get_running_loop()
            cb = lambda s, pct: loop.call_soon_threadsafe(self._progress, s, pct)  # noqa: E731
            if self.cfg.simulate:
                for i in range(0, 101, 5):
                    self._progress("download", i)
                    await asyncio.sleep(0.1)
                self._progress("verify", 100)
                self.staged = self.available
                return {"ok": True}
            dest = self.inst.cache / f"lumos-update-{self.available['version']}.zip"
            await loop.run_in_executor(None, download, self.available["url"], dest, cb, self.available.get("size"))
            self._progress("verify", 0)
            version = await loop.run_in_executor(None, self.inst.stage, dest, cb)
            self._progress("verify", 100)
            dest.unlink(missing_ok=True)
            self.staged = {**self.available, "version": version}
            return {"ok": True, "version": version}

    async def apply(self, p):
        async with self.busy:
            loop = asyncio.get_running_loop()
            cb = lambda s, pct: loop.call_soon_threadsafe(self._progress, s, pct)  # noqa: E731
            try:
                if p.get("archive"):
                    archive = Path(p["archive"]).resolve()
                    if not archive.name.startswith("lumos-update-") or archive.suffix != ".zip" or not archive.exists():
                        raise RpcError("Ungültiges Updatepaket", "EINVAL")
                    version = await loop.run_in_executor(None, self.inst.stage, archive, cb)
                elif self.staged:
                    version = self.staged["version"]
                else:
                    raise RpcError("Kein Update vorbereitet", "ENOENT")
                self._progress("apply", 60)
                if not self.cfg.simulate or (self.inst.releases / version).exists():
                    await loop.run_in_executor(None, self.inst.activate, version)
            except UpdateError as e:
                raise RpcError(str(e), "EVERIFY") from e
            self.staged = self.available = None
            self._progress("cleanup", 90)
            await loop.run_in_executor(None, self.inst.cleanup, 2)
            self._progress("done", 100)
            return {"ok": True, "version": version, "reboot_required": True}

    async def rollback(self, _p):
        try:
            v = await asyncio.get_running_loop().run_in_executor(None, self.inst.rollback)
        except UpdateError as e:
            raise RpcError(str(e), "ENOENT") from e
        return {"ok": True, "version": v}

    async def cleanup(self, _p):
        loop = asyncio.get_running_loop()
        res = await loop.run_in_executor(None, self.inst.cleanup, 2)
        freed, removed = res["freed_bytes"], res["removed"]
        # Lumos caches: stale Flathub responses (>7 d), packed save archives, old downloads
        now = time.time()
        for pattern, max_age in ((self.cfg.cache_dir / "flathub" / "*.json", 7 * 86400), (self.cfg.cache_dir / "saves" / "*.tar.gz", 0), (self.cfg.cache_dir / "downloads" / "*", 0)):
            for f in glob.glob(str(pattern)):
                fp = Path(f)
                if fp.is_file() and now - fp.stat().st_mtime > max_age:
                    freed += fp.stat().st_size
                    fp.unlink(missing_ok=True)
                    removed.append(str(fp.relative_to(self.cfg.cache_dir.parent)))
        if not self.cfg.simulate:
            if which("flatpak"):
                before = _size(Path.home() / ".local/share/flatpak") if (Path.home() / ".local/share/flatpak").exists() else 0
                await run(["flatpak", "uninstall", "--user", "--unused", "-y", "--noninteractive"], timeout=600, check=False)
                after = _size(Path.home() / ".local/share/flatpak") if before else 0
                if before > after:
                    freed += before - after
                    removed.append("flatpak: ungenutzte Runtimes")
            try:
                out = await priv(self.cfg, "pacman-cache-clean", timeout=300)
                removed.append(f"pacman: {out.strip()[:80]}")
            except Exception as e:  # noqa: BLE001
                self.log.debug("paccache: %s", e)
        return {"freed_bytes": freed, "removed": removed}

    async def usb_scan(self, _p=None):
        found = []
        pats = [f"/run/media/{self.cfg.user}/*/lumos-update-*.zip", f"/run/media/{self.cfg.user}/*/*/lumos-update-*.zip", "/media/*/lumos-update-*.zip", str(self.inst.cache / "uploads" / "lumos-update-*.zip")]
        for pat in pats:
            for f in glob.glob(pat):
                try:
                    m, sig = read_manifest(Path(f))
                    found.append({"path": f, "name": os.path.basename(f), "version": m.get("version"), "size": os.path.getsize(f), "signed": bool(sig)})
                except Exception:  # noqa: BLE001
                    continue
        return found

    # ----------------------------------------------------------------- PC sync endpoint
    def _tokens(self) -> dict:
        try:
            return json.loads(self.tokens_file.read_text())
        except (OSError, ValueError):
            return {}

    async def pair_start(self, _p=None):
        self.pair_code = f"{secrets.randbelow(1_000_000):06d}"
        self.pair_until = time.time() + 180
        await self._ensure_sync_server()
        return {"code": self.pair_code, "expires_in": 180, "port": self.SYNC_PORT}

    async def start(self):
        if self._tokens():
            await self._ensure_sync_server()

    async def _ensure_sync_server(self):
        if self._sync_server or serve is None:
            return
        self._sync_server = await serve(self._sync_handler, "0.0.0.0", self.SYNC_PORT, max_size=8 * 1024 * 1024)
        self.log.info("PC sync endpoint on :%d", self.SYNC_PORT)

    async def _sync_handler(self, ws):
        authed = False
        upload = None
        async for raw in ws:
            if isinstance(raw, bytes):
                if not authed or not upload:
                    break
                upload["f"].write(raw)
                upload["h"].update(raw)
                upload["done"] += len(raw)
                continue
            msg = json.loads(raw)
            mid, m, p = msg.get("id"), msg.get("method"), msg.get("params") or {}
            try:
                if m == "sync.pair":
                    if not self.pair_code or time.time() > self.pair_until or not hmac.compare_digest(str(p.get("code", "")), self.pair_code):
                        raise RpcError("Kopplungscode falsch oder abgelaufen", "EAUTH")
                    token = secrets.token_urlsafe(32)
                    toks = self._tokens()
                    toks[hashlib.sha256(token.encode()).hexdigest()] = {"name": str(p.get("name", "PC"))[:40], "t": int(time.time())}
                    self.tokens_file.write_text(json.dumps(toks))
                    self.pair_code = None
                    self.emit("update.paired", {"name": p.get("name", "PC")})
                    result = {"token": token}
                elif m == "sync.hello":
                    if hashlib.sha256(str(p.get("token", "")).encode()).hexdigest() not in self._tokens():
                        raise RpcError("Nicht gekoppelt", "EAUTH")
                    authed = True
                    result = {"device": os.uname().nodename, "version": self.current_version()}
                elif not authed:
                    raise RpcError("Nicht authentifiziert", "EAUTH")
                elif m == "sync.upload_begin":
                    name = os.path.basename(str(p.get("name", "")))
                    if not name.startswith("lumos-update-") or not name.endswith(".zip"):
                        raise RpcError("Nur lumos-update-*.zip", "EINVAL")
                    d = self.inst.cache / "uploads"
                    d.mkdir(parents=True, exist_ok=True)
                    path = d / name
                    upload = {"path": path, "f": open(path.with_suffix(".part"), "wb"), "h": hashlib.sha256(), "done": 0, "size": int(p.get("size", 0)), "sha256": p.get("sha256")}
                    result = {"ok": True}
                elif m == "sync.upload_finish":
                    upload["f"].close()
                    if upload["sha256"] and upload["h"].hexdigest() != upload["sha256"]:
                        os.unlink(upload["path"].with_suffix(".part"))
                        raise RpcError("Übertragung beschädigt (SHA-256)", "EVERIFY")
                    os.replace(upload["path"].with_suffix(".part"), upload["path"])
                    self.emit("update.uploaded", {"path": str(upload["path"]), "size": upload["done"]})
                    result = {"ok": True, "path": str(upload["path"])}
                    upload = None
                elif m == "sync.status":
                    result = await self.status()
                else:
                    raise RpcError("Unbekannte Methode", "ENOMETHOD")
                await ws.send(json.dumps({"id": mid, "result": result}))
            except RpcError as e:
                await ws.send(json.dumps({"id": mid, "error": {"code": e.code, "message": str(e)}}))
        if upload:
            upload["f"].close()

    async def stop(self):
        if self._sync_server:
            self._sync_server.close()
        await super().stop()
