#!/usr/bin/env python3
"""Build the local-core sidecar for Tauri (PyInstaller).

Does not mint tokens. Bundles frontend/dist + FastAPI local profile.
Run on the OS you are packaging — no cross-compile.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def host_triple() -> str:
    system = sys.platform
    machine = platform.machine().lower()
    arch = "aarch64" if machine in {"arm64", "aarch64"} else "x86_64"
    if system == "darwin":
        return f"{arch}-apple-darwin"
    if system == "win32":
        return f"{arch}-pc-windows-msvc"
    return f"{arch}-unknown-linux-gnu"


def sidecar_name(triple: str) -> str:
    suffix = ".exe" if sys.platform == "win32" else ""
    return f"fourallpass-core-{triple}{suffix}"


def venv_python(root: Path) -> Path | None:
    if sys.platform == "win32":
        candidate = root / "backend" / ".venv" / "Scripts" / "python.exe"
    else:
        candidate = root / "backend" / ".venv" / "bin" / "python"
    return candidate if candidate.is_file() else None


def maybe_reexec_venv(root: Path) -> None:
    venv = venv_python(root)
    if venv is None:
        return
    current = Path(sys.executable).resolve()
    target = venv.resolve()
    if current == target:
        return
    os.execv(str(target), [str(target), *sys.argv])


def main() -> int:
    root = repo_root()
    if "--print-triple" in sys.argv:
        print(host_triple())
        return 0

    maybe_reexec_venv(root)

    dist_index = root / "frontend" / "dist" / "index.html"
    if not dist_index.is_file():
        subprocess.check_call(["npm", "run", "build"], cwd=root)

    triple = host_triple()
    out = root / "src-tauri" / "binaries" / sidecar_name(triple)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.is_file() and dist_index.stat().st_mtime <= out.stat().st_mtime:
        print(f"sidecar already present: {out}")
        return 0

    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "pyinstaller"])
    backend = root / "backend"
    add_data = f"{root / 'frontend' / 'dist'}{os.pathsep}frontend/dist"
    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        "fourallpass-core",
        "--paths",
        ".",
        "--add-data",
        add_data,
        "--hidden-import",
        "uvicorn.logging",
        "--hidden-import",
        "uvicorn.loops.auto",
        "--hidden-import",
        "uvicorn.protocols.http.auto",
        "--hidden-import",
        "uvicorn.protocols.websockets.auto",
        "--hidden-import",
        "uvicorn.lifespan.on",
        "--hidden-import",
        "aiosqlite",
        "--hidden-import",
        "app.main",
        "--hidden-import",
        "app.local",
        "--hidden-import",
        "app.broker",
        "app/local.py",
    ]
    subprocess.check_call(cmd, cwd=backend)
    built = backend / "dist" / ("fourallpass-core.exe" if sys.platform == "win32" else "fourallpass-core")
    shutil.copy2(built, out)
    if sys.platform != "win32":
        out.chmod(out.stat().st_mode | 0o111)
    print(f"sidecar: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
