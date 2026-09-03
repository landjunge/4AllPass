"""The local profile serves the built UI from a catch-all route.

`full_path` arrives percent-decoded and the HTTP layer does not normalize
`%2e%2e`, so a plain `dist / full_path` join escapes the UI root and turns the
route into an unauthenticated arbitrary file read (session secret, SQLite vault
file, anything the process can open).

These tests use the *encoded* traversal on purpose. A test written with a raw
`..` passes even against the vulnerable code, because the raw form is collapsed
before the route ever sees it — such a test would look like coverage while
proving nothing.
"""

from __future__ import annotations

import tempfile

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings

# The loopback host guard runs before routing in the local profile.
LOOPBACK = {"Host": "127.0.0.1"}

ESCAPES = [
    "/%2e%2e/outside.txt",
    "/%2e%2e%2foutside.txt",
    "/..%2foutside.txt",
    "/assets/%2e%2e/%2e%2e/outside.txt",
    "/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd",
]


@pytest.fixture
def local_ui(tmp_path, monkeypatch):
    """A local-profile app serving a minimal UI build, plus a file outside it."""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>UI</html>")
    (dist / "assets" / "app.js").write_text("// bundle")
    (tmp_path / "outside.txt").write_text("SECRET-OUTSIDE-THE-UI-ROOT")

    monkeypatch.setenv("FOURALLPASS_PROFILE", "local")
    monkeypatch.setenv("FOURALLPASS_UI_DIST", str(dist))
    monkeypatch.setenv("FOURALLPASS_SESSION_BACKEND", "memory")
    monkeypatch.setenv(
        "FOURALLPASS_DATABASE_URL", "sqlite+aiosqlite:///" + tempfile.mktemp(suffix=".db")
    )
    get_settings.cache_clear()

    from app.main import create_app

    with TestClient(create_app(), headers=LOOPBACK) as client:
        yield client

    get_settings.cache_clear()


@pytest.mark.parametrize("path", ESCAPES)
def test_encoded_traversal_never_escapes_the_ui_root(local_ui, path):
    response = local_ui.get(path)
    assert "SECRET-OUTSIDE-THE-UI-ROOT" not in response.text
    assert "root:x:0:0" not in response.text
    if path.startswith("/assets/"):
        # Served by the StaticFiles mount, which rejects traversal itself.
        assert response.status_code == 404
    else:
        # Unknown paths are SPA routes: serve index, do not signal what exists.
        assert response.status_code == 200
        assert "<html>UI</html>" in response.text


def test_real_ui_files_are_still_served(local_ui):
    assert local_ui.get("/").status_code == 200
    assert "<html>UI</html>" in local_ui.get("/").text

    bundle = local_ui.get("/assets/app.js")
    assert bundle.status_code == 200
    assert "// bundle" in bundle.text


def test_unknown_route_falls_back_to_the_spa_index(local_ui):
    response = local_ui.get("/vaults/some-client-side-route")
    assert response.status_code == 200
    assert "<html>UI</html>" in response.text


def test_api_prefixes_are_not_swallowed_by_the_catch_all(local_ui):
    assert local_ui.get("/api/v1/does-not-exist").status_code == 404
