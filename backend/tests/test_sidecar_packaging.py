"""Sidecar packager names the host triple. Does not mint tokens."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "package-sidecar.py"


def test_print_triple_is_a_known_host():
    out = subprocess.check_output([sys.executable, str(SCRIPT), "--print-triple"], text=True).strip()
    assert out.endswith("-apple-darwin") or out.endswith("-pc-windows-msvc") or out.endswith(
        "-unknown-linux-gnu"
    )
    assert "fourallpass-core" not in out
