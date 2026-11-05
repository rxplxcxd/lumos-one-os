"""Over-the-air: discover releases (GitHub Releases API or a static JSON feed) and download
packages with resume support. Stdlib only (urllib)."""
from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path
from typing import Callable

from .manifest import parse_version

UA = "LumosOne-Updater/1.0"


def _get_json(url: str, timeout=20):
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json, application/json", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def find_update(feed_url: str, current: str | None, channel: str = "stable") -> dict | None:
    """feed_url: GitHub `…/releases` endpoint or a JSON list [{version, channel, url, size, notes}]."""
    data = _get_json(feed_url)
    candidates = []
    if isinstance(data, list) and data and "tag_name" in data[0]:  # GitHub releases
        for rel in data:
            if rel.get("draft"):
                continue
            pre = bool(rel.get("prerelease"))
            ch = "beta" if pre else "stable"
            if channel == "stable" and pre:
                continue
            asset = next((a for a in rel.get("assets", []) if a["name"].startswith("lumos-update-") and a["name"].endswith(".zip")), None)
            if not asset:
                continue
            try:
                parse_version(rel["tag_name"])
            except ValueError:
                continue
            candidates.append({"version": rel["tag_name"].lstrip("v"), "channel": ch, "url": asset["browser_download_url"], "size": asset["size"], "notes": rel.get("body") or ""})
    else:
        for e in data if isinstance(data, list) else data.get("releases", []):
            if channel == "stable" and e.get("channel", "stable") != "stable":
                continue
            candidates.append(e)
    if not candidates:
        return None
    best = max(candidates, key=lambda c: parse_version(c["version"]))
    if current and parse_version(best["version"]) <= parse_version(current):
        return None
    return best


def download(url: str, dest: Path, progress: Callable[[str, float], None] | None = None, expected_size: int | None = None) -> Path:
    dest = Path(dest)
    part = dest.with_suffix(dest.suffix + ".part")
    have = part.stat().st_size if part.exists() else 0
    headers = {"User-Agent": UA}
    if have:
        headers["Range"] = f"bytes={have}-"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        if have and r.status != 206:  # server ignored Range → restart
            have = 0
        total = (int(r.headers.get("Content-Length", 0)) + have) or expected_size or 0
        with open(part, "ab" if have else "wb") as f:
            done = have
            while chunk := r.read(1 << 18):
                f.write(chunk)
                done += len(chunk)
                if progress and total:
                    progress("download", done / total * 100)
            f.flush()
            os.fsync(f.fileno())
    os.replace(part, dest)
    return dest
