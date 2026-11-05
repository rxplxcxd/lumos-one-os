"""Game/App library: Steam (libraryfolders.vdf + appmanifests + localconfig playtime), Flatpak
apps, emulators and sideloaded AppImages/binaries; launching with process tracking."""
from __future__ import annotations

import asyncio
import glob
import json
import os
import re
import time
from pathlib import Path

from . import vdf
from .module import Module
from .server import RpcError
from .util import which

EMULATORS = {
    "org.libretro.RetroArch", "org.DolphinEmu.dolphin-emu", "org.ppsspp.PPSSPP", "net.pcsx2.PCSX2", "net.rpcs3.RPCS3", "info.cemu.Cemu",
    "net.kuribo64.melonDS", "io.mgba.mGBA", "app.xemu.xemu", "org.duckstation.DuckStation", "io.github.lime3ds.Lime3DS", "net.shadps4.shadPS4",
    "org.flycast.Flycast", "com.snes9x.Snes9x", "org.mamedev.MAME", "io.github.ryubing.Ryujinx", "org.azahar_emu.Azahar",
}
STEAM_TOOLS = re.compile(r"^(Proton|Steam Linux Runtime|Steamworks Common|SteamVR)", re.I)
STEAM_ROOTS = ["~/.local/share/Steam", "~/.steam/steam", "~/.var/app/com.valvesoftware.Steam/data/Steam"]


class LibraryModule(Module):
    name = "library"

    def __init__(self, ctx):
        super().__init__(ctx)
        self.state_file = self.cfg.data_dir / "library.json"
        self.state = self._load()
        self.running: dict[str, asyncio.subprocess.Process] = {}

    def _load(self):
        try:
            return json.loads(self.state_file.read_text())
        except (OSError, ValueError):
            return {"sideload": [], "stats": {}}

    def save(self):
        tmp = self.state_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, indent=1))
        tmp.replace(self.state_file)

    def methods(self):
        return {"library.list": self.list, "library.launch": self.launch, "steam.bigpicture": self.bigpicture, "library.running": lambda _p: list(self.running)}

    # ---------------------------------------------------------------- steam
    def steam_root(self):
        for r in STEAM_ROOTS:
            p = Path(os.path.expanduser(r))
            if (p / "steamapps").exists() or (p / "config" / "libraryfolders.vdf").exists():
                return p
        return None

    def steam_games(self):
        root = self.steam_root()
        if not root:
            return []
        libs = {root}
        for f in (root / "steamapps" / "libraryfolders.vdf", root / "config" / "libraryfolders.vdf"):
            if f.exists():
                data = vdf.parse(f.read_text(errors="replace"))
                folders = vdf.ci_get(data, "libraryfolders") or {}
                for v in folders.values():
                    if isinstance(v, dict) and v.get("path"):
                        libs.add(Path(v["path"]))
        playtime = self._steam_playtime(root)
        games = {}
        for lib in libs:
            for acf in glob.glob(str(lib / "steamapps" / "appmanifest_*.acf")):
                try:
                    st = vdf.ci_get(vdf.parse(Path(acf).read_text(errors="replace")), "AppState") or {}
                except OSError:
                    continue
                appid, name = st.get("appid"), st.get("name", "")
                if not appid or STEAM_TOOLS.match(name) or appid in ("228980",):
                    continue
                pt = playtime.get(appid, {})
                games[appid] = {"id": f"steam:{appid}", "kind": "steam", "name": name, "appid": int(appid), "lastPlayed": pt.get("last", int(st.get("LastPlayed", 0) or 0)) * 1000, "playtime": pt.get("minutes", 0), "size": int(st.get("SizeOnDisk", 0) or 0)}
        return list(games.values())

    @staticmethod
    def _steam_playtime(root: Path):
        out = {}
        for lc in glob.glob(str(root / "userdata" / "*" / "config" / "localconfig.vdf")):
            try:
                apps = vdf.ci_get(vdf.parse(Path(lc).read_text(errors="replace")), "UserLocalConfigStore", "Software", "Valve", "Steam", "apps") or {}
            except OSError:
                continue
            for appid, a in apps.items():
                if isinstance(a, dict):
                    last = int(a.get("LastPlayed", 0) or 0)
                    mins = int(a.get("Playtime", 0) or 0)
                    if last > out.get(appid, {}).get("last", 0):
                        out[appid] = {"last": last, "minutes": mins}
        return out

    # ---------------------------------------------------------------- list
    async def list(self, _p=None):
        if self.cfg.simulate:
            return self.ctx["sim"].library
        items = self.steam_games()
        stats = self.state.get("stats", {})
        for a in await self.ctx["flatpak"].list_apps():
            if a["id"] == "com.valvesoftware.Steam":
                continue
            s = stats.get(f"flatpak:{a['id']}", {})
            items.append({"id": f"flatpak:{a['id']}", "kind": "emulator" if a["id"] in EMULATORS else "flatpak", "name": a["name"], "flatpak": a["id"], "lastPlayed": s.get("last", 0), "playtime": s.get("minutes", 0)})
        for sl in self.state.get("sideload", []):
            s = stats.get(sl["id"], {})
            if os.path.exists(sl["path"]):
                items.append({**sl, "lastPlayed": s.get("last", 0), "playtime": s.get("minutes", 0)})
        return items

    # ---------------------------------------------------------------- launch
    async def launch(self, p):
        item_id = str(p.get("id", ""))
        if self.cfg.simulate:
            return self.ctx["sim"].launch(item_id)
        if item_id.startswith("steam-uninstall:"):
            appid = item_id.split(":", 1)[1]
            if not appid.isdigit():
                raise RpcError("Ungültige App", "EINVAL")
            cmd = self._steam_cmd(f"steam://uninstall/{appid}")
        elif item_id.startswith("steam:"):
            appid = item_id.split(":", 1)[1]
            if not appid.isdigit():
                raise RpcError("Ungültige App", "EINVAL")
            cmd = self._steam_cmd(f"steam://rungameid/{appid}")
        elif item_id.startswith("flatpak:"):
            fid = item_id.split(":", 1)[1]
            if not re.match(r"^[\w.-]+$", fid):
                raise RpcError("Ungültige App", "EINVAL")
            cmd = ["flatpak", "run", fid]
        else:
            sl = next((s for s in self.state.get("sideload", []) if s["id"] == item_id), None)
            if not sl:
                raise RpcError("Titel nicht gefunden", "ENOENT")
            cmd = [sl["path"], *sl.get("args", [])]
        proc = await asyncio.create_subprocess_exec(*cmd, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, start_new_session=True)
        self.running[item_id] = proc
        self.emit("library.launched", {"id": item_id, "pid": proc.pid})
        self.spawn(self._track(item_id, proc, tracked=not item_id.startswith("steam")))
        return {"ok": True, "pid": proc.pid}

    def _steam_cmd(self, url):
        if which("steam"):
            return ["steam", url]
        if which("flatpak"):
            return ["flatpak", "run", "com.valvesoftware.Steam", url]
        raise RpcError("Steam ist nicht installiert", "EUNAVAILABLE")

    async def _track(self, item_id, proc, tracked: bool):
        t0 = time.time()
        await proc.wait()
        self.running.pop(item_id, None)
        if tracked:
            s = self.state.setdefault("stats", {}).setdefault(item_id, {"minutes": 0})
            s["last"] = int(t0)
            s["minutes"] = s.get("minutes", 0) + int((time.time() - t0) / 60)
            self.save()
            self.emit("library.exited", {"id": item_id, "code": proc.returncode})

    async def bigpicture(self, _p):
        if self.cfg.simulate:
            return {"ok": True, "simulated": True}
        cmd = self._steam_cmd("steam://open/bigpicture")
        await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, start_new_session=True)
        return {"ok": True}
