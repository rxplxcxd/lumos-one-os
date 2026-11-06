import hashlib
import io
import tarfile

import pytest

from lumosd import vdf
from lumosd.saves import deterministic_tar, safe_extract


def test_vdf_parse_nested_and_case_insensitive():
    text = '''"libraryfolders"
{
    "0" { "path" "/home/a/.local/share/Steam" "apps" { "1145360" "123" } }
    "1" { "path" "/run/media/a/SD\\\\Games" }   // comment
}'''
    d = vdf.parse(text)
    assert vdf.ci_get(d, "LibraryFolders", "0", "path") == "/home/a/.local/share/Steam"
    assert d["libraryfolders"]["1"]["path"] == "/run/media/a/SD\\Games"


def test_deterministic_archive_and_restore(tmp_path):
    src = tmp_path / "saves"
    (src / "sub").mkdir(parents=True)
    (src / "a.srm").write_bytes(b"\x01" * 100)
    (src / "sub" / "b.state").write_bytes(b"state")
    a1 = deterministic_tar([src])
    a2 = deterministic_tar([src])
    assert hashlib.sha256(a1).digest() == hashlib.sha256(a2).digest()
    arch = tmp_path / "x.tar.gz"
    arch.write_bytes(a1)
    (src / "a.srm").write_bytes(b"changed")
    safe_extract(arch, [src])
    assert (src / "a.srm").read_bytes() == b"\x01" * 100
    assert (src / "sub" / "b.state").read_bytes() == b"state"
    assert (tmp_path / ".lumos-bak-saves" / "a.srm").read_bytes() == b"changed"


def test_restore_rejects_path_traversal(tmp_path):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        ti = tarfile.TarInfo("0-saves/../../etc/passwd")
        data = b"x"
        ti.size = 1
        t.addfile(ti, io.BytesIO(data))
    p = tmp_path / "evil.tar.gz"
    p.write_bytes(buf.getvalue())
    (tmp_path / "saves").mkdir()
    with pytest.raises(ValueError):
        safe_extract(p, [tmp_path / "saves"])
