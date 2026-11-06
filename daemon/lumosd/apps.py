"""App-level system services:
  • permissions.apply   – Flatpak sandbox overrides per app (sensors, controller, storage, network, push)
  • process.list/kill   – task manager for titles launched from Lumos (+ the daemon's own children)
  • profiles            – per-game FPS/TDP profiles applied on launch and restored afterwards
  • capture.*           – replay buffer (gpu-screen-recorder) for 30 s clips + screenshots
  • hud.configure       – MangoHud OSD config for games (FPS, frametimes, temps, watts)
"""
from __future__ import annotations

import asyncio
import glob
import os
import re
import signal
import time
from pathlib import Path

from .module import Module
from .server import RpcError
from .util import run, which

APP_ID = re.compile(r"^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*){2,}$")
CLK = os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else 100
PAGE = os.sysconf("SC_PAGE_SIZE") if hasattr(os, "sysconf") else 4096


def flatpak_override_args(perms: dict) -> list[str]:
    """Translate Lumos permission switches into `flatpak override` flags (denies only)."""
    args = []
    if perms.get("network") is False:
        args.append("--unshare=network")
    if perms.get("controller") is False:
        args.append("--nodevice=input")
    if perms.get("sensors") is False:
        args += ["--system-no-talk-name=net.hadess.SensorProxy", "--nodevice=input"] if perms.get("controller") is False else ["--system-no-talk-name=net.hadess.SensorProxy"]
    if perms.get("storage") is False:
        args += ["--nofilesystem=home", "--nofilesystem=host"]
    if perms.get("push") is False:
        args.append("--no-talk-name=org.freedesktop.Notifications")
    return list(dict.fromkeys(args))


def proc_stat(pid: int) -> dict | None:
    try:
        with open(f"/proc/{pid}/stat") as f:
            raw = f.read()
        name = raw[raw.index("(") + 1 : raw.rindex(")")]
        fields = raw[raw.rindex(")") + 2 :].split()
        utime, stime = int(fields[11]), int(fields[12])
        rss = int(fields[21]) * PAGE
        return {"pid": pid, "name": name, "state": fields[0], "cpu_ticks": utime + stime, "rss": rss, "ppid": int(fields[1])}
    except (OSError, ValueError, IndexError):
        return None


def children_of(root: int) -> list[int]:
    out, frontier = [], [root]
    stats = {}
    for d in glob.glob("/proc/[0-9]*"):
        st = proc_stat(int(os.path.basename(d)))
        if st:
            stats[st["pid"]] = st
    while frontier:
        p = frontier.pop()
        for st in stats.values():
            if st["ppid"] == p:
                out.append(st["pid"])
                frontier.append(st["pid"])
    return out


class AppsModule(Module):
    name = "apps"

    def __init__(self, ctx):
        super().__init__(ctx)
        self.perms: dict[str, dict] = {}
        self.profiles: dict[str, dict] = {}
        self.saved_state: dict | None = None
        self.prev_ticks: dict[int, tuple[float, int]] = {}
        self.recorder = None
        self.capture_dir = Path.home() / "Videos" / "Lumos"
        self.hud = {"mode": "off", "position": "top-right"}

    def methods(self):
        return {
            "permissions.apply": self.apply_permissions,
            "permissions.get": lambda p: self.perms.get(p.get("id"), {}),
            "process.list": self.list_processes,
            "process.kill": self.kill,
            "profiles.set": self.set_profiles,
            "capture.status": self.capture_status,
            "capture.buffer": self.capture_buffer,
            "capture.clip": self.capture_clip,
            "capture.screenshot": self.capture_screenshot,
            "hud.configure": self.configure_hud,
        }

    # ------------------------------------------------------------------ permissions
    async def apply_permissions(self, p):
        app_id, perms = str(p.get("id", "")), dict(p.get("perms") or {})
        self.perms[app_id] = perms
        flatpak = p.get("flatpak") or (app_id.split(":", 1)[1] if app_id.startswith("flatpak:") else None)
        if not flatpak:
            return {"ok": True, "enforced": "launcher" if perms.get("network") is False and which("firejail") else "stored"}
        if not APP_ID.match(flatpak):
            raise RpcError("Ungültige App-ID", "EINVAL")
        if self.cfg.simulate or not which("flatpak"):
            return {"ok": True, "simulated": True, "args": flatpak_override_args(perms)}
        await run(["flatpak", "override", "--user", "--reset", flatpak], timeout=15, check=False)
        args = flatpak_override_args(perms)
        if args:
            await run(["flatpak", "override", "--user", *args, flatpak], timeout=15)
        return {"ok": True, "enforced": "flatpak", "args": args}

    def launch_wrapper(self, item_id: str) -> list[str]:
        """Prefix for non-Flatpak titles (network isolation needs firejail)."""
        perms = self.perms.get(item_id, {})
        if perms.get("network") is False and which("firejail"):
            return ["firejail", "--quiet", "--net=none", "--"]
        return []

    # ------------------------------------------------------------------ task manager
    async def list_processes(self, _p=None):
        if self.cfg.simulate:
            return self.ctx["sim"].processes()
        lib = self.ctx["library"]
        out = []
        now = time.monotonic()
        for item_id, proc in list(lib.running.items()):
            pids = [proc.pid, *children_of(proc.pid)]
            ticks = rss = 0
            names = []
            for pid in pids:
                st = proc_stat(pid)
                if st:
                    ticks += st["cpu_ticks"]
                    rss += st["rss"]
                    names.append(st["name"])
            prev = self.prev_ticks.get(proc.pid)
            cpu = ((ticks - prev[1]) / CLK) / max(0.001, now - prev[0]) * 100 if prev else 0.0
            self.prev_ticks[proc.pid] = (now, ticks)
            out.append({"pid": proc.pid, "id": item_id, "name": item_id.split(":", 1)[-1], "kind": "app", "cpu": round(cpu, 1), "rss": rss, "threads": len(pids), "children": names[:6], "killable": True})
        me = proc_stat(os.getpid())
        if me:
            out.append({"pid": me["pid"], "id": "lumosd", "name": "lumosd (Hardware-Daemon)", "kind": "daemon", "cpu": None, "rss": me["rss"], "killable": False})
        for name, task in (("Terminal-Sitzungen", len(self.ctx["terminal"].sessions)), ("Flatpak-Jobs", len(self.ctx["flatpak"].jobs))):
            if task:
                out.append({"pid": None, "id": name, "name": f"{name}: {task}", "kind": "service", "killable": False})
        return out

    async def kill(self, p):
        pid = int(p.get("pid", 0))
        if self.cfg.simulate:
            return self.ctx["sim"].kill(pid)
        lib = self.ctx["library"]
        owner = next((i for i, pr in lib.running.items() if pr.pid == pid), None)
        if not owner:
            raise RpcError("Nur von Lumos gestartete Apps können beendet werden", "EPERM")
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)  # titles run in their own session (start_new_session)
        except ProcessLookupError:
            return {"ok": True}
        for _ in range(30):
            await asyncio.sleep(0.1)
            if lib.running.get(owner) is None or lib.running[owner].returncode is not None:
                return {"ok": True, "signal": "TERM"}
        try:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
        except ProcessLookupError:
            pass
        return {"ok": True, "signal": "KILL"}

    # ------------------------------------------------------------------ per-game profiles
    async def set_profiles(self, p):
        self.profiles = {k: v for k, v in (p.get("profiles") or {}).items() if isinstance(v, dict)}
        return {"ok": True, "count": len(self.profiles)}

    async def apply_profile(self, item_id: str):
        prof = self.profiles.get(item_id)
        if not prof:
            return None
        disp, power = self.ctx["display"], self.ctx["power"]
        self.saved_state = {"display": dict(disp.state), "power": dict(power.state)}
        if prof.get("fps") is not None or prof.get("refresh"):
            await disp.set({k: v for k, v in (("fps_limit", prof.get("fps")), ("refresh", prof.get("refresh"))) if v is not None})
        if prof.get("tdp"):
            await power.set({"profile": "custom", "tdp_w": int(prof["tdp"])})
        self.emit("profiles.applied", {"id": item_id, **prof})
        return prof

    async def restore_profile(self):
        if not self.saved_state:
            return
        st, self.saved_state = self.saved_state, None
        await self.ctx["display"].set({"fps_limit": st["display"]["fps_limit"], "refresh": st["display"]["refresh"]})
        await self.ctx["power"].set({"profile": st["power"]["profile"], "tdp_w": st["power"]["tdp_w"]})
        self.emit("profiles.restored", {})

    # ------------------------------------------------------------------ capture (replay buffer)
    async def capture_status(self, _p=None):
        return {"backend": "gpu-screen-recorder" if which("gpu-screen-recorder") else "none", "buffering": bool(self.recorder and self.recorder.returncode is None), "dir": str(self.capture_dir)}

    async def capture_buffer(self, p):
        """Keep the last N seconds of the screen in RAM (gpu-screen-recorder -r). Started while a game runs."""
        on = bool(p.get("on", True))
        if self.cfg.simulate or not which("gpu-screen-recorder"):
            return {"ok": False, "reason": "gpu-screen-recorder nicht installiert"}
        if on and not (self.recorder and self.recorder.returncode is None):
            self.capture_dir.mkdir(parents=True, exist_ok=True)
            secs = max(10, min(120, int(p.get("seconds", 30))))
            env = {**os.environ, "DISPLAY": self.cfg.gamescope_display}
            self.recorder = await asyncio.create_subprocess_exec(
                "gpu-screen-recorder", "-w", "screen", "-f", "60", "-c", "mp4", "-a", "default_output", "-r", str(secs), "-o", str(self.capture_dir),
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, env=env,
            )
        elif not on and self.recorder and self.recorder.returncode is None:
            self.recorder.send_signal(signal.SIGINT)
            self.recorder = None
        return {"ok": True, "buffering": on}

    async def capture_clip(self, _p=None):
        if not (self.recorder and self.recorder.returncode is None):
            raise RpcError("Kein Aufnahmepuffer aktiv", "EUNAVAILABLE")
        before = set(glob.glob(str(self.capture_dir / "*.mp4")))
        self.recorder.send_signal(signal.SIGUSR1)  # gpu-screen-recorder: save replay
        for _ in range(60):
            await asyncio.sleep(0.25)
            new = set(glob.glob(str(self.capture_dir / "*.mp4"))) - before
            if new:
                path = max(new, key=os.path.getmtime)
                self.emit("capture.saved", {"path": path, "kind": "clip"})
                return {"ok": True, "path": path}
        raise RpcError("Clip konnte nicht gespeichert werden", "EFAIL")

    async def capture_screenshot(self, _p=None):
        """Gamescope writes a PNG when GAMESCOPECTRL_REQUEST_SCREENSHOT is set on the root window."""
        if self.cfg.simulate or not which("xprop"):
            raise RpcError("Screenshots benötigen Gamescope", "EUNAVAILABLE")
        before = set(glob.glob("/tmp/gamescope_*.png"))
        await run(["xprop", "-display", self.cfg.gamescope_display, "-root", "-f", "GAMESCOPECTRL_REQUEST_SCREENSHOT", "32c", "-set", "GAMESCOPECTRL_REQUEST_SCREENSHOT", "1"], timeout=3, check=False)
        for _ in range(20):
            await asyncio.sleep(0.15)
            new = set(glob.glob("/tmp/gamescope_*.png")) - before
            if new:
                src = max(new, key=os.path.getmtime)
                self.capture_dir.mkdir(parents=True, exist_ok=True)
                dst = self.capture_dir / f"Screenshot-{time.strftime('%Y%m%d-%H%M%S')}.png"
                os.replace(src, dst)
                self.emit("capture.saved", {"path": str(dst), "kind": "screenshot"})
                return {"ok": True, "path": str(dst)}
        raise RpcError("Gamescope hat keinen Screenshot geliefert", "EFAIL")

    # ------------------------------------------------------------------ in-game HUD (MangoHud)
    async def configure_hud(self, p):
        mode = p.get("mode", "off")
        pos = {"tl": "top-left", "tr": "top-right", "bl": "bottom-left", "br": "bottom-right"}.get(p.get("position"), "top-right")
        self.hud = {"mode": mode, "position": pos}
        conf = Path.home() / ".config" / "MangoHud" / "MangoHud.conf"
        conf.parent.mkdir(parents=True, exist_ok=True)
        if mode == "off":
            body = "no_display\n"
        elif mode == "minimal":
            body = f"legacy_layout=false\nhorizontal\nfps\nframetime=0\nbattery\nbattery_watt\nposition={pos}\nbackground_alpha=0.35\nround_corners=8\nfont_size=18\n"
        else:
            body = f"legacy_layout=false\nfps\nframetime\nframe_timing\ncpu_stats\ncpu_temp\ngpu_stats\ngpu_temp\nram\nvram\nbattery\nbattery_watt\nposition={pos}\nbackground_alpha=0.4\nround_corners=10\nfont_size=18\ntoggle_hud=Shift_R+F12\n"
        conf.write_text("# written by Lumos One (Einstellungen → Leistungs-HUD)\n" + body)
        return {"ok": True, "config": str(conf)}

    def game_env(self) -> dict:
        return {"MANGOHUD": "1"} if self.hud["mode"] != "off" and which("mangohud") is not None else {}
