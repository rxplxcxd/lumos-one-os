"""Terminal sessions: a login shell in a PTY, streamed over the WebSocket (terminal.data events)."""
from __future__ import annotations

import asyncio
import fcntl
import itertools
import os
import pty
import signal
import struct
import termios

from . import logbuf
from .module import Module
from .server import RpcError


class Session:
    _ids = itertools.count(1)

    def __init__(self):
        self.id = f"t{next(self._ids)}"
        self.pid = None
        self.fd = None


class TerminalModule(Module):
    name = "terminal"
    MAX = 6

    def __init__(self, ctx):
        super().__init__(ctx)
        self.sessions: dict[str, Session] = {}

    def methods(self):
        return {
            "terminal.open": self.open,
            "terminal.write": self.write,
            "terminal.resize": self.resize,
            "terminal.close": self.close,
            "system.logs": lambda p: logbuf.tail(int(p.get("limit", 300)), p.get("level"), float(p.get("since", 0))),
        }

    async def open(self, p):
        if len(self.sessions) >= self.MAX:
            raise RpcError("Zu viele Terminal-Sitzungen", "ELIMIT")
        cols, rows = int(p.get("cols", 100)), int(p.get("rows", 30))
        s = Session()
        shell = os.environ.get("SHELL") or "/bin/bash"
        pid, fd = pty.fork()
        if pid == 0:  # child
            os.environ.update({"TERM": "xterm-256color", "COLORTERM": "truecolor", "LUMOS_TERMINAL": "1"})
            try:
                os.chdir(os.path.expanduser("~"))
                os.execvp(shell, [shell, "-l"])
            finally:
                os._exit(127)  # never fall back into the daemon's event loop in the child
        s.pid, s.fd = pid, fd
        self._winsize(fd, rows, cols)
        self.sessions[s.id] = s
        loop = asyncio.get_running_loop()

        def readable():
            try:
                data = os.read(fd, 65536)
            except OSError:
                data = b""
            if data:
                self.emit("terminal.data", {"id": s.id, "data": data.decode("utf-8", "replace")})
            else:
                loop.remove_reader(fd)
                self._reap(s)

        loop.add_reader(fd, readable)
        return {"id": s.id, "shell": shell, "pid": pid}

    @staticmethod
    def _winsize(fd, rows, cols):
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", max(5, rows), max(20, cols), 0, 0))

    def _get(self, sid) -> Session:
        s = self.sessions.get(sid)
        if not s:
            raise RpcError("Sitzung beendet", "ENOENT")
        return s

    async def write(self, p):
        s = self._get(p.get("id"))
        os.write(s.fd, str(p.get("data", "")).encode())
        return {"ok": True}

    async def resize(self, p):
        s = self._get(p.get("id"))
        self._winsize(s.fd, int(p.get("rows", 30)), int(p.get("cols", 100)))
        return {"ok": True}

    def _reap(self, s: Session):
        if s.id not in self.sessions:
            return
        self.sessions.pop(s.id, None)
        try:
            os.close(s.fd)
        except OSError:
            pass
        try:
            _, status = os.waitpid(s.pid, os.WNOHANG)
        except ChildProcessError:
            status = 0
        self.emit("terminal.exit", {"id": s.id, "status": status})

    async def close(self, p):
        s = self.sessions.get(p.get("id"))
        if s:
            try:
                os.kill(s.pid, signal.SIGHUP)
            except ProcessLookupError:
                pass
            try:
                asyncio.get_running_loop().remove_reader(s.fd)
            except (ValueError, OSError):
                pass
            self._reap(s)
        return {"ok": True}

    async def stop(self):
        for s in list(self.sessions.values()):
            await self.close({"id": s.id})
        await super().stop()
