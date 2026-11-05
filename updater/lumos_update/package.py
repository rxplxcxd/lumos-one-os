"""Build and read lumos-update-<version>.zip packages.

Layout:  manifest.json · manifest.sig · payload/<files…>"""
from __future__ import annotations

import json
import zipfile
from pathlib import Path

from .manifest import build_manifest, sign


def build_package(payload_dir: Path, out_dir: Path, version: str, private_key_pem: bytes, channel="stable", notes="", min_version="0.0.0") -> Path:
    payload_dir, out_dir = Path(payload_dir), Path(out_dir)
    m = build_manifest(payload_dir, version, channel, min_version, notes)
    sig = sign(m, private_key_pem)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"lumos-update-{version}.zip"
    tmp = out.with_suffix(".zip.part")
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.writestr("manifest.json", json.dumps(m, indent=1, ensure_ascii=False))
        z.writestr("manifest.sig", sig)
        for f in m["files"]:
            z.write(payload_dir / f["path"], f"payload/{f['path']}")
    tmp.replace(out)
    return out


def read_manifest(zip_path: Path) -> tuple[dict, str | None]:
    with zipfile.ZipFile(zip_path) as z:
        m = json.loads(z.read("manifest.json"))
        sig = z.read("manifest.sig").decode().strip() if "manifest.sig" in z.namelist() else None
    return m, sig
