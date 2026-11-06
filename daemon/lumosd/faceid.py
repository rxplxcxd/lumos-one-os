"""Face ID: Howdy (IR face authentication) + V4L2/OpenCV preview & face detection.

verify():  [optional OpenCV pre-detection → 'detected'] → Howdy compare.py (via lumos-priv) → matched/failed
enroll():  OpenCV head-turn coverage ring (preview frames) → `howdy add` (via lumos-priv)
Models live in Howdy's model store and never leave the device."""
from __future__ import annotations

import asyncio
import base64
import configparser
import glob
import math
import re
import time

from .module import Module
from .server import RpcError
from .util import priv, run, which

try:
    import cv2
except ImportError:  # pragma: no cover
    cv2 = None

HOWDY_EXIT = {
    0: None,
    1: "Face ID fehlgeschlagen",
    10: "Kein Gesicht eingerichtet",
    11: "Gesicht nicht erkannt",
    12: "Abgebrochen",
    13: "Bild zu dunkel – IR-Emitter prüfen",
    14: "IR-Kamera nicht gefunden",
}


class Camera:
    """Short-lived OpenCV capture used for preview/detection (released before Howdy runs)."""

    def __init__(self, device: str):
        self.device = device
        self.cap = None
        self.cascade = None

    def open(self):
        if cv2 is None:
            raise RuntimeError("OpenCV nicht installiert")
        idx = int(re.sub(r"\D", "", self.device)) if self.device.startswith("/dev/video") else self.device
        self.cap = cv2.VideoCapture(idx, cv2.CAP_V4L2)
        if not self.cap.isOpened():
            raise RuntimeError(f"Kamera {self.device} lässt sich nicht öffnen")
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 360)
        for path in (getattr(cv2, "data", None) and cv2.data.haarcascades, "/usr/share/opencv4/haarcascades/", "/usr/share/opencv/haarcascades/"):
            if path:
                c = cv2.CascadeClassifier(f"{path}haarcascade_frontalface_default.xml")
                if not c.empty():
                    self.cascade = c
                    break
        return self

    def frame(self):
        ok, img = self.cap.read()
        if not ok:
            return None, None
        gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        face = None
        if self.cascade is not None:
            small = cv2.resize(gray, (320, 180))
            faces = self.cascade.detectMultiScale(cv2.equalizeHist(small), 1.15, 5, minSize=(40, 40))
            if len(faces):
                x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
                face = {"x": x / 320, "y": y / 180, "w": w / 320, "h": h / 180}
        return gray, face

    @staticmethod
    def jpeg(gray, width=320):
        h = int(gray.shape[0] * width / gray.shape[1])
        ok, buf = cv2.imencode(".jpg", cv2.resize(gray, (width, h)), [cv2.IMWRITE_JPEG_QUALITY, 70])
        return base64.b64encode(buf).decode() if ok else None

    def close(self):
        if self.cap is not None:
            self.cap.release()
            self.cap = None


class FaceIdModule(Module):
    name = "faceid"

    def __init__(self, ctx):
        super().__init__(ctx)
        self.lock = asyncio.Lock()
        self.preview_task = None
        self.enabled = True
        self.device = self.cfg.ir_device or self._howdy_device()

    def methods(self):
        return {
            "faceid.status": self.status,
            "faceid.verify": self.verify,
            "faceid.enroll": self.enroll,
            "faceid.remove": self.remove,
            "faceid.clear": self.clear,
            "faceid.preview": self.preview,
            "faceid.set": self.set,
            "faceid.test": self.test,
        }

    # ------------------------------------------------------------------ helpers
    def _howdy_conf(self):
        cp = configparser.ConfigParser()
        if self.cfg.howdy_config:
            try:
                cp.read(self.cfg.howdy_config)
            except configparser.Error:
                pass
        return cp

    def _howdy_device(self):
        dev = self._howdy_conf().get("video", "device_path", fallback=None)
        if dev and dev != "none":
            return dev
        ir = [p for p in sorted(glob.glob("/dev/v4l/by-id/*")) if re.search(r"ir|infrared", p, re.I)]
        return ir[0] if ir else None

    def _backend(self):
        if self.cfg.simulate:
            return "sim"
        return "howdy" if which("howdy") and self.cfg.howdy_compare else "none"

    async def _ir_emitter(self):
        if which("linux-enable-ir-emitter"):
            await run(["linux-enable-ir-emitter", "run"], timeout=5, check=False)

    def _state(self, state, **kw):
        self.emit("faceid.state", {"state": state, **kw})

    async def _models(self):
        if self.cfg.simulate:
            return self.ctx["sim"].face_models
        try:
            out = await priv(self.cfg, "faceid-list", self.cfg.user, timeout=15)
        except Exception as e:  # noqa: BLE001
            if "no face model" in str(e).lower() or "no models" in str(e).lower():
                return []
            raise
        models = []
        # Howdy table:  "  0     2024-03-01 12:00:00  Initial model"
        for line in out.splitlines():
            m = re.match(r"\s*(\d+)\s+(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)\s+(.*)$", line)
            if m:
                ts = time.mktime(time.strptime(m.group(2)[:16].replace("T", " "), "%Y-%m-%d %H:%M"))
                models.append({"id": int(m.group(1)), "created": int(ts * 1000), "label": m.group(3).strip()})
        return models

    # ------------------------------------------------------------------ methods
    async def status(self, _p=None):
        backend = self._backend()
        models = []
        err = None
        if backend != "none":
            try:
                models = await self._models()
            except Exception as e:  # noqa: BLE001
                err = str(e)
        return {"available": backend != "none", "backend": backend, "device": self.device or ("/dev/video2 (simuliert)" if backend == "sim" else None), "models": models, "enabled": self.enabled, "ir_emitter": bool(which("linux-enable-ir-emitter")) or backend == "sim", "opencv": cv2 is not None, "error": err}

    async def set(self, p):
        if "enabled" in p:
            self.enabled = bool(p["enabled"])
        return {"enabled": self.enabled}

    async def _predetect(self, seconds=1.2):
        """Look for a face with OpenCV before handing the camera to Howdy (gives the 'detected' state)."""
        if cv2 is None or not self.device:
            return None
        loop = asyncio.get_running_loop()
        cam = Camera(self.device)
        try:
            await loop.run_in_executor(None, cam.open)
            t_end = time.monotonic() + seconds
            while time.monotonic() < t_end:
                _, face = await loop.run_in_executor(None, cam.frame)
                if face:
                    return face
            return False
        except Exception as e:  # noqa: BLE001
            self.log.debug("predetect: %s", e)
            return None
        finally:
            cam.close()

    async def verify(self, p):
        timeout = max(2, min(15, int(p.get("timeout", 8))))
        if self.lock.locked():
            raise RpcError("Face ID ist beschäftigt", "EBUSY")
        async with self.lock:
            await self._stop_preview()
            self._state("searching", reason=p.get("reason"))
            if self.cfg.simulate:
                return await self.ctx["sim"].face_verify(self._state)
            if self._backend() == "none":
                self._state("failed", reason="Face ID nicht verfügbar")
                return {"ok": False, "reason": "Face ID nicht verfügbar (Howdy fehlt)"}
            await self._ir_emitter()
            face = await self._predetect()
            if face is False:
                self._state("failed", reason="Kein Gesicht gefunden")
                return {"ok": False, "reason": "Kein Gesicht gefunden"}
            if face:
                self._state("detected", face=face)
            t0 = time.monotonic()
            try:
                await priv(self.cfg, "faceid-verify", self.cfg.user, timeout=timeout + 5)
                code = 0
            except Exception as e:  # noqa: BLE001
                m = re.search(r"\((\d+)\)", str(e))
                code = int(m.group(1)) if m else 1
            reason = HOWDY_EXIT.get(code, "Face ID fehlgeschlagen")
            if code == 0:
                self._state("matched", ms=int((time.monotonic() - t0) * 1000))
                return {"ok": True, "backend": "howdy"}
            self._state("failed", reason=reason)
            return {"ok": False, "reason": reason, "code": code}

    async def enroll(self, p):
        label = re.sub(r"[^\w äöüÄÖÜß.-]", "", str(p.get("label") or "Lumos"))[:40] or "Lumos"
        async with self.lock:
            await self._stop_preview()
            if self.cfg.simulate:
                return await self.ctx["sim"].face_enroll(label, self._state)
            if self._backend() == "none":
                raise RpcError("Howdy ist nicht installiert", "EUNAVAILABLE")
            await self._ir_emitter()
            await self._coverage_pass()
            self._state("enrolling", progress=0.85, angle=0)
            await priv(self.cfg, "faceid-add", self.cfg.user, label, timeout=60)
            models = await self._models()
            self._state("enrolling", progress=1.0, angle=0)
            self._state("enrolled", id=models[-1]["id"] if models else None)
            return {"ok": True, **(models[-1] if models else {"label": label})}

    async def _coverage_pass(self, seconds=8.0):
        """Head-turn ring like iOS: 24 sectors light up as the face centre sweeps around."""
        if cv2 is None or not self.device:
            for i in range(17):
                self._state("enrolling", progress=i / 20, angle=i / 20 * math.tau)
                await asyncio.sleep(0.25)
            return
        loop = asyncio.get_running_loop()
        cam = Camera(self.device)
        sectors = set()
        center = None
        try:
            await loop.run_in_executor(None, cam.open)
            t_end = time.monotonic() + seconds
            while time.monotonic() < t_end and len(sectors) < 20:
                gray, face = await loop.run_in_executor(None, cam.frame)
                if gray is None:
                    continue
                jpg = cam.jpeg(gray)
                if jpg:
                    self.emit("faceid.frame", {"jpeg": jpg, "face": face})
                if face:
                    cx, cy = face["x"] + face["w"] / 2, face["y"] + face["h"] / 2
                    if center is None:
                        center = (cx, cy)
                    dx, dy = cx - center[0], cy - center[1]
                    if math.hypot(dx, dy) > 0.035:
                        ang = math.atan2(dy, dx) % math.tau
                        sectors.add(int(ang / math.tau * 24))
                        self._state("enrolling", progress=min(0.8, len(sectors) / 24), angle=ang)
        finally:
            cam.close()

    async def remove(self, p):
        if self.cfg.simulate:
            self.ctx["sim"].face_models[:] = [m for m in self.ctx["sim"].face_models if m["id"] != p.get("id")]
            return {"ok": True}
        mid = int(p["id"])
        await priv(self.cfg, "faceid-remove", self.cfg.user, str(mid), timeout=15)
        return {"ok": True}

    async def clear(self, _p):
        if self.cfg.simulate:
            self.ctx["sim"].face_models.clear()
            return {"ok": True}
        await priv(self.cfg, "faceid-clear", self.cfg.user, timeout=15)
        return {"ok": True}

    async def test(self, _p):
        if self.cfg.simulate:
            return {"ok": True, "detail": "Simulierte IR-Kamera 640×360"}
        if not self.device:
            return {"ok": False, "detail": "Keine IR-Kamera konfiguriert (howdy config: device_path)"}
        if which("v4l2-ctl"):
            code, out, err = await run(["v4l2-ctl", "-d", self.device, "--get-fmt-video"], timeout=5, check=False)
            if code != 0:
                return {"ok": False, "detail": (err or out).strip()[:200]}
            m = re.search(r"Width/Height\s*:\s*(\d+)/(\d+)", out)
            return {"ok": True, "detail": f"{self.device} · {m.group(1)}×{m.group(2)}" if m else self.device}
        face = await self._predetect(1.0)
        return {"ok": face is not None, "detail": "Gesicht erkannt" if face else "Kamera OK" if face is False else "Kamera nicht lesbar"}

    # ------------------------------------------------------------------ preview stream
    async def preview(self, p):
        if p.get("on"):
            if not self.preview_task and not self.cfg.simulate and cv2 is not None and self.device and not self.lock.locked():
                self.preview_task = self.spawn(self._preview_loop())
        else:
            await self._stop_preview()
        return {"ok": True, "streaming": bool(self.preview_task)}

    async def _stop_preview(self):
        if self.preview_task:
            self.preview_task.cancel()
            try:
                await self.preview_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self.preview_task = None

    async def _preview_loop(self):
        loop = asyncio.get_running_loop()
        cam = Camera(self.device)
        try:
            await self._ir_emitter()
            await loop.run_in_executor(None, cam.open)
            t_end = time.monotonic() + 60
            while time.monotonic() < t_end:
                gray, face = await loop.run_in_executor(None, cam.frame)
                if gray is not None:
                    self.emit("faceid.frame", {"jpeg": cam.jpeg(gray), "face": face})
                await asyncio.sleep(1 / 15)
        finally:
            cam.close()
            self.preview_task = None
