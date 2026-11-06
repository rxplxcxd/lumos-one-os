"""PipeWire audio via wpctl / pactl."""
from __future__ import annotations

import json
import re

from .module import Module
from .server import RpcError
from .util import run, which


class AudioModule(Module):
    name = "audio"

    def methods(self):
        return {"audio.get": self.get, "audio.set": self.set}

    async def get(self, _p=None):
        if self.cfg.simulate or not which("wpctl"):
            return self.ctx["sim"].audio if self.cfg.simulate else {"volume": None, "muted": False, "outputs": [], "output": None}
        _, out, _ = await run(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"], timeout=5)
        m = re.search(r"Volume:\s*([\d.]+)", out)
        vol = round(float(m.group(1)) * 100) if m else None
        outputs, default = [], None
        if which("pactl"):
            try:
                _, js, _ = await run(["pactl", "-f", "json", "list", "sinks"], timeout=5)
                outputs = [{"id": s["name"], "name": s.get("description") or s["name"]} for s in json.loads(js)]
                _, default, _ = await run(["pactl", "get-default-sink"], timeout=5)
                default = default.strip()
            except Exception as e:  # noqa: BLE001
                self.log.debug("pactl: %s", e)
        return {"volume": vol, "muted": "MUTED" in out, "outputs": outputs, "output": default}

    async def set(self, p):
        if self.cfg.simulate:
            self.ctx["sim"].audio.update({k: v for k, v in p.items() if k in ("volume", "muted", "output")})
            return self.ctx["sim"].audio
        if "volume" in p and p["volume"] is not None:
            v = max(0, min(100, int(p["volume"]))) / 100
            await run(["wpctl", "set-volume", "-l", "1.0", "@DEFAULT_AUDIO_SINK@", f"{v:.2f}"], timeout=5)
        if "muted" in p:
            await run(["wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "1" if p["muted"] else "0"], timeout=5)
        if p.get("output"):
            if not re.match(r"^[\w.:-]+$", p["output"]):
                raise RpcError("Ungültiges Gerät", "EINVAL")
            await run(["pactl", "set-default-sink", p["output"]], timeout=5)
        return await self.get()
