"""PipeWire audio via wpctl / pactl, plus a system-wide 5-band equalizer (PipeWire filter-chain)."""
from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path

from .module import Module
from .server import RpcError
from .util import run, which


class AudioModule(Module):
    name = "audio"

    BANDS = [("bq_lowshelf", 60.0, 0.7), ("bq_peaking", 250.0, 1.0), ("bq_peaking", 1000.0, 1.0), ("bq_peaking", 3500.0, 1.1), ("bq_highshelf", 10000.0, 0.7)]

    def __init__(self, ctx):
        super().__init__(ctx)
        self.eq_proc = None
        self.prev_sink = None
        self.eq = {"enabled": False, "bands": [0, 0, 0, 0, 0]}

    def methods(self):
        return {"audio.get": self.get, "audio.set": self.set, "audio.eq": self.set_eq}

    @classmethod
    def filter_chain_conf(cls, bands: list[float]) -> str:
        nodes, links = [], []
        for i, ((label, freq, q), gain) in enumerate(zip(cls.BANDS, bands), 1):
            g = max(-12.0, min(12.0, float(gain)))
            nodes.append(f'          {{ type = builtin name = eq{i} label = {label} control = {{ "Freq" = {freq} "Q" = {q} "Gain" = {g:.1f} }} }}')
            if i > 1:
                links.append(f'          {{ output = "eq{i - 1}:Out" input = "eq{i}:In" }}')
        return (
            "# written by Lumos One (Einstellungen → Audio → Equalizer)\n"
            "context.modules = [\n  { name = libpipewire-module-filter-chain\n    args = {\n"
            '      node.description = "Lumos Equalizer"\n      media.name = "Lumos Equalizer"\n'
            "      filter.graph = {\n        nodes = [\n" + "\n".join(nodes) + "\n        ]\n        links = [\n" + "\n".join(links) + "\n        ]\n      }\n"
            "      audio.channels = 2\n      audio.position = [ FL FR ]\n"
            '      capture.props = { node.name = "effect_input.lumos_eq" media.class = Audio/Sink }\n'
            '      playback.props = { node.name = "effect_output.lumos_eq" node.passive = true }\n'
            "    }\n  }\n]\n"
        )

    async def set_eq(self, p):
        bands = [float(x) for x in (p.get("bands") or self.eq["bands"])][:5]
        bands += [0.0] * (5 - len(bands))
        enabled = bool(p.get("enabled", self.eq["enabled"]))
        self.eq = {"enabled": enabled, "bands": bands, "preset": p.get("preset")}
        if self.cfg.simulate or not which("pipewire"):
            return {**self.eq, "simulated": True}
        conf = Path.home() / ".config" / "pipewire" / "filter-chain.conf.d" / "lumos-eq.conf"
        conf.parent.mkdir(parents=True, exist_ok=True)
        if self.eq_proc and self.eq_proc.returncode is None:
            self.eq_proc.terminate()
            await self.eq_proc.wait()
            self.eq_proc = None
        if not enabled or not any(abs(b) > 0.05 for b in bands):
            conf.unlink(missing_ok=True)
            if self.prev_sink and which("pactl"):
                await run(["pactl", "set-default-sink", self.prev_sink], timeout=5, check=False)
            return self.eq
        conf.write_text(self.filter_chain_conf(bands))
        if which("pactl") and not self.prev_sink:
            _, cur, _ = await run(["pactl", "get-default-sink"], timeout=5, check=False)
            if cur.strip() and "lumos_eq" not in cur:
                self.prev_sink = cur.strip()
        # dedicated PipeWire instance hosting only the filter chain (the stock filter-chain.conf loads *.conf.d)
        self.eq_proc = await asyncio.create_subprocess_exec("pipewire", "-c", "filter-chain.conf", stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        await asyncio.sleep(0.6)
        if which("pactl"):
            await run(["pactl", "set-default-sink", "effect_input.lumos_eq"], timeout=5, check=False)
        return self.eq

    async def stop(self):
        if self.eq_proc and self.eq_proc.returncode is None:
            self.eq_proc.terminate()
        await super().stop()

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
