import os
import zipfile
from pathlib import Path

import pytest

from lumos_update.installer import Installer, UpdateError
from lumos_update.manifest import keygen, parse_version
from lumos_update.package import build_package


@pytest.fixture()
def keys(tmp_path):
    priv, pub = keygen()
    (tmp_path / "k.pub").write_bytes(pub)
    return priv, tmp_path / "k.pub"


def make_payload(d: Path, text: str):
    (d / "app").mkdir(parents=True)
    (d / "app" / "main.js").write_text(text)
    (d / "bin").mkdir()
    (d / "bin" / "lumos").write_text("#!/bin/sh\necho hi\n")
    os.chmod(d / "bin" / "lumos", 0o755)


def test_install_activate_rollback_cleanup(tmp_path, keys):
    priv, pub = keys
    root = tmp_path / "root"
    pkgs = []
    for v in ("1.0.0", "1.1.0", "1.2.0"):
        pl = tmp_path / f"pl-{v}"
        make_payload(pl, f"version {v}")
        pkgs.append(build_package(pl, tmp_path / "out", v, priv))
    inst = Installer(root, pub)
    for p in pkgs:
        inst.install(p)
    assert inst.current() == "1.2.0" and inst.previous() == "1.1.0"
    assert (root / "current" / "app" / "main.js").read_text() == "version 1.2.0"
    assert os.access(root / "current" / "bin" / "lumos", os.X_OK)
    assert inst.rollback() == "1.1.0"
    assert inst.current() == "1.1.0" and inst.previous() == "1.2.0"
    (inst.cache / "junk.part").write_bytes(b"x" * 100)
    r = inst.cleanup(keep=2)
    assert "releases/1.0.0" in r["removed"] and r["freed_bytes"] > 0
    assert inst.installed() == ["1.1.0", "1.2.0"]


def test_tampered_payload_is_rejected(tmp_path, keys):
    priv, pub = keys
    pl = tmp_path / "pl"
    make_payload(pl, "good")
    pkg = build_package(pl, tmp_path / "out", "2.0.0", priv)
    evil = tmp_path / "evil.zip"
    with zipfile.ZipFile(pkg) as src, zipfile.ZipFile(evil, "w") as dst:
        for item in src.infolist():
            data = src.read(item)
            dst.writestr(item, b"pwned" if item.filename.endswith("main.js") else data)
    inst = Installer(tmp_path / "root", pub)
    with pytest.raises(UpdateError, match="Prüfsumme"):
        inst.install(evil)
    assert inst.current() is None
    assert not list((tmp_path / "root" / "releases").glob(".staging-*"))


def test_bad_signature_and_unsigned(tmp_path, keys):
    priv, pub = keys
    other_priv, _ = keygen()
    pl = tmp_path / "pl"
    make_payload(pl, "x")
    pkg = build_package(pl, tmp_path / "out", "3.0.0", other_priv)
    with pytest.raises(UpdateError, match="Signatur"):
        Installer(tmp_path / "root", pub).verify_package(pkg)
    with pytest.raises(UpdateError, match="nicht signiert"):
        Installer(tmp_path / "root2", None).verify_package(pkg)


def test_semver_ordering():
    assert parse_version("1.2.0-beta.1") < parse_version("1.2.0") < parse_version("1.10.0")
