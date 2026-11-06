#!/usr/bin/env python3
"""Lumos Sync & Update — PC companion (Windows / Linux / macOS).

  • Pair with a Lumos One over USB-network (USB-C gadget, default 10.55.0.1) or Wi-Fi using the
    6-digit code shown on the handheld (Einstellungen → Softwareupdate → Mit PC koppeln).
  • Send signed update packages (lumos-update-*.zip) to the device, SHA-256 verified end to end.
  • Write an update package to a USB stick for fully offline updates.
  • Download the latest release from the update feed.

GUI:  python lumos_sync.py            CLI:  python lumos_sync.py --help
Requires: Python ≥ 3.10, websockets ≥ 12 (pip install websockets). Tkinter ships with Python.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lumos_update.ota import download, find_update  # noqa: E402
from lumos_update.package import read_manifest  # noqa: E402

DEFAULT_HOST = "10.55.0.1"
PORT = 7421
CHUNK = 1 << 20
FEED = "https://api.github.com/repos/rxplxcxd/lumos-one-os/releases"
CONF = Path(os.environ.get("APPDATA") or Path.home() / ".config") / "lumos-sync" / "devices.json"


def load_devices() -> dict:
    try:
        return json.loads(CONF.read_text())
    except (OSError, ValueError):
        return {}


def save_devices(d: dict) -> None:
    CONF.parent.mkdir(parents=True, exist_ok=True)
    CONF.write_text(json.dumps(d, indent=1))


class Device:
    def __init__(self, host: str, port: int = PORT):
        from websockets.sync.client import connect

        self.ws = connect(f"ws://{host}:{port}", max_size=16 * 1024 * 1024, open_timeout=8)
        self.seq = 0

    def call(self, method, params=None):
        self.seq += 1
        self.ws.send(json.dumps({"id": self.seq, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv(timeout=120))
            if msg.get("id") == self.seq:
                if "error" in msg:
                    raise RuntimeError(msg["error"]["message"])
                return msg["result"]

    def close(self):
        self.ws.close()


def pair(host: str, code: str, name: str | None = None) -> str:
    d = Device(host)
    try:
        token = d.call("sync.pair", {"code": code.strip(), "name": name or platform.node() or "PC"})["token"]
    finally:
        d.close()
    devs = load_devices()
    devs[host] = {"token": token}
    save_devices(devs)
    return token


def push_update(host: str, zip_path: Path, progress=lambda pct: None) -> dict:
    manifest, sig = read_manifest(zip_path)
    if not sig:
        raise RuntimeError("Paket ist nicht signiert – das Gerät wird es ablehnen")
    token = load_devices().get(host, {}).get("token")
    if not token:
        raise RuntimeError(f"Mit {host} noch nicht gekoppelt")
    size = zip_path.stat().st_size
    h = hashlib.sha256()
    with open(zip_path, "rb") as f:
        while b := f.read(CHUNK):
            h.update(b)
    d = Device(host)
    try:
        info = d.call("sync.hello", {"token": token})
        d.call("sync.upload_begin", {"name": zip_path.name, "size": size, "sha256": h.hexdigest()})
        sent = 0
        with open(zip_path, "rb") as f:
            while b := f.read(CHUNK):
                d.ws.send(b)
                sent += len(b)
                progress(sent / size * 100)
        r = d.call("sync.upload_finish")
    finally:
        d.close()
    return {"device": info, "version": manifest["version"], **r}


def write_usb(zip_path: Path, mount: Path, progress=lambda pct: None) -> Path:
    read_manifest(zip_path)  # validates the archive
    dest = mount / zip_path.name
    total = zip_path.stat().st_size
    done = 0
    with open(zip_path, "rb") as src, open(dest.with_suffix(".part"), "wb") as out:
        while b := src.read(CHUNK):
            out.write(b)
            done += len(b)
            progress(done / total * 100)
        out.flush()
        os.fsync(out.fileno())
    os.replace(dest.with_suffix(".part"), dest)
    return dest


def removable_drives() -> list[Path]:
    if os.name == "nt":
        import ctypes
        import string

        drives = []
        mask = ctypes.windll.kernel32.GetLogicalDrives()
        for i, letter in enumerate(string.ascii_uppercase):
            if mask >> i & 1 and ctypes.windll.kernel32.GetDriveTypeW(f"{letter}:\\") == 2:  # DRIVE_REMOVABLE
                drives.append(Path(f"{letter}:\\"))
        return drives
    user = os.environ.get("USER", "")
    out = []
    for base in (f"/run/media/{user}", f"/media/{user}", "/media", "/Volumes"):
        if os.path.isdir(base):
            out += [Path(base) / d for d in sorted(os.listdir(base)) if (Path(base) / d).is_dir() and d != "Macintosh HD"]
    return out


# ------------------------------------------------------------------------------------- GUI
def gui():
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    root = tk.Tk()
    root.title("Lumos Sync & Update")
    root.geometry("620x460")
    root.configure(bg="#0a0c10")
    style = ttk.Style(root)
    style.theme_use("clam")
    for w in ("TFrame", "TLabel", "TLabelframe", "TLabelframe.Label"):
        style.configure(w, background="#0a0c10", foreground="#e7ebf1")
    style.configure("TButton", background="#1c212a", foreground="#f5f7fa", borderwidth=0, padding=8)
    style.map("TButton", background=[("active", "#272d38")])
    style.configure("Horizontal.TProgressbar", troughcolor="#14181f", background="#d8e4ff")

    host = tk.StringVar(value=next(iter(load_devices()), DEFAULT_HOST))
    code = tk.StringVar()
    zip_var = tk.StringVar()
    status = tk.StringVar(value="Bereit")
    prog = tk.DoubleVar(value=0)

    def bg(fn, ok_msg):
        def run():
            try:
                r = fn()
                root.after(0, lambda: (status.set(ok_msg(r) if callable(ok_msg) else ok_msg), prog.set(100)))
            except Exception as e:  # noqa: BLE001
                root.after(0, lambda: (status.set(f"Fehler: {e}"), messagebox.showerror("Lumos Sync", str(e))))

        threading.Thread(target=run, daemon=True).start()

    def set_prog(p):
        root.after(0, lambda: prog.set(p))

    frm = ttk.Frame(root, padding=18)
    frm.pack(fill="both", expand=True)
    ttk.Label(frm, text="Lumos Sync & Update", font=("Segoe UI", 18, "bold")).pack(anchor="w")
    ttk.Label(frm, text="Updates per USB-Kabel, WLAN oder USB-Stick übertragen").pack(anchor="w", pady=(0, 12))

    dev = ttk.LabelFrame(frm, text=" Gerät ", padding=10)
    dev.pack(fill="x")
    ttk.Label(dev, text="Adresse").grid(row=0, column=0, sticky="w")
    ttk.Entry(dev, textvariable=host, width=22).grid(row=0, column=1, padx=6)
    ttk.Label(dev, text="Code").grid(row=0, column=2, sticky="w")
    ttk.Entry(dev, textvariable=code, width=10).grid(row=0, column=3, padx=6)
    ttk.Button(dev, text="Koppeln", command=lambda: bg(lambda: pair(host.get(), code.get()), "Gekoppelt ✓")).grid(row=0, column=4)

    pkg = ttk.LabelFrame(frm, text=" Updatepaket ", padding=10)
    pkg.pack(fill="x", pady=12)
    ttk.Entry(pkg, textvariable=zip_var, width=48).grid(row=0, column=0, padx=(0, 6))
    ttk.Button(pkg, text="Wählen …", command=lambda: zip_var.set(filedialog.askopenfilename(filetypes=[("Lumos Update", "lumos-update-*.zip")]) or zip_var.get())).grid(row=0, column=1)
    ttk.Button(pkg, text="Neueste laden", command=lambda: bg(fetch_latest, lambda p: (zip_var.set(str(p)), f"Geladen: {Path(p).name}")[1] if p else "Kein neueres Release")).grid(row=0, column=2, padx=6)

    def fetch_latest():
        u = find_update(FEED, None, "stable")
        if not u:
            return None
        dest = Path.home() / "Downloads" / f"lumos-update-{u['version']}.zip"
        dest.parent.mkdir(exist_ok=True)
        return download(u["url"], dest, lambda _s, p: set_prog(p), u.get("size"))

    act = ttk.Frame(frm)
    act.pack(fill="x")
    ttk.Button(act, text="An Gerät senden", command=lambda: bg(lambda: push_update(host.get(), Path(zip_var.get()), set_prog), lambda r: f"Übertragen: v{r['version']} – am Gerät „Installieren“ wählen")).pack(side="left")

    def to_usb():
        drives = removable_drives()
        target = filedialog.askdirectory(title="USB-Stick wählen", initialdir=str(drives[0]) if drives else None)
        if target:
            bg(lambda: write_usb(Path(zip_var.get()), Path(target), set_prog), lambda p: f"Auf USB geschrieben: {p}")

    ttk.Button(act, text="Auf USB-Stick schreiben", command=to_usb).pack(side="left", padx=8)
    ttk.Progressbar(frm, variable=prog, maximum=100).pack(fill="x", pady=16)
    ttk.Label(frm, textvariable=status).pack(anchor="w")
    root.mainloop()


def main(argv=None):
    ap = argparse.ArgumentParser(description="Lumos Sync & Update (PC)")
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("pair")
    p.add_argument("code")
    p.add_argument("--host", default=DEFAULT_HOST)
    s = sub.add_parser("send")
    s.add_argument("zip")
    s.add_argument("--host", default=DEFAULT_HOST)
    u = sub.add_parser("usb")
    u.add_argument("zip")
    u.add_argument("mount", nargs="?")
    sub.add_parser("latest")
    a = ap.parse_args(argv)
    bar = lambda pct: print(f"\r{pct:5.1f}%", end="", flush=True)  # noqa: E731
    if a.cmd is None:
        return gui()
    if a.cmd == "pair":
        pair(a.host, a.code)
        print(f"gekoppelt mit {a.host}")
    elif a.cmd == "send":
        r = push_update(a.host, Path(a.zip), bar)
        print(f"\nübertragen: v{r['version']} → {r['path']}")
    elif a.cmd == "usb":
        mount = Path(a.mount) if a.mount else (removable_drives() or [None])[0]
        if not mount:
            sys.exit("kein USB-Stick gefunden")
        print(f"\n{write_usb(Path(a.zip), mount, bar)}")
    elif a.cmd == "latest":
        u = find_update(FEED, None)
        print(json.dumps(u, indent=1, ensure_ascii=False) if u else "keine Releases")
    return 0


if __name__ == "__main__":
    sys.exit(main())
