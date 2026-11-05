"""Battery polling, charge limit, TDP (ryzenadj / Intel RAPL), fan (Framework EC), profiles."""
from __future__ import annotations

import asyncio
import glob
import os

from .module import Module
from .util import priv, read, read_int, run, which

PROFILES = {"silent": {"tdp_w": 8, "platform": "low-power", "ppd": "power-saver"}, "balanced": {"tdp_w": 15, "platform": "balanced", "ppd": "balanced"}, "performance": {"tdp_w": 28, "platform": "performance", "ppd": "performance"}}


def find_battery():
    for b in sorted(glob.glob("/sys/class/power_supply/BAT*")):
        if read(f"{b}/type") == "Battery":
            return b
    return None


def battery_from_sysfs(bat: str) -> dict:
    cap = read_int(f"{bat}/capacity")
    status = read(f"{bat}/status", "Unknown")
    # energy (µWh) or charge (µAh) depending on the fuel gauge
    v = read_int(f"{bat}/voltage_now")
    p = read_int(f"{bat}/power_now")
    if p is None and v is not None:
        c = read_int(f"{bat}/current_now")
        p = (c * v) // 1_000_000 if c is not None else None
    e_now = read_int(f"{bat}/energy_now")
    e_full = read_int(f"{bat}/energy_full")
    e_design = read_int(f"{bat}/energy_full_design")
    if e_now is None and v:
        cn, cf, cd = read_int(f"{bat}/charge_now"), read_int(f"{bat}/charge_full"), read_int(f"{bat}/charge_full_design")
        e_now = cn * v // 1_000_000 if cn else None
        e_full = cf * v // 1_000_000 if cf else None
        e_design = cd * v // 1_000_000 if cd else None
    watts = (p or 0) / 1e6
    charging = status in ("Charging", "Full") or (status == "Not charging" and read_int("/sys/class/power_supply/ACAD/online", 0) == 1)
    tl = None
    if watts > 0.5 and e_now is not None:
        tl = int(((e_full - e_now) if charging and e_full else e_now) / 1e6 / watts * 60)
    return {
        "percent": cap,
        "charging": charging,
        "status": status,
        "watts": round(watts, 2),
        "time_left_min": tl,
        "health": round(100 * e_full / e_design) if e_full and e_design else None,
        "cycles": read_int(f"{bat}/cycle_count"),
        "charge_limit": read_int(f"{bat}/charge_control_end_threshold"),
    }


class PowerModule(Module):
    name = "power"

    def __init__(self, ctx):
        super().__init__(ctx)
        self.bat = find_battery()
        self.state = {"profile": "balanced", "tdp_w": 15, "fan_mode": "auto", "fan_pct": 45, "charge_limit": None}
        self._last = None
        self.vendor = "amd" if "AuthenticAMD" in (read("/proc/cpuinfo", "") or "") else "intel"

    def methods(self):
        return {"power.get": lambda _p: dict(self.state), "power.set": self.set, "power.battery": lambda _p: self.battery_snapshot()}

    async def start(self):
        self.spawn(self._poll())

    def battery_snapshot(self) -> dict:
        if self.cfg.simulate:
            return self.ctx["sim"].battery()
        if not self.bat:
            return {"percent": None, "charging": True, "watts": None, "status": "AC"}
        return battery_from_sysfs(self.bat)

    async def _poll(self):
        while True:
            snap = self.battery_snapshot()
            key = (snap.get("percent"), snap.get("charging"), snap.get("time_left_min"))
            if key != self._last:
                self._last = key
                self.emit("battery", snap)
            await asyncio.sleep(5 if not self.cfg.simulate else 2)

    async def set(self, p):
        res = {}
        if p.get("profile") in PROFILES and p.get("profile") != self.state["profile"]:
            prof = PROFILES[p["profile"]]
            self.state["profile"] = p["profile"]
            res["platform"] = await self._platform_profile(prof)
            if "tdp_w" not in p:
                p["tdp_w"] = prof["tdp_w"]
        elif p.get("profile") == "custom":
            self.state["profile"] = "custom"
        if p.get("tdp_w") is not None:
            tdp = max(4, min(30, int(p["tdp_w"])))
            if tdp != self.state["tdp_w"] or "platform" in res:
                self.state["tdp_w"] = tdp
                res["tdp"] = await self._tdp(tdp)
        if p.get("fan_mode") in ("auto", "quiet", "max", "custom"):
            self.state["fan_mode"] = p["fan_mode"]
            self.state["fan_pct"] = int(p.get("fan_pct", self.state["fan_pct"]))
            res["fan"] = await self._fan(self.state["fan_mode"], self.state["fan_pct"])
        if p.get("charge_limit") is not None:
            lim = max(50, min(100, int(p["charge_limit"])))
            if lim != self.state["charge_limit"]:
                self.state["charge_limit"] = lim
                res["charge_limit"] = await self._guard_priv("charge-limit", str(lim))
        return {**self.state, "applied": res}

    async def _guard_priv(self, *args):
        if self.cfg.simulate:
            return "simulated"
        try:
            await priv(self.cfg, *args)
            return "ok"
        except Exception as e:  # noqa: BLE001 — hardware/tool might be missing; never fail the UI
            self.log.warning("%s: %s", args[0], e)
            return f"error: {e}"

    async def _platform_profile(self, prof):
        if self.cfg.simulate:
            return "simulated"
        if which("powerprofilesctl"):
            try:
                await run(["powerprofilesctl", "set", prof["ppd"]], timeout=5)
                return "ppd"
            except Exception as e:  # noqa: BLE001
                self.log.debug("ppd: %s", e)
        if os.path.exists("/sys/firmware/acpi/platform_profile"):
            return await self._guard_priv("platform-profile", prof["platform"])
        return "unsupported"

    async def _tdp(self, watts):
        return await self._guard_priv("tdp", self.vendor, str(watts))

    async def _fan(self, mode, pct):
        duty = {"auto": "auto", "quiet": "30", "max": "100", "custom": str(max(0, min(100, pct)))}[mode]
        return await self._guard_priv("fan", duty)
