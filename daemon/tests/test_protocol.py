import os
import random

from lumosd import protocol as P


def test_cobs_roundtrip_edge_cases():
    cases = [b"", b"\x00", b"\x00\x00", b"\x11\x22\x00\x33", bytes(range(1, 255)), bytes(range(1, 256)), b"\x01" * 254 + b"\x00" + b"\x02" * 300]
    rnd = random.Random(7)
    cases += [bytes(rnd.randrange(256) for _ in range(rnd.randrange(1, 700))) for _ in range(300)]
    for c in cases:
        enc = P.cobs_encode(c)
        assert b"\x00" not in enc
        assert P.cobs_decode(enc) == c


def test_crc_reference_vector():
    assert P.crc16(b"123456789") == 0x29B1  # CRC-16/CCITT-FALSE check value


def test_frames_stream_with_garbage():
    r = P.FrameReader()
    frames = P.encode_frame(P.HELLO, 1, P.body_hello(P.SIDE_RIGHT, (1, 2, 3), "LJR123456789"))
    frames += b"\x13\x37garbage\x00"  # corrupt frame must be skipped
    frames += P.encode_frame(P.INPUT, 2, P.body_input(1000, 0b101, 0.5, -0.25, 1.0))
    frames += P.encode_frame(P.BATTERY, 3, P.body_battery(3870, 77, True, True))
    frames += P.encode_frame(P.IMU, 4, P.body_imu(123456, (0, 0, 1), (10.5, -3.25, 0), (20, 0, -40), (1, 0, 0, 0)))
    pkts = []
    for i in range(0, len(frames), 7):  # arbitrary chunking
        pkts += r.feed(frames[i : i + 7])
    assert [p.type for p in pkts] == [P.HELLO, P.INPUT, P.BATTERY, P.IMU]
    assert r.errors == 1
    h, inp, bat, imu = (p.fields for p in pkts)
    assert h == {"side": "right", "fw": "1.2.3", "serial": "LJR123456789", "caps": 0x1F}
    assert inp["buttons"] == 0b101 and abs(inp["stick"][0] - 0.5) < 1e-4 and inp["trigger"] == 1.0
    assert bat == {"mv": 3870, "percent": 77, "charging": True, "pogo": True, "low": False}
    assert imu["gyro"] == (10.5, -3.25, 0.0) and imu["quat"] == (1.0, 0.0, 0.0, 0.0)


def test_haptic_body_encoding():
    b = P.haptic_body([{"e": 7}, {"w": 85}, {"rtp": [[30, 12], [200, 5]]}], 0.5)
    assert b[0] == 127 and b[1] == 4
    assert b[2:6] == bytes([0, 7, 0, 0])
    assert b[6:10] == bytes([1, 0, 85, 0])
    assert b[10:14] == bytes([2, 30, 12, 0])
    assert b[14:18] == bytes([2, 127, 5, 0])  # amplitude clamped to 127


def test_firmware_vectors_if_built():
    """firmware/test/native_vectors.cpp prints frames encoded by the C++ code (see scripts/check-firmware-protocol.sh)."""
    path = os.environ.get("LUMOS_FW_VECTORS")
    if not path:
        return
    data = bytes.fromhex(open(path).read().strip())
    pkts = P.FrameReader().feed(data)
    assert [p.type for p in pkts] == [P.HELLO, P.INPUT, P.IMU, P.BATTERY, P.EVENT]
    assert pkts[0].fields["serial"] == "LJL000000042"
    assert pkts[1].fields["buttons"] == 0x81
    assert pkts[3].fields["percent"] == 64
