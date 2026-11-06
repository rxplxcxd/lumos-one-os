from lumosd.keypad import PadState, code_to_evdev
from lumosd.padsdb import classify


def test_browser_codes_map_to_evdev_names():
    assert code_to_evdev("KeyW") == "KEY_W"
    assert code_to_evdev("Digit3") == "KEY_3"
    assert code_to_evdev("ArrowUp") == "KEY_UP"
    assert code_to_evdev("Numpad8") == "KEY_KP8"
    assert code_to_evdev("F12") == "KEY_F12"
    assert code_to_evdev("ShiftLeft") == "KEY_LEFTSHIFT"
    assert code_to_evdev("Whatever") is None


def test_pad_state_combines_directions_and_sticks():
    s = PadState()
    out = s.update("up", True)
    assert out["abs"]["ABS_HAT0Y"] == -1
    out = s.update("left", True)
    assert out["abs"]["ABS_HAT0X"] == -1 and out["abs"]["ABS_HAT0Y"] == -1
    out = s.update("up", False)
    assert out["abs"]["ABS_HAT0Y"] == 0
    out = s.update("ls_right", True)
    assert out["abs"]["ABS_X"] == 32767
    out = s.update("a", True)
    assert out["keys"] == {"BTN_SOUTH": 1}
    out = s.update("rt", True)
    assert out["keys"] == {"BTN_TR2": 1} and out["abs"]["ABS_RZ"] == 255


def test_controller_classification():
    assert classify(0x054C, 0x0CE6)["model"] == "DualSense"
    assert classify(0x054C, 0x1234)["family"] == "playstation"
    assert classify(0x057E, 0x2009)["family"] == "nintendo"
    assert classify(0x045E, 0x0B13)["family"] == "xbox"
    assert classify(0x1234, 0x5678, "Wireless Controller")["family"] == "playstation"
    assert classify(0x1234, 0x5678, "Cheap Pad")["family"] == "generic"
    assert classify(0x1234, 0x5678, "Xbox Wireless Controller")["family"] == "xbox"
