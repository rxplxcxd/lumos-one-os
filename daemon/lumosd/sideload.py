"""Sideloading AppImages, Flatpak bundles/refs and native executables, plus restricted file browsing."""
from __future__ import annotations

import asyncio
import glob
import hashlib
import os
import re
import shutil
import stat
from pathlib import Path

from .module import Module
from .server import RpcError

ELF = b"\x7fELF"


def roots(user: str) -> list[dict]:
    home = str(Path.home())
    out = [{"path": home, "label": "Home"}]
    for pattern in (f"/run/media/{user}/*", "/media/*", "/mnt/*"):
        for p in sorted(glob.glob(pattern)):
            if os.path.isdir(p):
                out.append({"path": p, "label": os.path.basename(p)})
    if os.path.isdir(f"{home}/Downloads"):
        out.insert(1, {"path": f"{home}/Downloads", "label": "Downloads"})
    return out


def inside_roots(path: str, user: str) -> str:
    real = os.path.realpath(path)
    for r in roots(user):
        rr = os.path.realpath(r["path"])
        if real == rr or real.startswith(rr + os.sep):
            return real
    raise PermissionError("Pfad außerhalb der freigegebenen Orte")


def inspect_file(path: str) -> dict:
    with open(path, "rb") as f:
        head = f.read(16)
    name = os.path.basename(path)
    st = os.stat(path)
    info = {"path": path, "name": re.sub(r"[-_.](x86_64|amd64|aarch64)?\.?AppImage$", "", name, flags=re.I) or name, "size": st.st_size}
    if name.lower().endswith(".appimage") or (head[:4] == ELF and head[8:11] in (b"AI\x01", b"AI\x02")):
        if head[:4] != ELF:
            raise ValueError("Keine gültige AppImage-Datei (kein ELF)")
        info.update(kind="appimage", appimage_type=head[10] if head[8:10] == b"AI" else None, arch="x86_64" if head[18:19] != b"\xb7" else "aarch64")
        m = re.search(r"(\d+\.\d+(?:\.\d+)?)", name)
        if m:
            info["version"] = m.group(1)
    elif name.endswith(".flatpak"):
        info.update(kind="flatpak", subtype="bundle")
    elif name.endswith(".flatpakref"):
        txt = Path(path).read_text(errors="replace")
        m = re.search(r"^Name=(.+)$", txt, re.M)
        info.update(kind="flatpak", subtype="ref", name=(m.group(1).strip() if m else info["name"]))
    elif head[:4] == ELF or head[:2] == b"#!":
        info.update(kind="binary", script=head[:2] == b"#!")
    else:
        raise ValueError("Nicht unterstützter Dateityp")
    return info


class SideloadModule(Module):
    name = "sideload"

    def methods(self):
        return {"sideload.inspect": self.inspect, "sideload.add": self.add, "sideload.remove": self.remove, "fs.roots": self.fs_roots, "fs.list": self.fs_list}

    async def fs_roots(self, _p=None):
        return roots(self.cfg.user)

    async def fs_list(self, p):
        path = inside_roots(p.get("path", str(Path.home())), self.cfg.user)
        show_hidden = bool(p.get("hidden"))
        out = []
        with os.scandir(path) as it:
            for e in it:
                if not show_hidden and e.name.startswith("."):
                    continue
                try:
                    st = e.stat()
                except OSError:
                    continue
                out.append({"name": e.name, "path": e.path, "dir": e.is_dir(), "size": 0 if e.is_dir() else st.st_size, "mtime": int(st.st_mtime * 1000)})
        out.sort(key=lambda x: (not x["dir"], x["name"].lower()))
        return out[:2000]

    async def inspect(self, p):
        return inspect_file(inside_roots(p["path"], self.cfg.user))

    async def add(self, p):
        src = inside_roots(p["path"], self.cfg.user)
        info = inspect_file(src)
        name = str(p.get("name") or info["name"])[:80]
        lib = self.ctx["library"]
        if info["kind"] == "flatpak":
            if self.cfg.simulate:
                return {"name": name, "job": None, "simulated": True}
            r = self.ctx["flatpak"].install_file(src, name)
            return {"name": name, **r}
        apps = Path.home() / "Applications"
        apps.mkdir(exist_ok=True)
        dest = apps / os.path.basename(src)
        if os.path.realpath(src) != os.path.realpath(dest):
            tmp = dest.with_name(f".{dest.name}.part")
            await asyncio.get_running_loop().run_in_executor(None, shutil.copyfile, src, tmp)
            os.replace(tmp, dest)
        dest.chmod(dest.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP)
        item_id = f"sideload:{hashlib.sha1(str(dest).encode()).hexdigest()[:12]}"
        entry = {"id": item_id, "kind": info["kind"], "name": name, "path": str(dest), "args": ["--no-sandbox"] if "electron" in name.lower() else []}
        lst = [s for s in lib.state.setdefault("sideload", []) if s["id"] != item_id]
        lst.append(entry)
        lib.state["sideload"] = lst
        lib.save()
        self.emit("library.changed", {})
        return entry

    async def remove(self, p):
        lib = self.ctx["library"]
        item = next((s for s in lib.state.get("sideload", []) if s["id"] == p.get("id")), None)
        if not item:
            raise RpcError("Nicht gefunden", "ENOENT")
        lib.state["sideload"] = [s for s in lib.state["sideload"] if s["id"] != item["id"]]
        lib.save()
        apps = str(Path.home() / "Applications") + os.sep
        if p.get("delete_file", True) and item["path"].startswith(apps) and os.path.exists(item["path"]):
            os.remove(item["path"])
        self.emit("library.changed", {})
        return {"ok": True}
