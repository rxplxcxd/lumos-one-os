"""In-memory ring buffer of daemon log records (Terminal → Logs, Entwickler-Panel)."""
from __future__ import annotations

import collections
import logging
import time

BUFFER: collections.deque = collections.deque(maxlen=2000)


class RingHandler(logging.Handler):
    def emit(self, record):
        try:
            BUFFER.append({"t": record.created, "level": record.levelname, "name": record.name, "msg": record.getMessage()})
        except Exception:  # noqa: BLE001
            pass


def install():
    h = RingHandler(level=logging.DEBUG)
    logging.getLogger().addHandler(h)


def tail(limit=300, level=None, since=0.0):
    rows = [r for r in BUFFER if r["t"] > since and (not level or r["level"] == level)]
    return rows[-limit:]


def now():
    return time.time()
