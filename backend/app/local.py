"""Local single-process profile.

One origin: ``http://127.0.0.1:8788`` serves the UI and ``/api/v1``.
SQLite + memory sessions. FastAPI still never sees vault secrets and never
mints access tokens.

    python -m app.local
    python -m app.local --open
"""

from __future__ import annotations

import argparse
import os
import secrets
import socket
import subprocess
import sys
import webbrowser
from dataclasses import dataclass
from pathlib import Path

LOCAL_HOST = "127.0.0.1"
LOCAL_PORT = 8788
SECRET_FILE = "session.secret"
BROKER_FILE = "broker.token"
DB_FILE = "vault.db"


def _read_or_create_secret(path: Path, *, hex_token: bool = False) -> str:
    if path.exists():
        existing = path.read_text(encoding="utf-8").strip()
        if existing:
            return existing
    value = secrets.token_hex(32) if hex_token else secrets.token_urlsafe(32)
    path.write_text(value + "\n", encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return value


@dataclass(frozen=True)
class LocalRuntime:
    data_dir: Path
    database_path: Path
    database_url: str
    session_secret: str
    broker_token: str
    host: str
    port: int
    ui_dist: Path
    origin: str


def prepare_local_runtime(
    *,
    data_dir: Path | None = None,
    ui_dist: Path | None = None,
    host: str = LOCAL_HOST,
    port: int = LOCAL_PORT,
) -> LocalRuntime:
    from app.core.paths import default_data_dir, default_ui_dist, sqlite_url_for

    if host not in {"127.0.0.1", "localhost"}:
        raise ValueError("local profile binds loopback only")
    host = LOCAL_HOST
    data = (data_dir or default_data_dir()).expanduser()
    data.mkdir(parents=True, exist_ok=True)
    if hasattr(os, "chmod"):
        try:
            os.chmod(data, 0o700)
        except OSError:
            pass
    session_secret = _read_or_create_secret(data / SECRET_FILE)
    env_token = os.environ.get("FOURALLPASS_BROKER_TOKEN", "").strip()
    broker_token = env_token or _read_or_create_secret(data / BROKER_FILE, hex_token=True)
    database_path = data / DB_FILE
    origin = f"http://{host}:{port}"
    return LocalRuntime(
        data_dir=data,
        database_path=database_path,
        database_url=sqlite_url_for(database_path),
        session_secret=session_secret,
        broker_token=broker_token,
        host=host,
        port=port,
        ui_dist=(ui_dist or default_ui_dist()).resolve(),
        origin=origin,
    )


def apply_runtime_to_env(runtime: LocalRuntime) -> None:
    os.environ["FOURALLPASS_PROFILE"] = "local"
    os.environ["FOURALLPASS_DATABASE_URL"] = runtime.database_url
    os.environ["FOURALLPASS_SESSION_BACKEND"] = "memory"
    os.environ["FOURALLPASS_SESSION_SECRET"] = runtime.session_secret
    os.environ["FOURALLPASS_ENVIRONMENT"] = "local"
    os.environ["FOURALLPASS_WEBAUTHN_RP_ID"] = "127.0.0.1"
    os.environ["FOURALLPASS_LISTEN_HOST"] = runtime.host
    os.environ["FOURALLPASS_LISTEN_PORT"] = str(runtime.port)
    os.environ["FOURALLPASS_UI_DIST"] = str(runtime.ui_dist)
    os.environ["FOURALLPASS_CORS_ORIGINS"] = f'["{runtime.origin}"]'
    os.environ["FOURALLPASS_DATA_DIR"] = str(runtime.data_dir)
    os.environ["FOURALLPASS_BROKER_TOKEN"] = runtime.broker_token
    os.environ["FOURALLPASS_BROKER_URL"] = runtime.origin


def port_held(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex((host, port)) == 0


def open_app_window(origin: str) -> None:
    chrome = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    if chrome.is_file():
        subprocess.Popen(  # noqa: S603
            [str(chrome), f"--app={origin}"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return
    webbrowser.open(origin)


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="4AllPass local app (one origin, SQLite)")
    parser.add_argument("--open", action="store_true", help="open a window after bind")
    parser.add_argument("--data-dir", type=Path, default=None)
    parser.add_argument("--ui-dist", type=Path, default=None)
    parser.add_argument("--port", type=int, default=LOCAL_PORT)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    runtime = prepare_local_runtime(data_dir=args.data_dir, ui_dist=args.ui_dist, port=args.port)
    if port_held(runtime.host, runtime.port):
        print(
            f"4AllPass läuft schon auf {runtime.origin} / already running.",
            file=sys.stderr,
        )
        sys.exit(1)
    apply_runtime_to_env(runtime)
    from app.core.config import get_settings
    from app.db.session import reset_engine

    get_settings.cache_clear()
    reset_engine()
    import uvicorn

    from app.main import create_app

    app = create_app()
    if args.open:
        open_app_window(runtime.origin)
    print(f"4AllPass local {runtime.origin}", flush=True)
    print("Access broker on this origin: POST /v1/access/request (pairing token in data dir)", flush=True)
    uvicorn.run(app, host=runtime.host, port=runtime.port, log_level="info")


if __name__ == "__main__":
    main()
