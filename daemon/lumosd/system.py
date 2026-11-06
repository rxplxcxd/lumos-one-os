"""System info, live stats (CPU/GPU load, temps, fan, power) and power actions."""
from __future__ import annotations

import asyncio
import glob
import os
import platform
import shutil
import socket
import time

from .module import Module
from .server import RpcError
from .util import read, read_int, run, which


def _cpu_times():
    with open("/proc/stat") as f:
        parts = f.readline().split()[1:]
    vals = list(map(int, parts))
    idle = vals[3] + (vals[4] if len(vals) > 4 else 0)
    return idle, sum(vals)


def _hwmon(name_match: tuple[str, ...], label_match: tuple[str, ...] = (), kind="temp"):
    for hw in glob.glob("/sys/class/hwmon/hwmon*"):
        if (read(f"{hw}/name") or "") in name_match:
            for inp in sorted(glob.glob(f"{hw}/{kind}*_input")):
                lab = read(inp.replace("_input", "_label"), "")
                if not label_match or lab in label_match:
                    v = read_int(inp)
                    if v is not None:
                        return v
    return None


class SystemModule(Module):
    name = "system"

    def __init__(self, ctx):
        super().__init__(ctx)
        self._last_cpu = None

    def methods(self):
        return {"system.info": self.info, "system.stats": self.stats, "system.power": self.power}

    async def start(self):
        self.spawn(self._stats_loop())

    async def _stats_loop(self):
        while True:
            if self.ctx.server.clients:
                self.emit("system.stats", await self.stats())
            await asyncio.sleep(2)

    async def info(self, _p=None):
        osr = {}
        for line in (read("/etc/os-release", "") or "").splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                osr[k] = v.strip('"')
        cpu = "unbekannt"
        try:
            for line in open("/proc/cpuinfo"):
                if line.startswith("model name"):
                    cpu = line.split(":", 1)[1].strip()
                    break
        except OSError:
            pass
        gpu = None
        if which("lspci"):
            try:
                _, out, _ = await run(["lspci", "-mm"], timeout=5)
                for line in out.splitlines():
                    if "VGA" in line or "Display" in line:
                        gpu = line.split('"')[5] if line.count('"') >= 6 else line
                        break
            except Exception:  # noqa: BLE001
                pass
        mem = 0
        for line in (read("/proc/meminfo", "") or "").splitlines():
            if line.startswith("MemTotal:"):
                mem = int(line.split()[1]) * 1024
        du = shutil.disk_usage(os.path.expanduser("~"))
        from . import __version__

        sim = self.cfg.simulate
        return {
            "hostname": socket.gethostname(),
            "os": ("Lumos One · " if not sim else "Lumos One (Simulation) · ") + osr.get("PRETTY_NAME", platform.system()),
            "kernel": platform.release(),
            "cpu": cpu,
            "gpu": gpu or "Integrierte Grafik",
            "ram_total": mem,
            "storage": {"total": du.total, "free": du.free},
            "version": self.ctx["update"].current_version(),
            "daemon": __version__,
            "serial": read("/sys/class/dmi/id/product_serial") or read("/sys/class/dmi/id/board_serial") or None,
            "simulated": sim,
        }

    async def stats(self, _p=None):
        idle, total = _cpu_times()
        cpu = 0.0
        if self._last_cpu:
            di, dt = idle - self._last_cpu[0], total - self._last_cpu[1]
            cpu = 100.0 * (1 - di / dt) if dt else 0.0
        self._last_cpu = (idle, total)
        gpu = None
        for f in glob.glob("/sys/class/drm/card*/device/gpu_busy_percent"):
            gpu = read_int(f)
            break
        t_cpu = _hwmon(("k10temp", "coretemp", "zenpower"), ("Tctl", "Tdie", "Package id 0", ""))
        t_gpu = _hwmon(("amdgpu",), ("edge", ""))
        fan = _hwmon(("cros_ec", "framework_laptop", "thinkpad"), (), kind="fan")
        mem_avail = 0
        mem_total = 0
        for line in (read("/proc/meminfo", "") or "").splitlines():
            if line.startswith("MemAvailable:"):
                mem_avail = int(line.split()[1]) * 1024
            if line.startswith("MemTotal:"):
                mem_total = int(line.split()[1]) * 1024
        bat = self.ctx["power"].battery_snapshot()
        rx = tx = 0
        for line in (read("/proc/net/dev", "") or "").splitlines()[2:]:
            name, _, rest = line.partition(":")
            if name.strip() == "lo":
                continue
            f = rest.split()
            if len(f) >= 9:
                rx += int(f[0])
                tx += int(f[8])
        now_t = time.monotonic()
        net = None
        if getattr(self, "_last_net", None):
            dt = max(0.001, now_t - self._last_net[0])
            net = {"rx_bps": int((rx - self._last_net[1]) / dt), "tx_bps": int((tx - self._last_net[2]) / dt)}
        self._last_net = (now_t, rx, tx)
        return {
            "cpu": round(cpu, 1),
            "gpu": gpu,
            "temp_cpu": t_cpu / 1000 if t_cpu else None,
            "temp_gpu": t_gpu / 1000 if t_gpu else None,
            "fan_rpm": fan,
            "ram_used": mem_total - mem_avail,
            "tdp_w": self.ctx["power"].state.get("tdp_w"),
            "power_w": bat.get("watts"),
            "net": net,
            "t": time.time(),
        }

    async def power(self, p):
        action = p.get("action")
        cmd = {"suspend": ["systemctl", "suspend"], "reboot": ["systemctl", "reboot"], "shutdown": ["systemctl", "poweroff"]}.get(action)
        if not cmd:
            raise RpcError("Unbekannte Aktion", "EINVAL")
        if self.cfg.simulate:
            return {"ok": True, "simulated": True}
        self.emit("system.power", {"action": action})
        await asyncio.sleep(0.3)
        await run(cmd, timeout=15)
        return {"ok": True}
