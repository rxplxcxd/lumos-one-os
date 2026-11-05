"""Now-playing (MPRIS) via playerctl, with --follow for push updates."""
from __future__ import annotations

import asyncio

from .module import Module
from .server import RpcError
from .util import run, which

FMT = "{{playerName}}\t{{title}}\t{{artist}}\t{{album}}\t{{mpris:artUrl}}\t{{position}}\t{{mpris:length}}\t{{status}}"


def parse(line: str):
    parts = (line.rstrip("\n").split("\t") + [""] * 8)[:8]
    player, title, artist, album, art, pos, length, status = parts
    if not title and not player:
        return None
    us = lambda v: int(v) / 1e6 if v.isdigit() else 0  # noqa: E731
    return {"player": player, "title": title, "artist": artist, "album": album, "art": art if art.startswith(("http", "data:")) else "", "position": us(pos), "length": us(length), "playing": status == "Playing"}


class MediaModule(Module):
    name = "media"

    def methods(self):
        return {"media.status": self.status, "media.control": self.control}

    async def start(self):
        if which("playerctl") and not self.cfg.simulate:
            self.spawn(self._follow())

    async def _follow(self):
        while True:
            proc = await asyncio.create_subprocess_exec("playerctl", "--follow", "metadata", "--format", FMT, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            async for raw in proc.stdout:
                m = parse(raw.decode(errors="replace"))
                if m:
                    self.emit("media.state", m)
            await proc.wait()
            await asyncio.sleep(3)

    async def status(self, _p=None):
        if self.cfg.simulate:
            return self.ctx["sim"].media
        if not which("playerctl"):
            return None
        code, out, _ = await run(["playerctl", "metadata", "--format", FMT], timeout=5, check=False)
        return parse(out) if code == 0 else None

    async def control(self, p):
        action = {"toggle": "play-pause", "play": "play", "pause": "pause", "next": "next", "previous": "previous"}.get(p.get("action"))
        if not action:
            raise RpcError("Unbekannte Aktion", "EINVAL")
        if self.cfg.simulate:
            m = self.ctx["sim"].media
            if action in ("play-pause", "play", "pause"):
                m["playing"] = not m["playing"] if action == "play-pause" else action == "play"
            self.emit("media.state", m)
            return {"ok": True}
        await run(["playerctl", action], timeout=5)
        return {"ok": True}
