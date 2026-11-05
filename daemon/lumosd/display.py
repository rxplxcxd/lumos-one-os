"""Display: backlight, Gamescope runtime atoms (FPS limit, upscaler, sharpness) and the session
env consumed by system/lumos-session for settings that need a compositor restart."""
from __future__ import annotations

import glob

from .module import Module
from .util import priv, read_int, run, which

FILTERS = {"linear": 0, "pixel": 1, "fsr": 2, "nis": 3}  # gamescope GamescopeUpscaleFilter order: LINEAR, NEAREST, FSR, NIS
TV_RES = {"1080p": (1920, 1080), "1440p": (2560, 1440), "4k": (3840, 2160)}


class DisplayModule(Module):
    name = "display"

    def __init__(self, ctx):
        super().__init__(ctx)
        self.state = {"brightness": 72, "fps_limit": 0, "fsr": True, "fsr_sharpness": 2, "refresh": 165, "hdr": False, "tv_resolution": "auto", "tv_upscaler": "fsr", "auto_brightness": False}

    def methods(self):
        return {"display.get": self.get, "display.set": self.set}

    async def get(self, _p=None):
        return {**self.state, **self.ctx["dock"].status()}

    @staticmethod
    def backlight():
        for b in sorted(glob.glob("/sys/class/backlight/*")):
            return b
        return None

    async def set(self, p):
        changed = {k: p[k] for k in self.state if k in p and p[k] is not None and p[k] != self.state[k]}
        self.state.update(changed)
        if self.cfg.simulate:
            return self.state
        if "brightness" in changed:
            await self._brightness(int(changed["brightness"]))
        if any(k in changed for k in ("fps_limit", "fsr", "fsr_sharpness", "tv_upscaler")):
            await self.apply_gamescope()
        if any(k in changed for k in ("refresh", "hdr", "tv_resolution", "tv_upscaler", "fsr_sharpness")):
            self.write_session_env()
        return self.state

    async def _brightness(self, pct):
        bl = self.backlight()
        if not bl:
            return
        mx = read_int(f"{bl}/max_brightness", 255)
        raw = max(1, round(mx * (pct / 100) ** 2.2))  # perceptual curve for OLED
        try:
            with open(f"{bl}/brightness", "w") as f:  # works with the udev rule (group video)
                f.write(str(raw))
        except OSError:
            try:
                await priv(self.cfg, "brightness", str(raw))
            except Exception as e:  # noqa: BLE001
                self.log.warning("brightness: %s", e)

    async def _xprop(self, atom, value: int | None):
        if not which("xprop"):
            return
        base = ["xprop", "-display", self.cfg.gamescope_display, "-root"]
        try:
            if value is None:
                await run(base + ["-remove", atom], timeout=3, check=False)
            else:
                await run(base + ["-f", atom, "32c", "-set", atom, str(int(value))], timeout=3)
        except Exception as e:  # noqa: BLE001 — gamescope not running (desktop dev)
            self.log.debug("xprop %s: %s", atom, e)

    async def apply_gamescope(self):
        s = self.state
        docked = bool(self.ctx["dock"].status().get("docked"))
        await self._xprop("GAMESCOPE_FPS_LIMIT", s["fps_limit"] or None)
        filt = FILTERS.get(s["tv_upscaler"] if docked else ("fsr" if s["fsr"] else "linear"), 2)
        await self._xprop("GAMESCOPE_SCALING_FILTER", filt)
        await self._xprop("GAMESCOPE_SHARPNESS", s["fsr_sharpness"])
        await self._xprop("GAMESCOPE_FSR_SHARPNESS", s["fsr_sharpness"])  # older gamescope releases

    def write_session_env(self):
        s = self.state
        docked = bool(self.ctx["dock"].status().get("docked"))
        w, h = TV_RES.get(s["tv_resolution"], (0, 0))
        env = {
            "LUMOS_REFRESH": s["refresh"],
            "LUMOS_HDR": int(bool(s["hdr"])),
            "LUMOS_MODE": "tv" if docked else "handheld",
            "LUMOS_TV_W": w,
            "LUMOS_TV_H": h,
            "LUMOS_UPSCALER": s["tv_upscaler"],
            "LUMOS_SHARPNESS": s["fsr_sharpness"],
        }
        path = self.cfg.config_dir / "session.env"
        tmp = path.with_suffix(".tmp")
        tmp.write_text("".join(f"{k}={v}\n" for k, v in env.items()))
        tmp.replace(path)
