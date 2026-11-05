"""Shared helpers: async subprocesses, sysfs access, privileged helper calls."""
from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
from pathlib import Path

log = logging.getLogger("lumosd")

ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07")


class CommandError(RuntimeError):
    def __init__(self, cmd, code, out, err):
        self.cmd, self.code, self.out, self.err = cmd, code, out, err
        msg = (err or out or "").strip().splitlines()
        super().__init__(f"{os.path.basename(cmd[0])} fehlgeschlagen ({code}): {msg[-1] if msg else 'kein Output'}")


def which(name: str) -> str | None:
    return shutil.which(name)


async def run(cmd: list[str], timeout: float = 30, check: bool = True, input: bytes | None = None, env: dict | None = None) -> tuple[int, str, str]:
    """Run a command without a shell. Returns (code, stdout, stderr)."""
    if not which(cmd[0]) and not os.path.exists(cmd[0]):
        raise FileNotFoundError(f"{cmd[0]} ist nicht installiert")
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.PIPE if input is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={**os.environ, "LC_ALL": "C", **(env or {})},
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(input), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise CommandError(cmd, -1, "", f"Zeitüberschreitung nach {timeout}s")
    o, e = out.decode(errors="replace"), err.decode(errors="replace")
    if check and proc.returncode != 0:
        raise CommandError(cmd, proc.returncode, o, e)
    return proc.returncode, o, e


async def priv(cfg, *args: str, timeout: float = 30, input: bytes | None = None) -> str:
    """Call the whitelisted privileged helper through sudo (see system/sudoers.d/lumos)."""
    helper = cfg.priv_helper
    if not os.path.exists(helper):
        # development checkout: use the helper next to the daemon
        local = Path(__file__).resolve().parents[1] / "lumos_priv.py"
        if os.geteuid() == 0:
            cmd = ["python3", str(local), *args]
        else:
            raise PermissionError(f"Privilegierter Helfer {helper} fehlt (siehe README: Installation)")
    else:
        cmd = [helper, *args] if os.geteuid() == 0 else ["sudo", "-n", helper, *args]
    _, out, _ = await run(cmd, timeout=timeout, input=input)
    return out


def read(path: str | Path, default: str | None = None) -> str | None:
    try:
        return Path(path).read_text().strip()
    except OSError:
        return default


def read_int(path: str | Path, default: int | None = None) -> int | None:
    v = read(path)
    try:
        return int(v) if v is not None else default
    except ValueError:
        return default


def clamp(v, lo, hi):
    return max(lo, min(hi, v))
