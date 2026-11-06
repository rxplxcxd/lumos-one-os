"""Update manifest: per-file SHA-256 + Ed25519 signature over the canonical JSON."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import time
from pathlib import Path

SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$")


def parse_version(v: str):
    m = SEMVER.match(v.lstrip("v"))
    if not m:
        raise ValueError(f"invalid version {v!r}")
    pre = m.group(4)
    # pre-releases sort before the release: (1,2,0,(0,'beta.1')) < (1,2,0,(1,''))
    return (int(m.group(1)), int(m.group(2)), int(m.group(3)), (0, pre) if pre else (1, ""))


def sha256_file(p: Path, bufsize=1 << 20) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while chunk := f.read(bufsize):
            h.update(chunk)
    return h.hexdigest()


def build_manifest(payload_dir: Path, version: str, channel: str = "stable", min_version: str = "0.0.0", notes: str = "") -> dict:
    parse_version(version)
    files = []
    for root, _dirs, names in os.walk(payload_dir):
        for n in sorted(names):
            p = Path(root) / n
            if p.is_symlink():
                raise ValueError(f"symlinks are not allowed in payload: {p}")
            rel = p.relative_to(payload_dir).as_posix()
            files.append({"path": rel, "sha256": sha256_file(p), "size": p.stat().st_size, "mode": p.stat().st_mode & 0o777})
    files.sort(key=lambda f: f["path"])
    return {"format": 1, "product": "lumos-one", "version": version, "channel": channel, "min_version": min_version, "created": int(time.time()), "notes": notes, "files": files}


def canonical(manifest: dict) -> bytes:
    return json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def sign(manifest: dict, private_key_pem: bytes) -> str:
    from cryptography.hazmat.primitives.serialization import load_pem_private_key

    key = load_pem_private_key(private_key_pem, password=None)
    return base64.b64encode(key.sign(canonical(manifest))).decode()


def verify(manifest: dict, signature_b64: str, public_key_pem: bytes) -> bool:
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.serialization import load_pem_public_key
    except ImportError as e:  # pragma: no cover
        raise RuntimeError("python-cryptography wird für die Signaturprüfung benötigt") from e
    try:
        load_pem_public_key(public_key_pem).verify(base64.b64decode(signature_b64), canonical(manifest))
        return True
    except (InvalidSignature, ValueError):
        return False


def keygen() -> tuple[bytes, bytes]:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    k = Ed25519PrivateKey.generate()
    priv = k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    pub = k.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    return priv, pub
