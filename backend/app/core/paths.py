"""Filesystem locations for the local app profile.

The vault key never lives here as plaintext. The SQLite file holds opaque
envelopes. The session secret is account-auth only (docs/security-boundary.md).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def default_data_dir() -> Path:
    override = os.environ.get("FOURALLPASS_DATA_DIR")
    if override:
        return Path(override).expanduser()
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "4AllPass"
    if sys.platform == "win32":
        base = os.environ.get("APPDATA")
        root = Path(base) if base else Path.home() / "AppData" / "Roaming"
        return root / "4AllPass"
    xdg = os.environ.get("XDG_DATA_HOME")
    root = Path(xdg) if xdg else Path.home() / ".local" / "share"
    return root / "4allpass"


def default_ui_dist() -> Path:
    override = os.environ.get("FOURALLPASS_UI_DIST")
    if override:
        return Path(override).expanduser()
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            bundled = Path(meipass) / "frontend" / "dist"
            if (bundled / "index.html").is_file():
                return bundled
        beside = Path(sys.executable).resolve().parent / "frontend" / "dist"
        if (beside / "index.html").is_file():
            return beside
    # backend/app/core/paths.py → repo root / frontend / dist
    return Path(__file__).resolve().parents[3] / "frontend" / "dist"


def sqlite_url_for(path: Path) -> str:
    return f"sqlite+aiosqlite:///{path.resolve().as_posix()}"
