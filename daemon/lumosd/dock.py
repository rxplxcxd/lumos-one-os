"""Dock detection: hall sensor (chassis MCU / Joy event) + DRM connector hot-plug. On change the
display module re-applies Gamescope scaling and the session env (1080p handheld → 4K TV with FSR)."""
from __future__ import annotations

import asyncio
import glob
import os

from .module import Module
from .util import read


def external_outputs():
    out = []
    for st in glob.glob("/sys/class/drm/card*-*/status"):
        name = os.path.basename(os.path.dirname(st)).split("-", 1)[1]
        if name.startswith(("eDP", "LVDS", "DSI", "Writeback")):
            continue
        if read(st) == "connected":
            modes = (read(os.path.join(os.path.dirname(st), "modes"), "") or "").split()
            out.append({"output": name, "best": modes[0] if modes else None})
    return out


class DockModule(Module):
    name = "dock"

    def __init__(self, ctx):
        super().__init__(ctx)
        self.hall = None
        self.outputs = []
        self.docked = False
        self.chassis = None

    def methods(self):
        return {"dock.status": lambda _p: self.status()}

    def status(self):
        if self.cfg.simulate:
            return self.ctx["sim"].dock
        o = self.outputs[0] if self.outputs else None
        return {"docked": self.docked, "output": o["output"] if o else self.cfg.internal_output, "resolution": (o or {}).get("best") or "1920x1200", "mode": "tv" if self.docked else "handheld", "hall": self.hall, "fsr": True}

    def attach_chassis(self, link):
        self.chassis = link
        self.log.info("chassis MCU on %s", link.port)

    def hall_changed(self, closed: bool):
        self.hall = closed
        self._evaluate()

    def _evaluate(self):
        # docked when an external display is connected AND (no hall sensor known OR magnet detected)
        docked = bool(self.outputs) and self.hall is not False
        if docked != self.docked:
            self.docked = docked
            self.log.info("dock state → %s", "TV" if docked else "handheld")
            disp = self.ctx["display"]
            disp.write_session_env()
            asyncio.ensure_future(disp.apply_gamescope())
            self.emit("dock.changed", self.status())

    async def start(self):
        if not self.cfg.simulate:
            self.spawn(self._poll())

    async def _poll(self):
        while True:
            outs = external_outputs()
            if [o["output"] for o in outs] != [o["output"] for o in self.outputs]:
                self.outputs = outs
                self._evaluate()
            await asyncio.sleep(1.0)
