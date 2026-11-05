"""Daemon configuration: /etc/lumos/lumosd.toml, then ~/.config/lumos/lumosd.toml, then env/CLI."""
from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

HOME = Path.home()
REPO_ROOT = Path(__file__).resolve().parents[2]


def _first_existing(*paths: Path) -> Path | None:
    for p in paths:
        if p and p.exists():
            return p
    return None


@dataclass
class Config:
    host: str = "127.0.0.1"
    port: int = 7420
    simulate: bool = False
    dev: bool = False  # no token auth (browser development only)
    user: str = os.environ.get("USER", "lumos")
    runtime_dir: Path = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")) / "lumos"
    cache_dir: Path = HOME / ".cache" / "lumos"
    data_dir: Path = HOME / ".local" / "share" / "lumos"
    config_dir: Path = HOME / ".config" / "lumos"
    haptics_file: Path = field(default_factory=lambda: _first_existing(Path("/usr/share/lumos/haptics.json"), REPO_ROOT / "shared" / "haptics.json") or REPO_ROOT / "shared" / "haptics.json")
    priv_helper: str = "/usr/lib/lumos/lumos-priv"
    # controllers
    serial_baud: int = 1_000_000
    serial_match: tuple[str, ...] = ("Lumos", "LUMOS", "303a:")  # by-id name / Espressif VID
    ble_service_uuid: str = "6c756d6f-7300-4a6f-7900-000000000001"
    # face id
    howdy_config: Path | None = field(default_factory=lambda: _first_existing(Path("/etc/howdy/config.ini"), Path("/lib/security/howdy/config.ini"), Path("/usr/lib/security/howdy/config.ini")))
    howdy_compare: Path | None = field(default_factory=lambda: _first_existing(Path("/lib/security/howdy/compare.py"), Path("/usr/lib/security/howdy/compare.py"), Path("/usr/lib64/security/howdy/compare.py"), Path("/usr/lib/howdy/compare.py")))
    ir_device: str | None = None
    # display / dock
    gamescope_display: str = os.environ.get("LUMOS_GAMESCOPE_DISPLAY", ":0")
    internal_output: str = "eDP-1"
    # updates
    update_url: str = "https://api.github.com/repos/rxplxcxd/lumos-one-os/releases"
    update_root: Path = Path(os.environ.get("LUMOS_ROOT", "/opt/lumos"))
    update_pubkey: Path = Path("/usr/share/lumos/update-signing.pub")
    # saves
    extra_save_paths: list[str] = field(default_factory=list)

    def ensure_dirs(self) -> None:
        for d in (self.cache_dir, self.data_dir, self.config_dir):
            d.mkdir(parents=True, exist_ok=True)
        try:
            self.runtime_dir.mkdir(parents=True, exist_ok=True)
        except PermissionError:
            self.runtime_dir = self.cache_dir / "run"
            self.runtime_dir.mkdir(parents=True, exist_ok=True)


def load(argv_overrides: dict | None = None) -> Config:
    cfg = Config()
    for p in (Path("/etc/lumos/lumosd.toml"), HOME / ".config" / "lumos" / "lumosd.toml"):
        if p.exists():
            with p.open("rb") as f:
                data = tomllib.load(f)
            for k, v in data.items():
                if hasattr(cfg, k):
                    cur = getattr(cfg, k)
                    setattr(cfg, k, Path(v) if isinstance(cur, Path) else tuple(v) if isinstance(cur, tuple) else v)
    env_map = {"LUMOS_PORT": ("port", int), "LUMOS_SIMULATE": ("simulate", lambda v: v == "1"), "LUMOS_DEV": ("dev", lambda v: v == "1"), "LUMOS_UPDATE_URL": ("update_url", str)}
    for env, (k, conv) in env_map.items():
        if env in os.environ:
            setattr(cfg, k, conv(os.environ[env]))
    for k, v in (argv_overrides or {}).items():
        if v is not None:
            setattr(cfg, k, v)
    cfg.ensure_dirs()
    return cfg
