"""Authenticated JSON WebSocket server: {id, method, params} → {id, result|error}; events {event, data}."""
from __future__ import annotations

import asyncio
import hmac
import inspect
import json
import logging
import os
import secrets
import time

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

log = logging.getLogger("lumosd.server")


class RpcError(Exception):
    def __init__(self, message: str, code: str = "EFAIL"):
        super().__init__(message)
        self.code = code


class Client:
    def __init__(self, ws):
        self.ws = ws
        self.authed = False
        self.name = "?"
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=512)
        self.dropped = 0


class Server:
    def __init__(self, cfg):
        self.cfg = cfg
        self.methods: dict[str, callable] = {}
        self.clients: set[Client] = set()
        self.token = secrets.token_urlsafe(32)
        self.started = time.time()
        self._server = None

    def write_token(self) -> None:
        for path, mode in ((self.cfg.runtime_dir / "daemon.token", 0o640), (self.cfg.cache_dir / "daemon.token", 0o600)):
            try:
                tmp = path.with_suffix(".tmp")
                fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
                with os.fdopen(fd, "w") as f:
                    f.write(self.token)
                os.replace(tmp, path)
            except OSError as e:
                log.warning("cannot write token to %s: %s", path, e)

    def origin_allowed(self, origin: str) -> bool:
        if origin in ("null", "file://") or origin.startswith("file://"):
            return True  # Electron shell
        try:
            from urllib.parse import urlparse

            host = urlparse(origin).hostname or ""
        except ValueError:
            return False
        if host in ("127.0.0.1", "localhost", "::1"):
            return True
        # GitHub Codespaces port forwarding (private ports are GitHub-authenticated) – dev mode only
        return self.cfg.dev and (host.endswith(".app.github.dev") or host.endswith(".github.dev"))

    def register(self, methods: dict) -> None:
        for name, fn in methods.items():
            if name in self.methods:
                raise ValueError(f"duplicate method {name}")
            self.methods[name] = fn

    def emit(self, event: str, data=None) -> None:
        if not self.clients:
            return
        msg = json.dumps({"event": event, "data": data}, separators=(",", ":"), default=str)
        for c in list(self.clients):
            if not c.authed:
                continue
            try:
                c.queue.put_nowait(msg)
            except asyncio.QueueFull:
                c.dropped += 1  # slow consumer: drop (high-rate gyro frames are disposable)

    async def _writer(self, c: Client):
        try:
            while True:
                msg = await c.queue.get()
                await c.ws.send(msg)
        except (ConnectionClosed, asyncio.CancelledError):
            pass

    async def _call(self, c: Client, msg: dict):
        mid = msg.get("id")
        method = msg.get("method")
        params = msg.get("params") or {}
        try:
            if method == "auth.hello":
                result = self._auth(c, params)
            elif not c.authed:
                raise RpcError("not authenticated", "EAUTH")
            else:
                fn = self.methods.get(method)
                if not fn:
                    raise RpcError(f"Unbekannte Methode: {method}", "ENOMETHOD")
                if not isinstance(params, dict):
                    raise RpcError("params must be an object", "EINVAL")
                result = fn(params)
                if inspect.isawaitable(result):
                    result = await result
            resp = {"id": mid, "result": result}
        except RpcError as e:
            resp = {"id": mid, "error": {"code": e.code, "message": str(e)}}
        except (PermissionError, FileNotFoundError) as e:
            resp = {"id": mid, "error": {"code": "EUNAVAILABLE", "message": str(e)}}
        except (ValueError, KeyError, TypeError) as e:
            resp = {"id": mid, "error": {"code": "EINVAL", "message": str(e) or e.__class__.__name__}}
        except Exception as e:  # noqa: BLE001 — report, never crash the connection
            log.exception("method %s failed", method)
            resp = {"id": mid, "error": {"code": "EFAIL", "message": str(e) or e.__class__.__name__}}
        if mid is not None:
            try:
                await c.ws.send(json.dumps(resp, separators=(",", ":"), default=str))
            except ConnectionClosed:
                pass

    def _auth(self, c: Client, params: dict):
        token = params.get("token") or ""
        if not self.cfg.dev and not hmac.compare_digest(str(token), self.token):
            raise RpcError("invalid token", "EAUTH")
        c.authed = True
        c.name = str(params.get("client", "?"))[:40]
        log.info("client authenticated: %s", c.name)
        from . import __version__

        return {"ok": True, "version": __version__, "simulated": self.cfg.simulate, "uptime": time.time() - self.started}

    async def _handler(self, ws):
        origin = ws.request.headers.get("Origin")
        if origin and not self.origin_allowed(origin):
            # always enforced (also with --dev): otherwise any web page could drive the daemon
            await ws.close(4003, "origin not allowed")
            return
        c = Client(ws)
        self.clients.add(c)
        writer = asyncio.create_task(self._writer(c))
        tasks: set[asyncio.Task] = set()
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except (ValueError, TypeError):
                    continue
                t = asyncio.create_task(self._call(c, msg))
                tasks.add(t)
                t.add_done_callback(tasks.discard)
        except ConnectionClosed:
            pass
        finally:
            self.clients.discard(c)
            writer.cancel()
            for t in tasks:
                t.cancel()

    async def start(self):
        self.write_token()
        self._server = await serve(self._handler, self.cfg.host, self.cfg.port, max_size=64 * 1024 * 1024, ping_interval=20, compression=None)
        log.info("listening on ws://%s:%d (dev=%s, simulate=%s)", self.cfg.host, self.cfg.port, self.cfg.dev, self.cfg.simulate)

    async def stop(self):
        if self._server:
            self._server.close()
            await self._server.wait_closed()
