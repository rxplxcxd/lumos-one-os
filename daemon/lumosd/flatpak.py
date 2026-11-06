"""Flatpak install/uninstall jobs with live progress parsed from the CLI (run inside a PTY so
flatpak renders its progress bar), sequential job queue and cancellation."""
from __future__ import annotations

import asyncio
import fcntl
import itertools
import os
import pty
import re
import signal
import struct
import termios
import time

from .module import Module
from .server import RpcError
from .util import ANSI, run, which

APP_ID = re.compile(r"^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*){2,}$")
STEP = re.compile(r"(Installing|Updating|Uninstalling|Installiere|Aktualisiere|Deinstalliere)\D{0,3}(\d+)/(\d+)", re.I)
PCT = re.compile(r"(\d{1,3})\s?%")
SPEED = re.compile(r"(\d+(?:[.,]\d+)?\s?[kKMG]?i?B/s)")
STAGES = {"installing": "Installieren", "updating": "Aktualisieren", "uninstalling": "Deinstallieren", "installiere": "Installieren", "aktualisiere": "Aktualisieren", "deinstalliere": "Deinstallieren"}


class ProgressParser:
    """Turns raw flatpak terminal output into monotonic overall progress (0–100)."""

    def __init__(self, op: str):
        self.op = op
        self.step, self.total = 1, 1
        self.percent = 0.0
        self.stage = "Abhängigkeiten auflösen" if op == "install" else "Wird vorbereitet"
        self.speed = None
        self.lines: list[str] = []

    def feed(self, chunk: str) -> bool:
        changed = False
        for line in re.split(r"[\r\n]+", ANSI.sub("", chunk)):
            line = line.strip()
            if not line:
                continue
            self.lines = (self.lines + [line])[-40:]
            low = line.lower()
            if "looking for matches" in low or "suche nach" in low:
                self.stage, changed = "Suche nach Treffern", True
            m = STEP.search(line)
            if m:
                self.step, self.total = int(m.group(2)), max(1, int(m.group(3)))
                self.stage = f"{STAGES.get(m.group(1).lower(), m.group(1))} {self.step}/{self.total}"
                changed = True
            pcts = PCT.findall(line)
            if pcts:
                p = min(100, int(pcts[-1]))
                overall = ((self.step - 1) + p / 100) / self.total * 100
                if overall >= self.percent:
                    self.percent = overall
                    changed = True
            s = SPEED.search(line)
            if s:
                self.speed = s.group(1).replace(",", ".")
            if "complete" in low or "abgeschlossen" in low:
                self.percent, changed = 100.0, True
        return changed

    def error_text(self) -> str:
        for line in reversed(self.lines):
            if line.lower().startswith(("error", "fehler")):
                return line.split(":", 1)[-1].strip()
        return self.lines[-1] if self.lines else "flatpak fehlgeschlagen"


class Job:
    _ids = itertools.count(1)

    def __init__(self, op, app_id, cmd, name=None, icon=None):
        self.job = f"fp-{next(self._ids)}"
        self.op, self.id, self.cmd, self.name, self.icon = op, app_id, cmd, name or app_id, icon
        self.parser = ProgressParser(op)
        self.proc = None
        self.cancelled = False
        self.queued_at = time.time()

    def snapshot(self, stage=None):
        return {"job": self.job, "id": self.id, "op": self.op, "name": self.name, "icon": self.icon, "percent": round(self.parser.percent, 1), "stage": stage or self.parser.stage, "speed": self.parser.speed}


class FlatpakModule(Module):
    name = "flatpak"

    def __init__(self, ctx):
        super().__init__(ctx)
        self.jobs: dict[str, Job] = {}
        self.queue: asyncio.Queue[Job] = asyncio.Queue()
        self.remote_ready = False

    def methods(self):
        return {
            "flatpak.list": self.list_apps,
            "flatpak.install": self.install,
            "flatpak.uninstall": self.uninstall,
            "flatpak.update": self.update,
            "flatpak.cancel": self.cancel,
            "flatpak.jobs": lambda _p: [j.snapshot() for j in self.jobs.values()],
        }

    async def start(self):
        self.spawn(self._worker())

    def available(self):
        return bool(which("flatpak")) and not self.cfg.simulate

    async def list_apps(self, _p=None):
        if not self.available():
            return list(self.ctx["sim"].flatpaks.values()) if self.cfg.simulate else []
        _, out, _ = await run(["flatpak", "list", "--app", "--columns=application,name,version,size,origin,installation"], timeout=20)
        apps = []
        for line in out.splitlines():
            parts = line.split("\t")
            if len(parts) >= 6 and APP_ID.match(parts[0]):
                apps.append({"id": parts[0], "name": parts[1], "version": parts[2], "size": parts[3], "origin": parts[4], "installation": parts[5]})
        return apps

    async def _installation_of(self, app_id):
        for a in await self.list_apps():
            if a["id"] == app_id:
                return a.get("installation", "user")
        return None

    async def _ensure_remote(self):
        if self.remote_ready:
            return
        await run(["flatpak", "remote-add", "--user", "--if-not-exists", "flathub", "https://dl.flathub.org/repo/flathub.flatpakrepo"], timeout=60)
        self.remote_ready = True

    def _enqueue(self, job: Job):
        self.jobs[job.job] = job
        self.emit("flatpak.progress", job.snapshot("In Warteschlange" if self.queue.qsize() or any(j.proc for j in self.jobs.values()) else None))
        self.queue.put_nowait(job)
        return {"job": job.job}

    async def install(self, p):
        app_id = p.get("id", "")
        if not APP_ID.match(app_id):
            raise RpcError("Ungültige App-ID", "EINVAL")
        remote = p.get("remote", "flathub")
        if not re.match(r"^[\w.-]+$", remote):
            raise RpcError("Ungültiges Remote", "EINVAL")
        return self._enqueue(Job("install", app_id, ["flatpak", "install", "--user", "-y", remote, app_id], p.get("name"), p.get("icon")))

    def install_file(self, path: str, name: str | None = None):
        flag = "--bundle" if path.endswith(".flatpak") else "--from"
        return self._enqueue(Job("install", os.path.basename(path), ["flatpak", "install", "--user", "-y", flag, path], name))

    async def uninstall(self, p):
        app_id = p.get("id", "")
        if not APP_ID.match(app_id):
            raise RpcError("Ungültige App-ID", "EINVAL")
        inst = "user"
        if self.available():
            inst = await self._installation_of(app_id) or "user"
        scope = "--system" if inst == "system" else "--user"
        return self._enqueue(Job("uninstall", app_id, ["flatpak", "uninstall", scope, "-y", app_id], p.get("name")))

    async def update(self, p):
        app_id = p.get("id")
        if app_id and not APP_ID.match(app_id):
            raise RpcError("Ungültige App-ID", "EINVAL")
        return self._enqueue(Job("update", app_id or "all", ["flatpak", "update", "-y", *([app_id] if app_id else [])], p.get("name") or "Alle Apps"))

    async def cancel(self, p):
        job = self.jobs.get(p.get("job"))
        if not job:
            return {"ok": False}
        job.cancelled = True
        if job.proc and job.proc.returncode is None:
            try:
                os.killpg(job.proc.pid, signal.SIGINT)
                await asyncio.sleep(2.5)
                if job.proc.returncode is None:
                    os.killpg(job.proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        return {"ok": True}

    async def _worker(self):
        while True:
            job = await self.queue.get()
            if job.cancelled:
                self.jobs.pop(job.job, None)
                self.emit("flatpak.error", {"job": job.job, "id": job.id, "op": job.op, "message": "Abgebrochen"})
                continue
            try:
                if self.available():
                    if job.op == "install":
                        await self._ensure_remote()
                    code = await self._run_pty(job)
                else:
                    code = await self._simulate(job)
                if job.cancelled:
                    raise RuntimeError("Abgebrochen")
                if code != 0:
                    raise RuntimeError(job.parser.error_text())
                if self.cfg.simulate:
                    self.ctx["sim"].flatpak_done(job)
                self.emit("flatpak.done", {"job": job.job, "id": job.id, "op": job.op})
            except Exception as e:  # noqa: BLE001
                self.emit("flatpak.error", {"job": job.job, "id": job.id, "op": job.op, "message": str(e)})
            finally:
                self.jobs.pop(job.job, None)

    async def _run_pty(self, job: Job) -> int:
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 200, 0, 0))
        env = {**os.environ, "TERM": "xterm-256color", "LC_ALL": "C.UTF-8", "LANG": "C.UTF-8"}
        job.proc = await asyncio.create_subprocess_exec(*job.cmd, stdin=slave, stdout=slave, stderr=slave, env=env, start_new_session=True)
        os.close(slave)
        loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue()

        def on_readable():
            try:
                data = os.read(master, 65536)
            except OSError:
                data = b""
            q.put_nowait(data)
            if not data:
                loop.remove_reader(master)

        loop.add_reader(master, on_readable)
        last_emit = 0.0
        try:
            while True:
                data = await q.get()
                if not data:
                    break
                if job.parser.feed(data.decode("utf-8", "replace")):
                    now = time.monotonic()
                    if now - last_emit > 0.12:
                        last_emit = now
                        self.emit("flatpak.progress", job.snapshot())
        finally:
            try:
                loop.remove_reader(master)
            except (ValueError, OSError):
                pass
            os.close(master)
        return await job.proc.wait()

    async def _simulate(self, job: Job) -> int:
        stages = ["Runtime herunterladen", "App herunterladen", "Installieren"] if job.op == "install" else ["Deinstallieren"]
        for i in range(0, 101, 3 if job.op == "install" else 12):
            if job.cancelled:
                return 1
            job.parser.percent = float(i)
            job.parser.stage = stages[min(len(stages) - 1, i * len(stages) // 101)]
            job.parser.speed = "12.4 MB/s" if job.op == "install" else None
            self.emit("flatpak.progress", job.snapshot())
            await asyncio.sleep(0.15)
        return 0
