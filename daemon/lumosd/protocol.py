"""Lumos Joy binary protocol (must match firmware/include/lumos_protocol.h).

Frame on the wire:  COBS( type:u8 | seq:u8 | body… | crc16:u16le ) 0x00
CRC: CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over type|seq|body.
All multi-byte integers are little-endian.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

# device -> host
HELLO = 0x01
INPUT = 0x02
IMU = 0x03
BATTERY = 0x04
EVENT = 0x05
ACK = 0x06
LOG = 0x07
# host -> device
HAPTIC = 0x81
CONFIG = 0x82
CALIBRATE = 0x83
IDENTIFY = 0x84
PING = 0x85
BOOTLOADER = 0x86

SIDE_LEFT, SIDE_RIGHT, SIDE_CHASSIS = 0, 1, 2
SIDE_NAMES = {SIDE_LEFT: "left", SIDE_RIGHT: "right", SIDE_CHASSIS: "chassis"}

CAP_IMU, CAP_MAG, CAP_HAPTICS, CAP_TOUCH, CAP_HALL = 1, 2, 4, 8, 16

EV_POGO_ATTACH, EV_POGO_DETACH, EV_HALL, EV_LOW_BATTERY = 1, 2, 3, 4

HAPTIC_EFFECT, HAPTIC_WAIT, HAPTIC_RTP = 0, 1, 2

# Per-half button bits. Left: d-pad/L/ZL/−/capture/stick; right: face/R/ZR/+/home/stick.
LEFT_BUTTONS = ["up", "down", "left", "right", "l", "zl", "minus", "capture", "lstick", "sl", "sr"]
RIGHT_BUTTONS = ["a", "b", "x", "y", "r", "zr", "plus", "home", "rstick", "sl", "sr"]

GYRO_LSB_PER_DPS = 16.0   # gyro i16 unit = 1/16 °/s  (±2048 °/s)
ACCEL_LSB_PER_G = 1000.0  # accel i16 unit = 1 mg
MAG_LSB_PER_UT = 10.0     # mag i16 unit = 0.1 µT
QUAT_SCALE = 16384.0      # Q14


def crc16(data: bytes, crc: int = 0xFFFF) -> int:
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def cobs_encode(data: bytes) -> bytes:
    """Consistent Overhead Byte Stuffing (no zero bytes in the output)."""
    out = bytearray([0])
    code_idx = 0
    code = 1
    for b in data:
        if b == 0:
            out[code_idx] = code
            code_idx = len(out)
            out.append(0)
            code = 1
        else:
            out.append(b)
            code += 1
            if code == 0xFF:
                out[code_idx] = code
                code_idx = len(out)
                out.append(0)
                code = 1
    out[code_idx] = code
    return bytes(out)


def cobs_decode(data: bytes) -> bytes:
    out = bytearray()
    i = 0
    n = len(data)
    while i < n:
        code = data[i]
        if code == 0:
            raise ValueError("zero byte inside COBS frame")
        i += 1
        end = i + code - 1
        if end > n:
            raise ValueError("truncated COBS frame")
        out += data[i:end]
        i = end
        if code < 0xFF and i < n:
            out.append(0)
    return bytes(out)


def encode_frame(ptype: int, seq: int, body: bytes = b"") -> bytes:
    raw = bytes([ptype & 0xFF, seq & 0xFF]) + body
    raw += struct.pack("<H", crc16(raw))
    return cobs_encode(raw) + b"\x00"


@dataclass
class Packet:
    type: int
    seq: int
    body: bytes
    fields: dict = field(default_factory=dict)


def parse_payload(payload: bytes) -> Packet:
    if len(payload) < 4:
        raise ValueError("payload too short")
    data, crc = payload[:-2], struct.unpack("<H", payload[-2:])[0]
    if crc16(data) != crc:
        raise ValueError("crc mismatch")
    p = Packet(data[0], data[1], data[2:])
    p.fields = decode_body(p.type, p.body)
    return p


def decode_body(t: int, b: bytes) -> dict:
    if t == HELLO:
        side, ma, mi, pa = struct.unpack_from("<BBBB", b, 0)
        serial = b[4:16].split(b"\x00", 1)[0].decode("ascii", "replace")
        caps = struct.unpack_from("<H", b, 16)[0]
        return {"side": SIDE_NAMES.get(side, "unknown"), "fw": f"{ma}.{mi}.{pa}", "serial": serial, "caps": caps}
    if t == INPUT:
        t_ms, buttons, sx, sy, trig, touch = struct.unpack("<IIhhBB", b[:14])
        return {"t_ms": t_ms, "buttons": buttons, "stick": (sx / 32767.0, sy / 32767.0), "trigger": trig / 255.0, "touch": touch}
    if t == IMU:
        v = struct.unpack("<I13h", b[:30])
        return {
            "t_us": v[0],
            "accel": tuple(x / ACCEL_LSB_PER_G for x in v[1:4]),
            "gyro": tuple(x / GYRO_LSB_PER_DPS for x in v[4:7]),
            "mag": tuple(x / MAG_LSB_PER_UT for x in v[7:10]),
            "quat": tuple(x / QUAT_SCALE for x in v[10:14]) if len(v) >= 14 else None,
        }
    if t == BATTERY:
        mv, pct, flags = struct.unpack("<HBB", b[:4])
        return {"mv": mv, "percent": pct, "charging": bool(flags & 1), "pogo": bool(flags & 2), "low": bool(flags & 4)}
    if t == EVENT:
        code, value = struct.unpack("<BB", b[:2])
        return {"code": code, "value": value}
    if t == ACK:
        acked, status = struct.unpack("<BB", b[:2])
        return {"acked": acked, "status": status}
    if t == LOG:
        return {"text": b.decode("utf-8", "replace")}
    return {}


def haptic_body(steps: list[dict], intensity: float) -> bytes:
    """Encode a shared/haptics.json step list (max 16 primitive steps)."""
    prim: list[tuple[int, int, int]] = []
    for s in steps:
        if "e" in s:
            prim.append((HAPTIC_EFFECT, int(s["e"]) & 0xFF, 0))
        elif "w" in s:
            prim.append((HAPTIC_WAIT, 0, int(s["w"])))
        elif "rtp" in s:
            for amp, ms in s["rtp"]:
                prim.append((HAPTIC_RTP, max(0, min(127, int(amp))), int(ms)))
    prim = prim[:16]
    body = struct.pack("<BB", max(0, min(255, int(intensity * 255))), len(prim))
    for kind, val, ms in prim:
        body += struct.pack("<BBH", kind, val, min(ms, 65535))
    return body


class FrameReader:
    """Incremental decoder: feed() bytes, iterate complete packets. Corrupt frames are counted and skipped."""

    MAX_FRAME = 512

    def __init__(self) -> None:
        self.buf = bytearray()
        self.errors = 0

    def feed(self, data: bytes) -> list[Packet]:
        out: list[Packet] = []
        for byte in data:
            if byte == 0:
                if self.buf:
                    try:
                        out.append(parse_payload(cobs_decode(bytes(self.buf))))
                    except ValueError:
                        self.errors += 1
                    self.buf.clear()
            else:
                self.buf.append(byte)
                if len(self.buf) > self.MAX_FRAME:
                    self.buf.clear()
                    self.errors += 1
        return out


# helpers used by tests and the simulator ---------------------------------------------------
def body_hello(side: int, fw=(1, 0, 0), serial: str = "LJ0000000000", caps: int = 0x1F) -> bytes:
    return struct.pack("<BBBB", side, *fw) + serial.encode()[:12].ljust(12, b"\x00") + struct.pack("<H", caps)


def body_input(t_ms: int, buttons: int, sx: float, sy: float, trigger: float, touch: int = 0) -> bytes:
    return struct.pack("<IIhhBB", t_ms, buttons, int(sx * 32767), int(sy * 32767), int(trigger * 255), touch)


def body_battery(mv: int, pct: int, charging: bool, pogo: bool) -> bytes:
    return struct.pack("<HBB", mv, pct, (1 if charging else 0) | (2 if pogo else 0) | (4 if pct <= 10 else 0))


def body_imu(t_us: int, accel, gyro, mag=(0, 0, 0), quat=(1, 0, 0, 0)) -> bytes:
    vals = [int(a * ACCEL_LSB_PER_G) for a in accel] + [int(g * GYRO_LSB_PER_DPS) for g in gyro] + [int(m * MAG_LSB_PER_UT) for m in mag] + [int(q * QUAT_SCALE) for q in quat]
    vals = [max(-32768, min(32767, v)) for v in vals]
    return struct.pack("<I13h", t_us, *vals)
