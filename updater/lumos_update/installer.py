"""Atomic A/B-style installer.

/opt/lumos/
  releases/<version>/     immutable, verified trees
  current  -> releases/X  (switched with an atomic rename of a temp symlink)
  previous -> releases/W  (rollback target)
  cache/                  downloads & staging (always cleaned)
"""
from __future__ import annotations

import hashlib
import os
import shutil
import zipfile
from pathlib import Path
from typing import Callable

from .manifest import parse_version, verify
from .package import read_manifest

Progress = Callable[[str, float], None]


class UpdateError(RuntimeError):
    pass


def _dir_size(p: Path) -> int:
    total = 0
    for root, _d, files in os.walk(p):
        for f in files:
            try:
                total += os.lstat(os.path.join(root, f)).st_size
            except OSError:
                pass
    return total


def _fsync_dir(p: Path):
    try:
        fd = os.open(p, os.O_DIRECTORY)
        os.fsync(fd)
        os.close(fd)
    except OSError:
        pass


class Installer:
    def __init__(self, root: Path, public_key: Path | None = None, allow_unsigned: bool = False):
        self.root = Path(root)
        self.releases = self.root / "releases"
        self.cache = self.root / "cache"
        self.public_key = Path(public_key) if public_key else None
        self.allow_unsigned = allow_unsigned
        for d in (self.releases, self.cache):
            d.mkdir(parents=True, exist_ok=True)

    # ---------------------------------------------------------------- state
    def _link(self, name) -> str | None:
        p = self.root / name
        if p.is_symlink():
            return Path(os.readlink(p)).name
        return None

    def current(self) -> str | None:
        return self._link("current")

    def previous(self) -> str | None:
        return self._link("previous")

    def installed(self) -> list[str]:
        out = [p.name for p in self.releases.iterdir() if p.is_dir() and not p.name.startswith(".")]
        return sorted(out, key=lambda v: parse_version(v) if _is_ver(v) else (0, 0, 0, (0, v)))

    def status(self) -> dict:
        return {"current": self.current(), "previous": self.previous(), "releases": self.installed()}

    # ---------------------------------------------------------------- verify + stage
    def verify_package(self, zip_path: Path) -> dict:
        manifest, sig = read_manifest(zip_path)
        if manifest.get("product") != "lumos-one" or manifest.get("format") != 1:
            raise UpdateError("Kein Lumos-One-Updatepaket")
        if sig is None or self.public_key is None or not self.public_key.exists():
            if not self.allow_unsigned:
                raise UpdateError("Paket ist nicht signiert oder kein öffentlicher Schlüssel installiert")
        elif not verify(manifest, sig, self.public_key.read_bytes()):
            raise UpdateError("Signatur ungültig – Paket wurde verändert")
        cur = self.current()
        if cur and _is_ver(cur) and parse_version(manifest["min_version"]) > parse_version(cur):
            raise UpdateError(f"Benötigt mindestens Version {manifest['min_version']}")
        return manifest

    def stage(self, zip_path: Path, progress: Progress | None = None) -> str:
        progress = progress or (lambda *_: None)
        manifest = self.verify_package(zip_path)
        version = manifest["version"]
        target = self.releases / version
        if target.exists():
            return version  # already staged and verified earlier
        staging = self.releases / f".staging-{version}"
        if staging.exists():
            shutil.rmtree(staging)
        staging.mkdir()
        total = sum(f["size"] for f in manifest["files"]) or 1
        done = 0
        try:
            with zipfile.ZipFile(zip_path) as z:
                for f in manifest["files"]:
                    rel = Path(f["path"])
                    if rel.is_absolute() or ".." in rel.parts:
                        raise UpdateError(f"Unsicherer Pfad im Paket: {rel}")
                    dest = staging / rel
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    h = hashlib.sha256()
                    with z.open(f"payload/{rel.as_posix()}") as src, open(dest, "wb") as out:
                        while chunk := src.read(1 << 20):
                            h.update(chunk)
                            out.write(chunk)
                        out.flush()
                        os.fsync(out.fileno())
                    if h.hexdigest() != f["sha256"]:
                        raise UpdateError(f"Prüfsumme falsch: {rel}")
                    os.chmod(dest, f.get("mode", 0o644) & 0o777)
                    done += f["size"]
                    progress("stage", done / total * 100)
            _fsync_dir(staging)
            os.replace(staging, target)
            _fsync_dir(self.releases)
        except BaseException:
            shutil.rmtree(staging, ignore_errors=True)
            raise
        return version

    # ---------------------------------------------------------------- switch
    def _swap(self, name: str, version: str):
        link = self.root / name
        tmp = self.root / f".{name}.tmp"
        if tmp.is_symlink() or tmp.exists():
            tmp.unlink()
        os.symlink(Path("releases") / version, tmp)
        os.replace(tmp, link)  # atomic on POSIX
        _fsync_dir(self.root)

    def activate(self, version: str):
        if not (self.releases / version).is_dir():
            raise UpdateError(f"Version {version} ist nicht installiert")
        cur = self.current()
        if cur == version:
            return
        if cur:
            self._swap("previous", cur)
        self._swap("current", version)

    def rollback(self) -> str:
        prev = self.previous()
        if not prev or not (self.releases / prev).is_dir():
            raise UpdateError("Keine vorherige Version vorhanden")
        cur = self.current()
        self._swap("current", prev)
        if cur:
            self._swap("previous", cur)
        return prev

    def install(self, zip_path: Path, progress: Progress | None = None) -> str:
        v = self.stage(zip_path, progress)
        self.activate(v)
        return v

    # ---------------------------------------------------------------- cleanup
    def cleanup(self, keep: int = 2) -> dict:
        removed, freed = [], 0
        protected = {self.current(), self.previous()}
        vers = [v for v in self.installed() if v not in protected]
        for v in vers[: max(0, len(vers) - max(0, keep - len(protected - {None})))]:
            p = self.releases / v
            freed += _dir_size(p)
            shutil.rmtree(p, ignore_errors=True)
            removed.append(f"releases/{v}")
        for p in list(self.releases.glob(".staging-*")) + [x for x in self.cache.iterdir()]:
            freed += _dir_size(p) if p.is_dir() else p.stat().st_size
            shutil.rmtree(p, ignore_errors=True) if p.is_dir() else p.unlink(missing_ok=True)
            removed.append(str(p.relative_to(self.root)))
        return {"freed_bytes": freed, "removed": removed}


def _is_ver(v: str) -> bool:
    try:
        parse_version(v)
        return True
    except ValueError:
        return False
