"""Local data-dir layout is OS-specific. Override always wins."""

from __future__ import annotations

import sys

from app.core.paths import default_data_dir


def test_override_beats_platform(tmp_path, monkeypatch):
    monkeypatch.setenv("FOURALLPASS_DATA_DIR", str(tmp_path / "custom"))
    monkeypatch.setattr(sys, "platform", "win32")
    assert default_data_dir() == tmp_path / "custom"


def test_windows_appdata(tmp_path, monkeypatch):
    monkeypatch.delenv("FOURALLPASS_DATA_DIR", raising=False)
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setenv("APPDATA", str(tmp_path / "Roaming"))
    assert default_data_dir() == tmp_path / "Roaming" / "4AllPass"


def test_linux_xdg(tmp_path, monkeypatch):
    monkeypatch.delenv("FOURALLPASS_DATA_DIR", raising=False)
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "share"))
    assert default_data_dir() == tmp_path / "share" / "4allpass"
