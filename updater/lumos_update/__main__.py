"""CLI: python -m lumos_update {keygen,build,verify,install,rollback,cleanup,status,check}"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .installer import Installer, UpdateError
from .manifest import keygen
from .ota import download, find_update
from .package import build_package, read_manifest


def main(argv=None):
    ap = argparse.ArgumentParser(prog="lumos-update", description="Lumos One Sync & Update")
    ap.add_argument("--root", default="/opt/lumos", help="install root (default /opt/lumos)")
    ap.add_argument("--pubkey", default="/usr/share/lumos/update-signing.pub")
    ap.add_argument("--allow-unsigned", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)
    k = sub.add_parser("keygen")
    k.add_argument("out_prefix")
    b = sub.add_parser("build")
    b.add_argument("payload")
    b.add_argument("version")
    b.add_argument("--key", required=True)
    b.add_argument("--out", default="dist-update")
    b.add_argument("--channel", default="stable")
    b.add_argument("--notes", default="")
    v = sub.add_parser("verify")
    v.add_argument("zip")
    i = sub.add_parser("install")
    i.add_argument("zip")
    sub.add_parser("rollback")
    c = sub.add_parser("cleanup")
    c.add_argument("--keep", type=int, default=2)
    sub.add_parser("status")
    ch = sub.add_parser("check")
    ch.add_argument("--feed", default="https://api.github.com/repos/rxplxcxd/lumos-one-os/releases")
    ch.add_argument("--channel", default="stable")
    ch.add_argument("--download", action="store_true")
    a = ap.parse_args(argv)

    try:
        if a.cmd == "keygen":
            priv, pub = keygen()
            Path(f"{a.out_prefix}.key").write_bytes(priv)
            Path(f"{a.out_prefix}.pub").write_bytes(pub)
            Path(f"{a.out_prefix}.key").chmod(0o600)
            print(f"wrote {a.out_prefix}.key / {a.out_prefix}.pub")
            return 0
        if a.cmd == "build":
            out = build_package(Path(a.payload), Path(a.out), a.version, Path(a.key).read_bytes(), a.channel, a.notes)
            print(out)
            return 0
        inst = Installer(Path(a.root), Path(a.pubkey), a.allow_unsigned)
        prog = lambda stage, pct: print(f"\r{stage:9s} {pct:5.1f}%", end="", file=sys.stderr, flush=True)  # noqa: E731
        if a.cmd == "verify":
            m = inst.verify_package(Path(a.zip))
            print(json.dumps({"ok": True, "version": m["version"], "files": len(m["files"])}))
        elif a.cmd == "install":
            print(f"\ninstalled {inst.install(Path(a.zip), prog)} → reboot to use it")
        elif a.cmd == "rollback":
            print(f"rolled back to {inst.rollback()}")
        elif a.cmd == "cleanup":
            print(json.dumps(inst.cleanup(a.keep)))
        elif a.cmd == "status":
            print(json.dumps(inst.status()))
        elif a.cmd == "check":
            u = find_update(a.feed, inst.current(), a.channel)
            print(json.dumps(u, ensure_ascii=False) if u else "up to date")
            if u and a.download:
                p = download(u["url"], inst.cache / f"lumos-update-{u['version']}.zip", prog, u.get("size"))
                print(f"\n{p}")
        return 0
    except (UpdateError, ValueError, OSError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
