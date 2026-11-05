"""Wi-Fi (NetworkManager / nmcli) and Bluetooth (BlueZ / bluetoothctl)."""
from __future__ import annotations

import json
import re

from .module import Module
from .server import RpcError
from .util import run, which

MAC = re.compile(r"^([0-9A-F]{2}:){5}[0-9A-F]{2}$", re.I)


def split_terse(line: str) -> list[str]:
    """nmcli -t escapes ':' as '\\:'."""
    out, cur, esc = [], "", False
    for ch in line:
        if esc:
            cur += ch
            esc = False
        elif ch == "\\":
            esc = True
        elif ch == ":":
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return out


class NetworkModule(Module):
    name = "network"

    def methods(self):
        return {
            "network.status": self.status,
            "network.wifi_scan": self.scan,
            "network.wifi_connect": self.connect,
            "network.wifi_disconnect": self.disconnect,
            "network.set_wifi": self.set_wifi,
            "bluetooth.status": self.bt_status,
            "bluetooth.scan": self.bt_scan,
            "bluetooth.pair": self.bt_pair,
            "bluetooth.remove": self.bt_remove,
            "bluetooth.set": self.bt_set,
        }

    def _sim(self):
        return self.cfg.simulate or not which("nmcli")

    async def status(self, _p=None):
        if self._sim():
            return self.ctx["sim"].network if self.cfg.simulate else {"wifi": None, "ethernet": None, "ip": None}
        _, out, _ = await run(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"], timeout=8)
        wifi = eth = None
        for line in out.splitlines():
            dev, typ, state, conn = (split_terse(line) + ["", "", "", ""])[:4]
            if typ == "wifi" and state == "connected":
                wifi = {"device": dev, "ssid": conn}
            if typ == "ethernet" and state == "connected":
                eth = {"device": dev}
        ip = None
        if which("ip"):
            try:
                _, js, _ = await run(["ip", "-j", "-4", "addr"], timeout=5)
                for itf in json.loads(js):
                    if itf.get("ifname") != "lo":
                        for a in itf.get("addr_info", []):
                            ip = ip or a.get("local")
            except Exception:  # noqa: BLE001
                pass
        if wifi:
            for n in await self.scan({"rescan": False}):
                if n["connected"]:
                    wifi["signal"] = n["signal"]
        return {"wifi": wifi, "ethernet": eth, "ip": ip}

    async def scan(self, p):
        if self._sim():
            return self.ctx["sim"].wifi_list() if self.cfg.simulate else []
        rescan = "yes" if p.get("rescan", True) else "no"
        _, out, _ = await run(["nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "dev", "wifi", "list", "--rescan", rescan], timeout=20)
        nets: dict[str, dict] = {}
        for line in out.splitlines():
            inuse, ssid, signal, sec = (split_terse(line) + ["", "", "0", ""])[:4]
            if not ssid:
                continue
            n = {"ssid": ssid, "signal": int(signal or 0), "security": sec or "open", "connected": inuse.strip() == "*"}
            if ssid not in nets or n["signal"] > nets[ssid]["signal"] or n["connected"]:
                nets[ssid] = n
        return sorted(nets.values(), key=lambda n: (not n["connected"], -n["signal"]))

    async def connect(self, p):
        ssid = str(p.get("ssid", ""))
        if not ssid or len(ssid) > 64:
            raise RpcError("Ungültige SSID", "EINVAL")
        if self._sim():
            self.ctx["sim"].network["wifi"] = {"ssid": ssid, "signal": 70}
            return {"ok": True}
        cmd = ["nmcli", "--wait", "30", "dev", "wifi", "connect", ssid]
        if p.get("password"):
            cmd += ["password", str(p["password"])]
        await run(cmd, timeout=40)
        return {"ok": True}

    async def disconnect(self, _p):
        st = await self.status()
        if st.get("wifi"):
            await run(["nmcli", "dev", "disconnect", st["wifi"]["device"]], timeout=10)
        return {"ok": True}

    async def set_wifi(self, p):
        if self._sim():
            return {"ok": True}
        await run(["nmcli", "radio", "wifi", "on" if p.get("enabled", True) else "off"], timeout=10)
        return {"ok": True}

    # -------------------------------------------------------------- bluetooth
    def _bt_sim(self):
        return self.cfg.simulate or not which("bluetoothctl")

    async def _devices(self, which_: str = ""):
        _, out, _ = await run(["bluetoothctl", "devices", *([which_] if which_ else [])], timeout=8, check=False)
        devs = {}
        for line in out.splitlines():
            m = re.match(r"Device ([0-9A-F:]{17}) (.*)", line.strip(), re.I)
            if m:
                devs[m.group(1)] = m.group(2)
        return devs

    async def bt_status(self, _p=None):
        if self._bt_sim():
            return self.ctx["sim"].bluetooth if self.cfg.simulate else {"enabled": False, "devices": []}
        _, show, _ = await run(["bluetoothctl", "show"], timeout=8, check=False)
        paired = await self._devices("Paired")
        connected = await self._devices("Connected")
        return {"enabled": "Powered: yes" in show, "devices": [{"address": a, "name": n, "paired": True, "connected": a in connected} for a, n in paired.items()]}

    async def bt_scan(self, p):
        if self._bt_sim():
            return self.ctx["sim"].bluetooth["devices"] if self.cfg.simulate else []
        secs = max(2, min(20, int(p.get("seconds", 6))))
        await run(["bluetoothctl", "--timeout", str(secs), "scan", "on"], timeout=secs + 5, check=False)
        all_ = await self._devices()
        paired = await self._devices("Paired")
        connected = await self._devices("Connected")
        return [{"address": a, "name": n, "paired": a in paired, "connected": a in connected} for a, n in all_.items() if not re.fullmatch(r"([0-9A-F]{2}-){5}[0-9A-F]{2}", n, re.I)]

    async def bt_pair(self, p):
        addr = p.get("address", "")
        if not MAC.match(addr):
            raise RpcError("Ungültige Adresse", "EINVAL")
        if self._bt_sim():
            return {"ok": True}
        await run(["bluetoothctl", "--timeout", "25", "pair", addr], timeout=30)
        await run(["bluetoothctl", "trust", addr], timeout=10, check=False)
        await run(["bluetoothctl", "--timeout", "15", "connect", addr], timeout=20, check=False)
        return {"ok": True}

    async def bt_remove(self, p):
        addr = p.get("address", "")
        if not MAC.match(addr):
            raise RpcError("Ungültige Adresse", "EINVAL")
        if not self._bt_sim():
            await run(["bluetoothctl", "remove", addr], timeout=10)
        return {"ok": True}

    async def bt_set(self, p):
        if not self._bt_sim():
            await run(["bluetoothctl", "power", "on" if p.get("enabled", True) else "off"], timeout=10)
        return {"ok": True}
