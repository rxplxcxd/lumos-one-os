"""Keyboard → virtual gamepad bridge. Uses the bindings from Einstellungen → Tastatur & Steuerung
(KeyboardEvent.code names) so every controller input can be driven from a keyboard — inside games
too (mode "games": only while a title launched from the library is running, so the shell never
receives input twice). Keyboards are read without grabbing them; typing keeps working."""
from __future__ import annotations

import asyncio
import glob
import re

from .module import Module

try:
    import evdev
    from evdev import ecodes as E
except ImportError:  # pragma: no cover
    evdev = None

_SPECIAL = {
    "ArrowUp": "KEY_UP", "ArrowDown": "KEY_DOWN", "ArrowLeft": "KEY_LEFT", "ArrowRight": "KEY_RIGHT",
    "Enter": "KEY_ENTER", "NumpadEnter": "KEY_KPENTER", "Space": "KEY_SPACE", "Escape": "KEY_ESC", "Backspace": "KEY_BACKSPACE", "Tab": "KEY_TAB",
    "ShiftLeft": "KEY_LEFTSHIFT", "ShiftRight": "KEY_RIGHTSHIFT", "ControlLeft": "KEY_LEFTCTRL", "ControlRight": "KEY_RIGHTCTRL",
    "AltLeft": "KEY_LEFTALT", "AltRight": "KEY_RIGHTALT", "MetaLeft": "KEY_LEFTMETA", "MetaRight": "KEY_RIGHTMETA", "ContextMenu": "KEY_COMPOSE",
    "Home": "KEY_HOME", "End": "KEY_END", "PageUp": "KEY_PAGEUP", "PageDown": "KEY_PAGEDOWN", "Insert": "KEY_INSERT", "Delete": "KEY_DELETE", "CapsLock": "KEY_CAPSLOCK",
    "Minus": "KEY_MINUS", "Equal": "KEY_EQUAL", "BracketLeft": "KEY_LEFTBRACE", "BracketRight": "KEY_RIGHTBRACE", "Semicolon": "KEY_SEMICOLON",
    "Quote": "KEY_APOSTROPHE", "Backquote": "KEY_GRAVE", "Backslash": "KEY_BACKSLASH", "Comma": "KEY_COMMA", "Period": "KEY_DOT", "Slash": "KEY_SLASH", "IntlBackslash": "KEY_102ND",
    "NumpadDecimal": "KEY_KPDOT", "NumpadAdd": "KEY_KPPLUS", "NumpadSubtract": "KEY_KPMINUS", "NumpadMultiply": "KEY_KPASTERISK", "NumpadDivide": "KEY_KPSLASH",
}


def code_to_evdev(code: str) -> str | None:
    """KeyboardEvent.code (layout independent) → evdev key name."""
    if code in _SPECIAL:
        return _SPECIAL[code]
    if m := re.fullmatch(r"Key([A-Z])", code):
        return f"KEY_{m.group(1)}"
    if m := re.fullmatch(r"Digit(\d)", code):
        return f"KEY_{m.group(1)}"
    if m := re.fullmatch(r"Numpad(\d)", code):
        return f"KEY_KP{m.group(1)}"
    if m := re.fullmatch(r"F(\d{1,2})", code):
        return f"KEY_F{m.group(1)}"
    return None


BUTTONS = {"a": "BTN_SOUTH", "b": "BTN_EAST", "x": "BTN_WEST", "y": "BTN_NORTH", "lb": "BTN_TL", "rb": "BTN_TR", "lt": "BTN_TL2", "rt": "BTN_TR2",
           "select": "BTN_SELECT", "start": "BTN_START", "home": "BTN_MODE", "l3": "BTN_THUMBL", "r3": "BTN_THUMBR", "capture": "BTN_TRIGGER_HAPPY1"}


class PadState:
    """Pure state machine: pressed actions → pad button/axis values (unit-tested)."""

    def __init__(self):
        self.down: set[str] = set()

    def update(self, action: str, pressed: bool) -> dict:
        (self.down.add if pressed else self.down.discard)(action)
        d = self.down
        out = {"keys": {}, "abs": {}}
        if action in BUTTONS:
            out["keys"][BUTTONS[action]] = 1 if pressed else 0
        out["abs"]["ABS_HAT0X"] = ("right" in d) - ("left" in d)
        out["abs"]["ABS_HAT0Y"] = ("down" in d) - ("up" in d)
        out["abs"]["ABS_X"] = (("ls_right" in d) - ("ls_left" in d)) * 32767
        out["abs"]["ABS_Y"] = (("ls_down" in d) - ("ls_up" in d)) * 32767
        out["abs"]["ABS_RX"] = (("rs_right" in d) - ("rs_left" in d)) * 32767
        out["abs"]["ABS_RY"] = (("rs_down" in d) - ("rs_up" in d)) * 32767
        out["abs"]["ABS_Z"] = 255 if "lt" in d else 0
        out["abs"]["ABS_RZ"] = 255 if "rt" in d else 0
        return out


class KeypadModule(Module):
    name = "keypad"

    def __init__(self, ctx):
        super().__init__(ctx)
        self.mode = "games"
        self.keymap: dict[int, str] = {}
        self.state = PadState()
        self.readers: dict[str, asyncio.Task] = {}
        self.shell_visible = True

    def methods(self):
        return {"input.keyboard_pad": self.configure, "input.shell_visible": self.set_visible}

    async def set_visible(self, p):
        self.shell_visible = bool(p.get("visible", True))
        if self.shell_visible:  # release everything when the shell takes over again
            self.state.down.clear()
        return {"ok": True}

    async def configure(self, p):
        self.mode = p.get("mode", self.mode) if p.get("mode") in ("off", "games", "always") else self.mode
        km = {}
        for action, codes in (p.get("bindings") or {}).items():
            for c in codes or []:
                name = code_to_evdev(c)
                if name and evdev is not None and hasattr(E, name):
                    km.setdefault(getattr(E, name), action)
        if p.get("bindings") is not None:
            self.keymap = km
        return {"mode": self.mode, "keys": len(self.keymap)}

    async def start(self):
        if evdev is not None and not self.cfg.simulate:
            self.spawn(self._discover())

    def _active(self):
        if self.mode == "off":
            return False
        if self.mode == "always":
            return True
        # a game has the Gamescope focus: the shell was handed off, or a tracked title is running
        return not self.shell_visible or bool(self.ctx["library"].running)

    async def _discover(self):
        while True:
            for path in glob.glob("/dev/input/event*"):
                if path in self.readers:
                    continue
                try:
                    d = evdev.InputDevice(path)
                    keys = d.capabilities().get(E.EV_KEY, [])
                    if "lumos" in d.name.lower() or E.KEY_A not in keys or E.KEY_ENTER not in keys:
                        d.close()
                        continue
                except OSError:
                    continue
                self.readers[path] = self.spawn(self._read(path, d))
            await asyncio.sleep(3)

    async def _read(self, path, dev):
        try:
            async for ev in dev.async_read_loop():
                if ev.type != E.EV_KEY or ev.value == 2:  # ignore autorepeat
                    continue
                action = self.keymap.get(ev.code)
                if not action or not self._active():
                    continue
                vpad = self.ctx["controllers"].vpad
                if action == "home" and ev.value == 1:
                    self.emit("input.home", {})
                if not vpad:
                    continue
                out = self.state.update(action, ev.value == 1)
                for k, v in out["keys"].items():
                    vpad.key(k, v)
                for k, v in out["abs"].items():
                    vpad.axis(k, v)
                vpad.syn()
        except OSError:
            pass
        finally:
            self.readers.pop(path, None)
            dev.close()
