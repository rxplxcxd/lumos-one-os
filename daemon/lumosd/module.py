"""Base class for daemon modules."""
from __future__ import annotations

import asyncio
import logging


class Module:
    name = "module"

    def __init__(self, ctx):
        self.ctx = ctx
        self.cfg = ctx.cfg
        self.log = logging.getLogger(f"lumosd.{self.name}")
        self._tasks: list[asyncio.Task] = []

    def emit(self, event, data=None):
        self.ctx.emit(event, data)

    def methods(self) -> dict:
        return {}

    def spawn(self, coro):
        t = asyncio.create_task(self._guard(coro))
        self._tasks.append(t)
        return t

    async def _guard(self, coro):
        try:
            await coro
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            self.log.exception("background task crashed")

    async def start(self):
        pass

    async def stop(self):
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)


class Context:
    def __init__(self, cfg, server):
        self.cfg = cfg
        self.server = server
        self.modules: dict[str, Module] = {}

    def emit(self, event, data=None):
        self.server.emit(event, data)

    def __getitem__(self, name) -> Module:
        return self.modules[name]
