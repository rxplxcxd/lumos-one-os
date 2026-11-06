"""Hardware simulator (lumosd --simulate). Provides realistic, stateful stand-ins for battery,
Joy-Cons, dock, IR camera, flatpak, library, media … and the `sim.*` methods driven by the
Developer Panel. Virtual buttons / gyro overrides also work against real hardware."""
from __future__ import annotations

import asyncio
import math
import time

from .module import Module
from .server import RpcError


class SimModule(Module):
    name = "sim"

    def __init__(self, ctx):
        super().__init__(ctx)
        now = time.time() * 1000
        self.face_outcome = "success"
        self.face_models = [{"id": 0, "label": "Primäres Gesicht", "created": int(now - 12 * 86400e3)}]
        self._battery = {"percent": 78.0, "charging": False, "watts": 11.4, "time_left_min": 214, "health": 96, "status": "Discharging"}
        self.dock = {"docked": False, "output": "eDP-1", "mode": "handheld", "resolution": "1920x1200", "fsr": True}
        self.joys = {
            "left": {"id": "joy-l-sim", "slot": 1, "side": "left", "name": "Lumos Joy (L)", "transport": "pogo", "battery": 84, "charging": True, "connected": True, "gyro": True, "fw": "1.0.0"},
            "right": {"id": "joy-r-sim", "slot": 1, "side": "right", "name": "Lumos Joy (R)", "transport": "pogo", "battery": 81, "charging": True, "connected": True, "gyro": True, "fw": "1.0.0"},
        }
        self.flatpaks = {"org.mozilla.firefox": {"id": "org.mozilla.firefox", "name": "Firefox", "version": "132.0", "size": "289 MB", "origin": "flathub", "installation": "user"}}
        self.library = [
            {"id": "steam:1145360", "kind": "steam", "name": "Hades", "appid": 1145360, "lastPlayed": now - 2 * 3600e3, "playtime": 3120},
            {"id": "steam:367520", "kind": "steam", "name": "Hollow Knight", "appid": 367520, "lastPlayed": now - 26 * 3600e3, "playtime": 2210},
            {"id": "steam:413150", "kind": "steam", "name": "Stardew Valley", "appid": 413150, "lastPlayed": now - 120 * 3600e3, "playtime": 5100},
            {"id": "flatpak:org.mozilla.firefox", "kind": "flatpak", "name": "Firefox", "flatpak": "org.mozilla.firefox", "lastPlayed": 0, "playtime": 0},
        ]
        self.audio = {"volume": 62, "muted": False, "output": "speakers", "outputs": [{"id": "speakers", "name": "Lautsprecher"}, {"id": "headphones", "name": "Kopfhörer (3,5 mm)"}]}
        self.network = {"wifi": {"ssid": "Lumos-Home", "signal": 82}, "ethernet": None, "ip": "192.168.1.42"}
        self.bluetooth = {"enabled": True, "devices": [{"address": "A4:C1:38:22:9F:10", "name": "Lumos Buds", "paired": True, "connected": False}]}
        self.media = {"player": "spotify", "title": "Midnight City", "artist": "M83", "album": "Hurry Up, We're Dreaming", "art": "", "position": 64, "length": 243, "playing": False}
        self.saves = [{"id": "retroarch", "title": "RetroArch (Saves & States)", "path": "~/.var/app/org.libretro.RetroArch/config/retroarch/saves", "size": 18_000_000, "mtime": int(now - 86400e3), "hash": "sim-retroarch", "files": 42}]
        self.gyro_override = None
        self.externals: dict[str, dict] = {}

    def methods(self):
        return {
            "sim.state": lambda _p: {"simulate": self.cfg.simulate, "faceOutcome": self.face_outcome, "battery": self.battery(), "dock": self.dock, "controllers": self.controller_list()},
            "sim.faceid": self.set_face,
            "sim.battery": self.set_battery,
            "sim.controller": self.set_controller,
            "sim.controller_power": self.set_controller_power,
            "sim.dock": self.set_dock,
            "sim.button": self.button,
            "sim.gyro": self.gyro,
            "sim.usb_controller": self.usb_controller,
        }

    def _need_sim(self):
        if not self.cfg.simulate:
            raise RpcError("Nur im Simulationsmodus (lumosd --simulate)", "EUNAVAILABLE")

    async def start(self):
        if self.cfg.simulate:
            self.spawn(self._ambient())

    async def _ambient(self):
        t = 0.0
        last_bat = 0.0
        while True:
            await asyncio.sleep(1 / 30)
            t += 1 / 30
            if self.gyro_override is None:
                self.emit("gyro", {"pitch": round(math.sin(t * 0.7) * 1.5, 2), "roll": round(math.cos(t * 0.5) * 1.5, 2), "yaw": 0, "simulated": True})
            if t - last_bat > 5:
                last_bat = t
                b = self._battery
                b["percent"] = max(1.0, min(100.0, b["percent"] + (0.25 if b["charging"] else -0.05)))

    # ------------------------------------------------------------ state accessors for modules
    def battery(self):
        return {**self._battery, "percent": round(self._battery["percent"])}

    def controller_list(self):
        out = [dict(j) for j in self.joys.values() if j["connected"]]
        slot = 2
        for e in self.externals.values():
            out.append({**e, "slot": e.get("assigned") or slot})
            slot += 1
        return out

    def assign(self, ext_id, slot):
        if ext_id in self.externals:
            self.externals[ext_id]["assigned"] = slot
        self._changed()
        return {"ok": True}

    def wifi_list(self):
        return [{"ssid": "Lumos-Home", "signal": 82, "security": "WPA2", "connected": True}, {"ssid": "FRITZ!Box 7590 XY", "signal": 64, "security": "WPA2", "connected": False}]

    def flatpak_done(self, job):
        if job.op == "install":
            self.flatpaks[job.id] = {"id": job.id, "name": job.name, "version": "—", "size": "—", "origin": "flathub", "installation": "user"}
            self.library.append({"id": f"flatpak:{job.id}", "kind": "flatpak", "name": job.name, "flatpak": job.id, "icon": job.icon, "lastPlayed": 0, "playtime": 0})
        elif job.op == "uninstall":
            self.flatpaks.pop(job.id, None)
            self.library = [x for x in self.library if x.get("flatpak") != job.id]

    def launch(self, item_id):
        item = next((x for x in self.library if x["id"] == item_id), None)
        if not item:
            raise RpcError("Titel nicht gefunden", "ENOENT")
        item["lastPlayed"] = time.time() * 1000
        self.emit("library.launched", {"id": item_id, "simulated": True})
        return {"ok": True, "pid": 0, "simulated": True}

    async def face_verify(self, state):
        await asyncio.sleep(0.9)
        if self.face_outcome == "none":
            await asyncio.sleep(2.0)
            state("failed", reason="Kein Gesicht gefunden")
            return {"ok": False, "reason": "Kein Gesicht gefunden"}
        state("detected")
        await asyncio.sleep(0.55)
        if self.face_outcome == "success" and self.face_models:
            state("matched", confidence=0.94)
            return {"ok": True, "backend": "sim", "confidence": 0.94}
        state("failed", reason="Gesicht nicht erkannt")
        return {"ok": False, "reason": "Gesicht nicht erkannt", "code": 11}

    async def face_enroll(self, label, state):
        for i in range(26):
            state("enrolling", progress=i / 25, angle=i / 25 * math.tau)
            await asyncio.sleep(0.09)
        m = {"id": max([x["id"] for x in self.face_models], default=-1) + 1, "label": label, "created": int(time.time() * 1000)}
        self.face_models.append(m)
        state("enrolled", id=m["id"])
        return {"ok": True, **m}

    # ------------------------------------------------------------ sim.* methods
    async def set_face(self, p):
        self._need_sim()
        if p.get("outcome") not in ("success", "fail", "none"):
            raise RpcError("outcome muss success|fail|none sein", "EINVAL")
        self.face_outcome = p["outcome"]
        return {"ok": True}

    async def set_battery(self, p):
        self._need_sim()
        if "percent" in p:
            self._battery["percent"] = float(max(0, min(100, p["percent"])))
        if "charging" in p:
            self._battery["charging"] = bool(p["charging"])
            self._battery["status"] = "Charging" if p["charging"] else "Discharging"
        self.emit("battery", self.battery())
        return {"ok": True}

    def _changed(self):
        self.emit("controllers.changed", self.controller_list())

    async def set_controller(self, p):
        self._need_sim()
        j = self.joys.get(p.get("side"))
        if not j:
            raise RpcError("side muss left|right sein", "EINVAL")
        if p.get("battery") is not None:
            j["battery"] = int(p["battery"])
        if p.get("attached") is not None:
            attached = bool(p["attached"])
            if attached != (j["transport"] == "pogo"):
                j["transport"] = "pogo" if attached else "ble"
                j["charging"] = attached
                j["connected"] = True
                self.emit("controller.attached" if attached else "controller.detached", dict(j))
        self._changed()
        return {"ok": True}

    async def set_controller_power(self, p):
        self._need_sim()
        j = self.joys.get(p.get("side"))
        if not j:
            raise RpcError("side muss left|right sein", "EINVAL")
        j["connected"] = bool(p.get("connected"))
        self.emit("controller.attached" if j["connected"] else "controller.detached", {**j, "lost": not j["connected"]})
        self._changed()
        return {"ok": True}

    async def set_dock(self, p):
        self._need_sim()
        docked = bool(p.get("docked"))
        self.dock.update({"docked": True, "output": "DP-1", "mode": "tv", "resolution": "3840x2160"} if docked else {"docked": False, "output": "eDP-1", "mode": "handheld", "resolution": "1920x1200"})
        self.ctx["display"].write_session_env()
        self.emit("dock.changed", dict(self.dock))
        return {"ok": True}

    async def button(self, p):
        b = str(p.get("button", ""))
        pressed = bool(p.get("pressed", True))
        self.emit("input.button", {"button": b, "pressed": pressed, "source": "virtual"})
        if b == "home" and pressed:
            self.emit("input.home", {})
        return {"ok": True}

    SIM_PADS = {
        "xbox": ("045e", "0b13", "bt", 72),
        "dualsense": ("054c", "0ce6", "usb", 100),
        "pro": ("057e", "2009", "bt", 55),
        "8bitdo": ("2dc8", "3106", "usb", None),
        "generic": ("0079", "0006", "usb", None),
    }

    async def usb_controller(self, p):
        self._need_sim()
        from .padsdb import classify

        model = p.get("model", "xbox")
        if model not in self.SIM_PADS:
            raise RpcError("model: xbox|dualsense|pro|8bitdo|generic", "EINVAL")
        vid, pid, transport, bat = self.SIM_PADS[model]
        ext_id = f"ext-{vid}{pid}-sim"
        if p.get("connected", True):
            if len([j for j in self.joys.values() if j["connected"]]) + len(self.externals) >= 4 and ext_id not in self.externals:
                raise RpcError("Maximal 4 Controller", "ELIMIT")
            info = classify(int(vid, 16), int(pid, 16), "")
            e = {"id": ext_id, "side": "pro", "name": info["model"] if model != "generic" else "USB Gamepad (DragonRise)", "family": info["family"], "driver": info["driver"], "vendor": vid, "product": pid,
                 "transport": transport, "battery": bat, "charging": transport == "usb", "connected": True, "gyro": info["family"] in ("playstation", "nintendo"), "rumble": True}
            if ext_id not in self.externals:
                self.externals[ext_id] = e
                self.emit("controller.attached", e)
        elif ext_id in self.externals:
            self.emit("controller.detached", {**self.externals.pop(ext_id), "lost": True})
        self._changed()
        return {"ok": True}

    async def gyro(self, p):
        if p.get("reset"):
            self.gyro_override = None
            return {"ok": True}
        self.gyro_override = (float(p.get("pitch", 0)), float(p.get("roll", 0)))
        self.emit("gyro", {"pitch": self.gyro_override[0], "roll": self.gyro_override[1], "yaw": 0, "override": True})
        return {"ok": True}
