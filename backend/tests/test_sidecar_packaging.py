"""Sidecar packager names the host triple. Does not mint tokens."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "package-sidecar.py"


def test_sidecar_requirements_pin_pyinstaller_with_hashes():
    text = (Path(__file__).resolve().parents[1] / "requirements-sidecar.txt").read_text(encoding="utf-8")
    assert "pyinstaller==6.22.2" in text
    assert text.count("--hash=sha256:") >= 6
    assert "pip install pyinstaller\n" not in (SCRIPT.read_text(encoding="utf-8"))
    assert "--require-hashes" in SCRIPT.read_text(encoding="utf-8")


def test_print_triple_is_a_known_host():
    out = subprocess.check_output([sys.executable, str(SCRIPT), "--print-triple"], text=True).strip()
    assert out.endswith("-apple-darwin") or out.endswith("-pc-windows-msvc") or out.endswith(
        "-unknown-linux-gnu"
    )
    assert "fourallpass-core" not in out
