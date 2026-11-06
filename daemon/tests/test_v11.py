"""v1.1 daemon features: permissions → flatpak overrides, EQ filter-chain, origin policy, PTY terminal,
process list/kill, per-game profiles, logs."""
import asyncio
import types

import pytest
from websockets.asyncio.client import connect

from lumosd.app import build
from lumosd.apps import flatpak_override_args
from lumosd.audio import AudioModule
from lumosd.display import DisplayModule
from lumosd.server import Server
from test_server_e2e import RPC, daemon  # noqa: F401  (fixture re-export)


def test_flatpak_override_args_only_denies():
    assert flatpak_override_args({}) == []
    assert flatpak_override_args({"network": True, "storage": True}) == []
    args = flatpak_override_args({"network": False, "controller": False, "sensors": False, "storage": False, "push": False})
    assert "--unshare=network" in args and "--nofilesystem=home" in args and "--no-talk-name=org.freedesktop.Notifications" in args
    assert args.count("--nodevice=input") == 1  # de-duplicated


def test_filter_chain_conf_clamps_and_links():
    conf = AudioModule.filter_chain_conf([30, -2, 0, 3.5, -99])
    assert conf.count("type = builtin") == 5
    assert '"Gain" = 12.0' in conf and '"Gain" = -12.0' in conf
    assert conf.count("output = ") == 4  # eq1→eq2→…→eq5
    assert "effect_input.lumos_eq" in conf


def test_lux_curve_monotonic():
    vals = [DisplayModule.lux_to_brightness(x) for x in (0, 5, 50, 300, 2000, 20000)]
    assert vals == sorted(vals) and vals[0] >= 5 and vals[-1] <= 100


@pytest.mark.parametrize(
    "origin,dev,ok",
    [
        ("file://", False, True),
        ("http://127.0.0.1:5173", False, True),
        ("http://localhost:4173", False, True),
        ("https://evil.example", False, False),
        ("https://foo-5173.app.github.dev", False, False),
        ("https://foo-5173.app.github.dev", True, True),
        ("https://app.github.dev.evil.example", True, False),
    ],
)
def test_origin_policy(origin, dev, ok):
    srv = Server.__new__(Server)
    srv.cfg = types.SimpleNamespace(dev=dev)
    assert srv.origin_allowed(origin) is ok


async def _run(cfg):
    server, ctx = build(cfg)
    await server.start()
    for m in ctx.modules.values():
        await m.start()
    try:
        async with connect(f"ws://127.0.0.1:{cfg.port}") as ws:
            rpc = RPC(ws)
            await rpc.call("auth.hello", {"token": (cfg.cache_dir / "daemon.token").read_text(), "client": "pytest"})

            # PTY terminal round trip
            t = await rpc.call("terminal.open", {"cols": 80, "rows": 24})
            await rpc.call("terminal.write", {"id": t["id"], "data": "echo lumos-$((40+2))\n"})
            seen = ""
            for _ in range(60):
                d = await rpc.wait_event("terminal.data", timeout=5)
                seen += d["data"]
                if "lumos-42" in seen:
                    break
            assert "lumos-42" in seen
            await rpc.call("terminal.resize", {"id": t["id"], "cols": 100, "rows": 30})
            await rpc.call("terminal.close", {"id": t["id"]})

            # logs ring buffer
            logs = await rpc.call("system.logs", {"limit": 50})
            assert isinstance(logs, list) and all({"t", "level", "name", "msg"} <= set(r) for r in logs)

            # process list never exposes arbitrary system processes as killable
            procs = await rpc.call("process.list")
            assert all(not p["killable"] for p in procs if p.get("kind") == "daemon")
            with pytest.raises(RuntimeError):
                await rpc.call("process.kill", {"pid": 1})

            # permissions + profiles + HUD are accepted
            r = await rpc.call("permissions.apply", {"id": "flatpak:org.example.Game", "perms": {"network": False}})
            assert "--unshare=network" in r["args"]
            await rpc.call("profiles.set", {"profiles": {"org.example.Game": {"fps": 40, "tdp": 9, "refresh": 120}}})
            await rpc.call("hud.configure", {"mode": "full", "position": "tr"})
            await rpc.call("audio.eq", {"enabled": True, "bands": [3, 0, 0, 0, 2]})
            st = await rpc.call("capture.status")
            assert "buffering" in st or "available" in st
    finally:
        for m in reversed(list(ctx.modules.values())):
            await m.stop()
        await server.stop()


def test_v11_end_to_end(daemon):  # noqa: F811
    asyncio.run(_run(daemon))
