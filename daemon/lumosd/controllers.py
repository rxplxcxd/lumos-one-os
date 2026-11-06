"""Controller management: Lumos Joy halves over pogo-pin serial (USB-CDC/UART) or Bluetooth LE,
one external gamepad (evdev), virtual uinput gamepad + motion sensors + gyro mouse, gyro feed
for the UI, hot-plug attach/detach events."""
from __future__ import annotations

import asyncio
import glob
import math
import os
import threading
import time
from dataclasses import dataclass, field

from . import protocol as P
from .module import Module
from .server import RpcError
from .util import read, read_int

try:
    import serial  # pyserial
    from serial.tools import list_ports
except ImportError:  # pragma: no cover
    serial = None
    list_ports = None

try:
    import evdev
    from evdev import AbsInfo, UInput
    from evdev import ecodes as E
except ImportError:  # pragma: no cover
    evdev = None

try:
    from bleak import BleakClient, BleakScanner
except ImportError:  # pragma: no cover
    BleakClient = BleakScanner = None

BLE_TX = "6c756d6f-7300-4a6f-7900-000000000002"  # notify: device → host frames
BLE_RX = "6c756d6f-7300-4a6f-7900-000000000003"  # write:  host → device frames


@dataclass
class Joy:
    side: str
    serial: str = ""
    fw: str = "?"
    caps: int = 0
    transport: str = "pogo"
    battery: int | None = None
    mv: int | None = None
    charging: bool = False
    buttons: int = 0
    stick: tuple = (0.0, 0.0)
    trigger: float = 0.0
    quat: tuple | None = None
    accel: tuple = (0.0, 0.0, 1.0)
    gyro: tuple = (0.0, 0.0, 0.0)
    link: object = None
    last_seen: float = field(default_factory=time.monotonic)
    seq: int = 0

    @property
    def id(self):
        return f"joy-{self.side[0]}-{self.serial or 'x'}"

    def public(self, slot=1):
        return {
            "id": self.id, "slot": slot, "side": self.side, "name": f"Lumos Joy ({'L' if self.side == 'left' else 'R'})",
            "transport": self.transport, "battery": self.battery, "charging": self.charging, "connected": True,
            "gyro": bool(self.caps & P.CAP_IMU), "fw": self.fw, "serial": self.serial,
        }


class SerialLink:
    """Blocking pyserial reader in a thread, delivering packets into the asyncio loop."""

    def __init__(self, port, baud, loop, on_packet, on_close):
        self.port, self.loop, self.on_packet, self.on_close = port, loop, on_packet, on_close
        self.ser = serial.Serial(port, baud, timeout=0.05, write_timeout=0.2)
        self.reader = P.FrameReader()
        self.lock = threading.Lock()
        self.alive = True
        self.seq = 0
        threading.Thread(target=self._run, name=f"serial-{os.path.basename(port)}", daemon=True).start()

    def _run(self):
        try:
            while self.alive:
                data = self.ser.read(self.ser.in_waiting or 1)
                if data:
                    for pkt in self.reader.feed(data):
                        self.loop.call_soon_threadsafe(self.on_packet, self, pkt)
        except (OSError, serial.SerialException):
            pass
        finally:
            self.alive = False
            try:
                self.ser.close()
            except Exception:  # noqa: BLE001
                pass
            self.loop.call_soon_threadsafe(self.on_close, self)

    def send(self, ptype, body=b""):
        if not self.alive:
            return
        self.seq = (self.seq + 1) & 0xFF
        frame = P.encode_frame(ptype, self.seq, body)
        try:
            with self.lock:
                self.ser.write(frame)
        except (OSError, serial.SerialException):
            self.alive = False

    def close(self):
        self.alive = False


class BleLink:
    def __init__(self, client, on_packet):
        self.client, self.on_packet = client, on_packet
        self.reader = P.FrameReader()
        self.seq = 0
        self.alive = True
        self.port = f"ble:{client.address}"

    def feed(self, _char, data: bytearray):
        for pkt in self.reader.feed(bytes(data)):
            self.on_packet(self, pkt)

    def send(self, ptype, body=b""):
        self.seq = (self.seq + 1) & 0xFF
        frame = P.encode_frame(ptype, self.seq, body)
        asyncio.ensure_future(self.client.write_gatt_char(BLE_RX, frame, response=False))

    def close(self):
        self.alive = False
        asyncio.ensure_future(self.client.disconnect())


class VirtualPad:
    """uinput gamepad (Xbox-style layout) + motion sensor device + gyro mouse."""

    def __init__(self, log):
        self.log = log
        self.pad = self.motion = self.mouse = None
        if evdev is None:
            log.info("python-evdev missing: no uinput gamepad")
            return
        try:
            stick = AbsInfo(0, -32768, 32767, 16, 128, 0)
            trig = AbsInfo(0, 0, 255, 0, 0, 0)
            hat = AbsInfo(0, -1, 1, 0, 0, 0)
            keys = [E.BTN_SOUTH, E.BTN_EAST, E.BTN_NORTH, E.BTN_WEST, E.BTN_TL, E.BTN_TR, E.BTN_TL2, E.BTN_TR2, E.BTN_SELECT, E.BTN_START, E.BTN_MODE, E.BTN_THUMBL, E.BTN_THUMBR,
                    E.BTN_TRIGGER_HAPPY1, E.BTN_TRIGGER_HAPPY2, E.BTN_TRIGGER_HAPPY3, E.BTN_TRIGGER_HAPPY4, E.BTN_TRIGGER_HAPPY5]
            self.pad = UInput({E.EV_KEY: keys, E.EV_ABS: [(E.ABS_X, stick), (E.ABS_Y, stick), (E.ABS_RX, stick), (E.ABS_RY, stick), (E.ABS_Z, trig), (E.ABS_RZ, trig), (E.ABS_HAT0X, hat), (E.ABS_HAT0Y, hat)], E.EV_FF: [E.FF_RUMBLE]},
                              name="Lumos One Gamepad", vendor=0x303A, product=0x4C31, version=0x0100, bustype=E.BUS_USB)
            acc = AbsInfo(0, -32768, 32768, 0, 0, 4096)
            gyr = AbsInfo(0, -2097152, 2097152, 0, 0, 1024)
            self.motion = UInput({E.EV_ABS: [(E.ABS_X, acc), (E.ABS_Y, acc), (E.ABS_Z, acc), (E.ABS_RX, gyr), (E.ABS_RY, gyr), (E.ABS_RZ, gyr)], E.EV_MSC: [E.MSC_TIMESTAMP]},
                                 name="Lumos One Motion Sensors", vendor=0x303A, product=0x4C32, version=0x0100, bustype=E.BUS_USB, input_props=[E.INPUT_PROP_ACCELEROMETER])
            self.mouse = UInput({E.EV_REL: [E.REL_X, E.REL_Y], E.EV_KEY: [E.BTN_LEFT, E.BTN_RIGHT]}, name="Lumos One Gyro Mouse", vendor=0x303A, product=0x4C33)
            log.info("uinput devices created")
        except (OSError, PermissionError) as e:
            log.warning("uinput unavailable (%s) – add the user to group 'input' / install udev rule", e)

    LEFT = {"l": "BTN_TL", "zl": "BTN_TL2", "minus": "BTN_SELECT", "capture": "BTN_TRIGGER_HAPPY1", "lstick": "BTN_THUMBL", "sl": "BTN_TRIGGER_HAPPY2", "sr": "BTN_TRIGGER_HAPPY3"}
    RIGHT = {"a": "BTN_SOUTH", "b": "BTN_EAST", "x": "BTN_WEST", "y": "BTN_NORTH", "r": "BTN_TR", "zr": "BTN_TR2", "plus": "BTN_START", "home": "BTN_MODE", "rstick": "BTN_THUMBR", "sl": "BTN_TRIGGER_HAPPY4", "sr": "BTN_TRIGGER_HAPPY5"}

    def write_input(self, left: Joy | None, right: Joy | None, deadzone: float, swap_ab: bool):
        if not self.pad:
            return
        def dz(v):
            return 0 if abs(v) < deadzone else int(max(-1, min(1, (abs(v) - deadzone) / (1 - deadzone) * math.copysign(1, v))) * 32767)
        if left:
            for i, n in enumerate(P.LEFT_BUTTONS):
                if n in self.LEFT:
                    self.pad.write(E.EV_KEY, getattr(E, self.LEFT[n]), (left.buttons >> i) & 1)
            hx = ((left.buttons >> 3) & 1) - ((left.buttons >> 2) & 1)
            hy = ((left.buttons >> 1) & 1) - (left.buttons & 1)
            self.pad.write(E.EV_ABS, E.ABS_HAT0X, hx)
            self.pad.write(E.EV_ABS, E.ABS_HAT0Y, hy)
            self.pad.write(E.EV_ABS, E.ABS_X, dz(left.stick[0]))
            self.pad.write(E.EV_ABS, E.ABS_Y, -dz(left.stick[1]))
            self.pad.write(E.EV_ABS, E.ABS_Z, int(left.trigger * 255))
        if right:
            for i, n in enumerate(P.RIGHT_BUTTONS):
                code = self.RIGHT.get(n)
                if swap_ab and n in ("a", "b"):
                    code = self.RIGHT["b" if n == "a" else "a"]
                if code:
                    self.pad.write(E.EV_KEY, getattr(E, code), (right.buttons >> i) & 1)
            self.pad.write(E.EV_ABS, E.ABS_RX, dz(right.stick[0]))
            self.pad.write(E.EV_ABS, E.ABS_RY, -dz(right.stick[1]))
            self.pad.write(E.EV_ABS, E.ABS_RZ, int(right.trigger * 255))
        self.pad.syn()

    def write_motion(self, j: Joy, t_us: int):
        if not self.motion:
            return
        for code, v in zip((E.ABS_X, E.ABS_Y, E.ABS_Z), j.accel):
            self.motion.write(E.EV_ABS, code, int(v * 4096))
        for code, v in zip((E.ABS_RX, E.ABS_RY, E.ABS_RZ), j.gyro):
            self.motion.write(E.EV_ABS, code, int(v * 1024))
        self.motion.write(E.EV_MSC, E.MSC_TIMESTAMP, t_us & 0x7FFFFFFF)
        self.motion.syn()

    def write_mouse(self, dx, dy):
        if self.mouse and (dx or dy):
            self.mouse.write(E.EV_REL, E.REL_X, int(dx))
            self.mouse.write(E.EV_REL, E.REL_Y, int(dy))
            self.mouse.syn()


def quat_to_euler(q):
    w, x, y, z = q
    pitch = math.degrees(math.asin(max(-1.0, min(1.0, 2 * (w * y - z * x)))))
    roll = math.degrees(math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)))
    yaw = math.degrees(math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)))
    return pitch, roll, yaw


class ControllerModule(Module):
    name = "controllers"

    def __init__(self, ctx):
        super().__init__(ctx)
        self.joys: dict[str, Joy] = {}  # side -> Joy
        self.links: dict[str, object] = {}  # port -> link
        self.pending: dict[str, float] = {}
        self.external: dict | None = None
        self.vpad = None
        self.settings = {"gyro_enabled": True, "gyro_sensitivity": 1.0, "gyro_as_mouse": False, "stick_deadzone": 0.08, "swap_ab": False}
        self.neutral = None
        self.orient = [0.0, 0.0, 0.0]
        self.last_gyro_emit = 0.0
        self.prev_buttons = {"left": 0, "right": 0}
        self.cf_t = None

    def methods(self):
        return {
            "controllers.list": lambda _p: self.public_list(),
            "controllers.configure": self.configure,
            "controllers.set": self.configure,
            "controllers.identify": self.identify,
            "controllers.calibrate": self.calibrate,
        }

    async def start(self):
        if self.cfg.simulate:
            return
        self.vpad = await asyncio.get_running_loop().run_in_executor(None, VirtualPad, self.log)
        if serial is not None:
            self.spawn(self._serial_discovery())
        else:
            self.log.warning("pyserial missing: pogo-pin controllers disabled")
        if BleakScanner is not None:
            self.spawn(self._ble_discovery())
        if evdev is not None:
            self.spawn(self._external_discovery())

    # ---------------------------------------------------------------- public state
    def public_list(self):
        if self.cfg.simulate:
            return self.ctx["sim"].controller_list()
        out = [j.public(1) for j in self.joys.values()]
        if self.external:
            out.append({**self.external, "slot": 2})
        return out

    def changed(self):
        self.emit("controllers.changed", self.public_list())

    def links_for(self, target="all"):
        for side, j in self.joys.items():
            if j.link and (target in ("all", side)):
                yield j.link

    # ---------------------------------------------------------------- serial (pogo pins)
    def _match_port(self, p) -> bool:
        desc = f"{p.device} {p.description} {p.manufacturer} {p.product} {p.hwid}".lower()
        return (p.vid == 0x303A) or any(m.lower() in desc for m in self.cfg.serial_match)

    async def _serial_discovery(self):
        loop = asyncio.get_running_loop()
        while True:
            present = {p.device for p in list_ports.comports() if self._match_port(p)}
            for port in present - set(self.links):
                try:
                    link = SerialLink(port, self.cfg.serial_baud, loop, self._on_packet, self._on_close)
                    self.links[port] = link
                    self.pending[port] = time.monotonic()
                    link.send(P.PING, b"\x00\x00\x00\x00")
                    self.log.info("opened %s", port)
                except (OSError, serial.SerialException) as e:
                    self.log.debug("cannot open %s: %s", port, e)
            for port, t0 in list(self.pending.items()):
                if time.monotonic() - t0 > 3:
                    self.log.warning("%s sent no HELLO – not a Lumos Joy?", port)
                    self.pending.pop(port, None)
            await asyncio.sleep(0.5)

    def _on_close(self, link):
        self.links.pop(link.port, None)
        self.pending.pop(link.port, None)
        for side, j in list(self.joys.items()):
            if j.link is link:
                j.link = None
                self.joys.pop(side)
                self.log.info("joy %s detached from %s", side, link.port)
                self.emit("controller.detached", {**j.public(), "transport": "ble" if BleakScanner else "none", "lost": BleakScanner is None})
                self.changed()

    # ---------------------------------------------------------------- BLE
    async def _ble_discovery(self):
        while True:
            try:
                if len(self.joys) < 2:
                    devices = await BleakScanner.discover(timeout=4.0, service_uuids=[self.cfg.ble_service_uuid])
                    for d in devices:
                        if any(getattr(lk, "port", "") == f"ble:{d.address}" for lk in self.links.values()):
                            continue
                        await self._ble_connect(d)
            except Exception as e:  # noqa: BLE001 — BlueZ may be off
                self.log.debug("ble scan: %s", e)
            await asyncio.sleep(3)

    async def _ble_connect(self, dev):
        loop = asyncio.get_running_loop()

        def on_disconnect(c):
            link = self.links.get(f"ble:{c.address}")
            if link:
                loop.call_soon_threadsafe(self._on_close, link)

        client = BleakClient(dev, disconnected_callback=on_disconnect)
        await client.connect(timeout=8)
        link = BleLink(client, self._on_packet)
        self.links[link.port] = link
        await client.start_notify(BLE_TX, link.feed)
        link.send(P.PING, b"\x00\x00\x00\x00")

    # ---------------------------------------------------------------- packets
    def _on_packet(self, link, pkt: P.Packet):
        f = pkt.fields
        if pkt.type == P.HELLO:
            self.pending.pop(link.port, None)
            side = f["side"]
            if side == "chassis":
                self.ctx["dock"].attach_chassis(link)
                return
            transport = "ble" if isinstance(link, BleLink) else "pogo"
            old = self.joys.get(side)
            j = Joy(side=side, serial=f["serial"], fw=f["fw"], caps=f["caps"], transport=transport, link=link)
            if old and old.link and old.link is not link:
                old.link.close()  # pogo wins over BLE
            self.joys[side] = j
            self.log.info("joy %s (%s, fw %s) via %s", side, j.serial, j.fw, transport)
            link.send(P.CONFIG, b"\xe8\x03\x03\x02\xe8\x03\x00")  # 1000 Hz IMU, ±2000 dps, ±8 g, 1000 Hz input
            if transport == "pogo" or not old:
                self.emit("controller.attached", j.public())
            self.changed()
            return
        j = next((x for x in self.joys.values() if x.link is link), None)
        if not j:
            return
        j.last_seen = time.monotonic()
        if pkt.type == P.INPUT:
            j.buttons, j.stick, j.trigger = f["buttons"], f["stick"], f["trigger"]
            self._handle_buttons(j)
            if self.vpad:
                self.vpad.write_input(self.joys.get("left"), self.joys.get("right"), self.settings["stick_deadzone"], self.settings["swap_ab"])
        elif pkt.type == P.IMU:
            j.accel, j.gyro = f["accel"], f["gyro"]
            q = f.get("quat")
            j.quat = q if q and any(q) else None
            if self.vpad and self.settings["gyro_enabled"]:
                self.vpad.write_motion(j, f["t_us"])
                if self.settings["gyro_as_mouse"]:
                    s = self.settings["gyro_sensitivity"] * 0.06
                    self.vpad.write_mouse(-j.gyro[2] * s, -j.gyro[0] * s)
            if j.side == "right" or "right" not in self.joys:
                self._update_orientation(j)
        elif pkt.type == P.BATTERY:
            was = (j.battery, j.charging)
            j.battery, j.mv, j.charging = f["percent"], f["mv"], f["charging"]
            if was != (j.battery, j.charging):
                self.changed()
        elif pkt.type == P.EVENT:
            if f["code"] == P.EV_HALL:
                self.ctx["dock"].hall_changed(bool(f["value"]))
            elif f["code"] == P.EV_LOW_BATTERY:
                self.emit("controller.low_battery", j.public())
        elif pkt.type == P.LOG:
            self.log.info("[%s] %s", j.side, f["text"])

    def _handle_buttons(self, j: Joy):
        names = P.LEFT_BUTTONS if j.side == "left" else P.RIGHT_BUTTONS
        prev = self.prev_buttons.get(j.side, 0)
        changed = prev ^ j.buttons
        self.prev_buttons[j.side] = j.buttons
        for i, n in enumerate(names):
            if changed >> i & 1:
                pressed = bool(j.buttons >> i & 1)
                if n == "home" and pressed:
                    self.emit("input.home", {})
                if n == "capture" and pressed:
                    self.emit("input.qam", {})

    def _update_orientation(self, j: Joy):
        now = time.monotonic()
        if j.quat:
            pitch, roll, yaw = quat_to_euler(j.quat)
        else:  # complementary filter fallback (accel + gyro)
            dt = 0.0 if self.cf_t is None else min(0.05, now - self.cf_t)
            self.cf_t = now
            ax, ay, az = j.accel
            acc_pitch = math.degrees(math.atan2(-ax, math.hypot(ay, az)))
            acc_roll = math.degrees(math.atan2(ay, az))
            self.orient[0] = 0.98 * (self.orient[0] + j.gyro[1] * dt) + 0.02 * acc_pitch
            self.orient[1] = 0.98 * (self.orient[1] + j.gyro[0] * dt) + 0.02 * acc_roll
            self.orient[2] += j.gyro[2] * dt
            pitch, roll, yaw = self.orient
        if self.neutral is None:
            self.neutral = (pitch, roll, yaw)
        if now - self.last_gyro_emit >= 1 / 60:
            self.last_gyro_emit = now
            n = self.neutral
            self.emit("gyro", {"pitch": round(pitch - n[0], 2), "roll": round(roll - n[1], 2), "yaw": round(yaw - n[2], 2), "gx": round(j.gyro[0], 1), "gy": round(j.gyro[1], 1), "gz": round(j.gyro[2], 1)})

    # ---------------------------------------------------------------- external controller (1×)
    async def _external_discovery(self):
        while True:
            found = None
            for path in sorted(glob.glob("/dev/input/event*")):
                try:
                    d = evdev.InputDevice(path)
                except OSError:
                    continue
                caps = d.capabilities()
                keys = caps.get(E.EV_KEY, [])
                if "lumos" in d.name.lower() or E.EV_ABS not in caps or (E.BTN_SOUTH not in keys and E.BTN_GAMEPAD not in keys):
                    d.close()
                    continue
                bat = self._battery_for(d.name)
                transport = "bt" if d.info.bustype == 0x05 else "usb"
                found = {"id": f"ext-{d.info.vendor:04x}{d.info.product:04x}", "side": "pro", "name": d.name, "transport": transport, "battery": bat[0], "charging": bat[1], "connected": True, "gyro": False}
                d.close()
                break
            if (found or {}).get("id") != (self.external or {}).get("id") or (found and found.get("battery") != self.external.get("battery")):
                had = self.external
                self.external = found
                if found and not had:
                    self.emit("controller.attached", found)
                elif had and not found:
                    self.emit("controller.detached", {**had, "lost": True})
                self.changed()
            await asyncio.sleep(2)

    @staticmethod
    def _battery_for(name: str):
        for ps in glob.glob("/sys/class/power_supply/*"):
            if read(f"{ps}/scope") != "Device":
                continue
            model = (read(f"{ps}/model_name") or "").lower()
            if model and (model in name.lower() or name.lower() in model):
                return read_int(f"{ps}/capacity"), read(f"{ps}/status") == "Charging"
        return None, False

    # ---------------------------------------------------------------- methods
    async def configure(self, p):
        for k in self.settings:
            if k in p and p[k] is not None:
                self.settings[k] = type(self.settings[k])(p[k])
        return dict(self.settings)

    async def identify(self, p):
        if self.cfg.simulate:
            return {"ok": True}
        for j in self.joys.values():
            if j.id == p.get("id") and j.link:
                j.link.send(P.IDENTIFY, b"\x01")
                return {"ok": True}
        raise RpcError("Controller nicht gefunden", "ENOENT")

    async def calibrate(self, p):
        if self.cfg.simulate:
            await asyncio.sleep(1.5)
            return {"ok": True}
        targets = [j for j in self.joys.values() if p.get("id") in (None, j.id)]
        if not targets:
            raise RpcError("Controller nicht gefunden", "ENOENT")
        for j in targets:
            j.link.send(P.CALIBRATE, b"\x03")
        await asyncio.sleep(2.0)
        self.neutral = None
        return {"ok": True}
