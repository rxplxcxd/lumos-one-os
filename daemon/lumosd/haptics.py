"""Haptics: named patterns from shared/haptics.json → DRV2605L step programs on the Joy halves
(and the chassis actuator when a chassis MCU is present)."""
from __future__ import annotations

import json

from . import protocol as P
from .module import Module
from .server import RpcError


class HapticsModule(Module):
    name = "haptics"

    def __init__(self, ctx):
        super().__init__(ctx)
        self.catalog = json.loads(self.cfg.haptics_file.read_text())["patterns"]
        self.enabled = True
        self.intensity = 0.8
        self.played = 0

    def methods(self):
        return {"haptics.play": self.play, "haptics.set": self.set, "haptics.patterns": lambda _p: list(self.catalog)}

    async def set(self, p):
        if "enabled" in p:
            self.enabled = bool(p["enabled"])
        if "intensity" in p:
            self.intensity = max(0.0, min(1.0, float(p["intensity"])))
        return {"enabled": self.enabled, "intensity": self.intensity}

    def body_for(self, name: str, intensity: float | None = None) -> bytes:
        pat = self.catalog.get(name)
        if not pat:
            raise RpcError(f"Unbekanntes Haptik-Muster: {name}", "EINVAL")
        return P.haptic_body(pat["steps"], self.intensity if intensity is None else intensity)

    async def play(self, p):
        if not self.enabled:
            return {"ok": True, "skipped": True}
        name = p.get("pattern", "")
        target = p.get("target", "all")
        body = self.body_for(name, min(1.0, float(p.get("intensity", self.intensity))))
        sent = 0
        ctl = self.ctx["controllers"]
        for link in ctl.links_for("all" if target == "body" else target):
            link.send(P.HAPTIC, body)
            sent += 1
        chassis = getattr(self.ctx["dock"], "chassis", None)
        if chassis and target in ("all", "body"):
            chassis.send(P.HAPTIC, body)
            sent += 1
        self.played += 1
        return {"ok": True, "actuators": sent}
