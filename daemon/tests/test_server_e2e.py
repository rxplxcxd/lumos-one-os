"""Starts the full daemon in --simulate mode on a random port and talks to it like the shell does."""
import asyncio
import json
import socket

import pytest
from websockets.asyncio.client import connect

from lumosd.app import build
from lumosd.config import load


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


@pytest.fixture()
def daemon(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(tmp_path / "run"))
    cfg = load({"simulate": True, "port": free_port()})
    cfg.cache_dir = tmp_path / "cache"
    cfg.data_dir = tmp_path / "data"
    cfg.config_dir = tmp_path / "cfg"
    cfg.runtime_dir = tmp_path / "run"
    cfg.update_root = tmp_path / "opt"
    cfg.ensure_dirs()
    return cfg


class RPC:
    def __init__(self, ws):
        self.ws, self.seq, self.events = ws, 0, []

    async def call(self, method, params=None):
        self.seq += 1
        mid = self.seq
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(await asyncio.wait_for(self.ws.recv(), 10))
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(msg["error"]["message"])
                return msg["result"]
            self.events.append(msg)

    async def wait_event(self, name, timeout=10):
        for e in self.events:
            if e["event"] == name:
                self.events.remove(e)
                return e["data"]
        while True:
            msg = json.loads(await asyncio.wait_for(self.ws.recv(), timeout))
            if msg.get("event") == name:
                return msg["data"]
            self.events.append(msg)


async def _run(cfg):
    server, ctx = build(cfg)
    await server.start()
    for m in ctx.modules.values():
        await m.start()
    try:
        async with connect(f"ws://127.0.0.1:{cfg.port}") as ws:
            rpc = RPC(ws)
            with pytest.raises(RuntimeError, match="not authenticated"):
                await rpc.call("system.info")
            with pytest.raises(RuntimeError, match="invalid token"):
                await rpc.call("auth.hello", {"token": "nope"})
            token = (cfg.cache_dir / "daemon.token").read_text()
            hello = await rpc.call("auth.hello", {"token": token, "client": "pytest"})
            assert hello["ok"] and hello["simulated"]

            methods = await rpc.call("daemon.methods")
            for m in ("flatpak.install", "faceid.verify", "haptics.play", "update.apply", "saves.pack", "sim.dock", "controllers.list"):
                assert m in methods

            info = await rpc.call("system.info")
            assert info["simulated"] and info["ram_total"] > 0

            # flatpak job with live progress
            job = await rpc.call("flatpak.install", {"id": "org.gnome.Calculator", "name": "Rechner"})
            pcts = []
            while True:
                ev = json.loads(await asyncio.wait_for(ws.recv(), 10))
                if ev.get("event") == "flatpak.progress" and ev["data"]["job"] == job["job"]:
                    pcts.append(ev["data"]["percent"])
                if ev.get("event") == "flatpak.done":
                    break
            assert pcts == sorted(pcts) and pcts[-1] >= 99
            assert any(a["id"] == "org.gnome.Calculator" for a in await rpc.call("flatpak.list"))

            # face id pretend: success, then fail
            assert (await rpc.call("faceid.verify", {"timeout": 3}))["ok"] is True
            await rpc.call("sim.faceid", {"outcome": "fail"})
            r = await rpc.call("faceid.verify", {"timeout": 3})
            assert r["ok"] is False and "nicht erkannt" in r["reason"]

            # joy-con detach → event
            await rpc.call("sim.controller", {"side": "left", "attached": False})
            det = await rpc.wait_event("controller.detached")
            assert det["side"] == "left" and det["transport"] == "ble"

            # third-party USB controllers: classified, slotted, capped at 4 total
            await rpc.call("sim.controller_power", {"side": "left", "connected": True})
            await rpc.call("sim.usb_controller", {"model": "dualsense"})
            att = await rpc.wait_event("controller.attached")
            while att.get("side") != "pro":
                att = await rpc.wait_event("controller.attached")
            assert att["family"] == "playstation" and att["name"] == "DualSense"
            await rpc.call("sim.usb_controller", {"model": "xbox"})
            lst = await rpc.call("controllers.list")
            assert len(lst) == 4 and sorted(c["slot"] for c in lst if c["side"] == "pro") == [2, 3]
            with pytest.raises(RuntimeError, match="Maximal 4"):
                await rpc.call("sim.usb_controller", {"model": "pro"})
            await rpc.call("controllers.assign", {"id": att["id"], "slot": 4})
            assert next(c for c in await rpc.call("controllers.list") if c["id"] == att["id"])["slot"] == 4
            await rpc.call("sim.usb_controller", {"model": "dualsense", "connected": False})
            assert (await rpc.wait_event("controller.detached"))["lost"] is True

            # keyboard → virtual gamepad bridge accepts the UI binding table
            r = await rpc.call("input.keyboard_pad", {"mode": "games", "bindings": {"a": ["Enter", "Space"], "up": ["ArrowUp"]}})
            assert r["mode"] == "games"

            # dock → session env for gamescope
            await rpc.call("sim.dock", {"docked": True})
            d = await rpc.wait_event("dock.changed")
            assert d["resolution"] == "3840x2160"
            assert "LUMOS_MODE=tv" in (cfg.config_dir / "session.env").read_text()

            # haptics accept every pattern from shared/haptics.json
            for pat in await rpc.call("haptics.patterns"):
                assert (await rpc.call("haptics.play", {"pattern": pat}))["ok"]
            with pytest.raises(RuntimeError):
                await rpc.call("haptics.play", {"pattern": "does.not.exist"})

            # update flow (simulated OTA)
            avail = await rpc.call("update.check", {"channel": "stable"})
            assert avail["version"] == "1.1.0"
            await rpc.call("update.download")
            st = await rpc.call("update.status")
            assert st["staged"]["version"] == "1.1.0"
            clean = await rpc.call("update.cleanup")
            assert "freed_bytes" in clean

            with pytest.raises(RuntimeError, match="Unbekannte Methode"):
                await rpc.call("nope.nope")
    finally:
        for m in reversed(list(ctx.modules.values())):
            await m.stop()
        await server.stop()


def test_daemon_end_to_end(daemon):
    asyncio.run(_run(daemon))
