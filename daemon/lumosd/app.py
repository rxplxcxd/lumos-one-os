"""Entry point: wires all modules into the WebSocket server."""
from __future__ import annotations

import argparse
import asyncio
import logging
import signal

from . import __version__
from .audio import AudioModule
from .config import load
from .controllers import ControllerModule
from .display import DisplayModule
from .dock import DockModule
from .faceid import FaceIdModule
from .flatpak import FlatpakModule
from .haptics import HapticsModule
from .keypad import KeypadModule
from .apps import AppsModule
from .terminal import TerminalModule
from .social import SocialModule
from . import logbuf
from .library import LibraryModule
from .media import MediaModule
from .module import Context
from .network import NetworkModule
from .power import PowerModule
from .saves import SavesModule
from .server import Server
from .sideload import SideloadModule
from .sim import SimModule
from .system import SystemModule
from .update import UpdateModule

MODULES = [SimModule, UpdateModule, PowerModule, SystemModule, DockModule, DisplayModule, AudioModule, NetworkModule, MediaModule, FlatpakModule, LibraryModule, SideloadModule, SavesModule, ControllerModule, KeypadModule, HapticsModule, FaceIdModule, TerminalModule, AppsModule, SocialModule]


def build(cfg):
    server = Server(cfg)
    ctx = Context(cfg, server)
    for cls in MODULES:
        m = cls(ctx)
        ctx.modules[m.name] = m
        server.register(m.methods())
    server.register({"daemon.methods": lambda _p: sorted(server.methods), "daemon.ping": lambda _p: {"pong": True}})
    return server, ctx


async def amain(cfg):
    server, ctx = build(cfg)
    await server.start()
    for m in ctx.modules.values():
        await m.start()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    try:
        import sdnotify  # optional: systemd Type=notify

        sdnotify.SystemdNotifier().notify("READY=1")
    except ImportError:
        pass
    await stop.wait()
    for m in reversed(list(ctx.modules.values())):
        await m.stop()
    await server.stop()


def main():
    ap = argparse.ArgumentParser(prog="lumosd", description=f"Lumos One hardware daemon {__version__}")
    ap.add_argument("--simulate", action="store_true", help="simulate all hardware (developer mode)")
    ap.add_argument("--dev", action="store_true", help="disable token auth (browser UI development only)")
    ap.add_argument("--host", default=None)
    ap.add_argument("--port", type=int, default=None)
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    logbuf.install()
    cfg = load({"simulate": a.simulate or None, "dev": a.dev or None, "host": a.host, "port": a.port})
    try:
        asyncio.run(amain(cfg))
    except KeyboardInterrupt:
        pass
