"""The shape of the API surface itself.

Two rules that are easy to break by accident in a later change, and that no
per-route test would catch:

* every route that names a vault sits behind authentication *and* ownership;
* this step adds no snapshot, entry or envelope endpoints.

Asserting the exact inventory means a new route cannot be added without either
protecting it or consciously updating this list.
"""

import ast
import re
from pathlib import Path

import pytest
from fastapi.routing import APIRoute

from app.api.deps import get_current_user, require_vault_owner
from app.main import app

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Routes that are reachable without a token, and why that is correct.
PUBLIC_ROUTES = {
    ("GET", "/health"),
    ("GET", "/health/db"),
    ("POST", "/auth/register"),  # creating an account cannot require an account
    ("POST", "/auth/login"),  # the password is the credential
    ("POST", "/auth/refresh"),  # the refresh token is the credential
}

AUTHENTICATED_ROUTES = {
    ("POST", "/auth/logout"),
    ("GET", "/auth/me"),
    ("GET", "/vaults/{vault_id}/devices"),
    ("GET", "/vaults/{vault_id}/devices/{device_id}"),
}

# Vault-scoped routes must additionally prove ownership.
OWNERSHIP_ROUTES = {
    ("GET", "/vaults/{vault_id}/devices"),
    ("GET", "/vaults/{vault_id}/devices/{device_id}"),
}


def _iter_api_routes(router=app.router, prefix: str = ""):
    """Walk the app's routes, descending into included routers.

    FastAPI does not flatten `include_router` into `app.routes`; the included
    router is wrapped, so a non-recursive walk sees only the docs endpoints and
    would silently pass every assertion below.
    """
    for route in router.routes:
        if isinstance(route, APIRoute):
            yield prefix + route.path, route
            continue
        inner = getattr(route, "original_router", None)
        if inner is not None:
            inner_prefix = prefix + getattr(getattr(route, "include_context", None), "prefix", "")
            yield from _iter_api_routes(inner, inner_prefix)


def _routes() -> set[tuple[str, str]]:
    found: set[tuple[str, str]] = set()
    for path, route in _iter_api_routes():
        for method in route.methods:
            if method in {"HEAD", "OPTIONS"}:
                continue
            found.add((method, path))
    # Sanity check on the walk itself: if it ever returns nothing, every other
    # assertion here becomes vacuously true.
    assert found, "route discovery found no routes"
    return found


def _dependencies(method: str, path: str) -> set[object]:
    """Every dependency callable reachable from a route, transitively."""
    for route_path, route in _iter_api_routes():
        if route_path == path and method in route.methods:
            seen: set[object] = set()
            stack = list(route.dependant.dependencies)
            while stack:
                dependant = stack.pop()
                if dependant.call is not None:
                    seen.add(dependant.call)
                stack.extend(dependant.dependencies)
            return seen
    raise AssertionError(f"no such route: {method} {path}")


def test_route_inventory_is_exactly_what_this_step_adds():
    assert _routes() == PUBLIC_ROUTES | AUTHENTICATED_ROUTES


@pytest.mark.parametrize(("method", "path"), sorted(AUTHENTICATED_ROUTES))
def test_authenticated_routes_depend_on_the_current_user(method, path):
    assert get_current_user in _dependencies(method, path)


@pytest.mark.parametrize(("method", "path"), sorted(OWNERSHIP_ROUTES))
def test_vault_routes_depend_on_ownership(method, path):
    dependencies = _dependencies(method, path)
    assert require_vault_owner in dependencies
    # …and ownership itself pulls in authentication, so both hold.
    assert get_current_user in dependencies


@pytest.mark.parametrize(("method", "path"), sorted(PUBLIC_ROUTES))
def test_public_routes_are_deliberately_public(method, path):
    assert get_current_user not in _dependencies(method, path)


def test_every_vault_scoped_route_requires_ownership():
    """No route may take a vault_id without proving ownership of it."""
    for method, path in _routes():
        if "{vault_id}" not in path:
            continue
        assert require_vault_owner in _dependencies(method, path), f"{method} {path}"


def test_no_snapshot_entry_or_envelope_endpoints_yet():
    """This step is the security boundary, not the sync protocol.

    Snapshot publication has requirements this boundary does not implement
    (docs/vault-revision.md §4: full write, then a CAS on the active pointer),
    so shipping a half endpoint here would be worse than shipping none.
    """
    forbidden = ("snapshot", "entries", "envelope", "sync", "revision")
    for method, path in _routes():
        assert not any(word in path.lower() for word in forbidden), f"{method} {path}"


class TestWhatTheBoundaryMayTouch:
    """Structural limits, so the boundary cannot grow into the crypto protocol.

    The crypto core is hardened and the snapshot rules are the client's and the
    storage layer's to enforce. This layer's job is identity and ownership; these
    tests fail if it starts reaching into either.
    """

    API_SOURCES = sorted((BACKEND_DIR / "app" / "api").rglob("*.py"))
    AUTH_SOURCES = [
        BACKEND_DIR / "app" / "core" / "security.py",
        BACKEND_DIR / "app" / "services" / "refresh_tokens.py",
        BACKEND_DIR / "app" / "schemas" / "auth.py",
    ]

    def test_the_backend_does_not_import_the_crypto_core(self):
        """No server-side use of `packages/crypto`: it is a client library.

        Anything the server could compute with it, it could only compute over
        ciphertext it must treat as opaque — and importing it would invite
        exactly the "just decrypt it here" change this design forbids.
        """
        for source in sorted((BACKEND_DIR / "app").rglob("*.py")):
            text = source.read_text()
            assert "4allpass/crypto" not in text, source
            assert "import crypto" not in text, source

    @pytest.mark.parametrize("source", API_SOURCES, ids=lambda p: p.name)
    def test_the_api_layer_does_not_touch_snapshot_state(self, source):
        """Snapshots, entries and key envelopes are not this layer's business.

        A route that could assemble them could also serve a mixed snapshot,
        which is precisely what docs/vault-revision.md §6 exists to prevent.

        `DeviceKeyEnvelope` is allowed — it is device metadata, not snapshot
        state — so the patterns below are word-bounded rather than substrings.
        """
        text = source.read_text()
        for pattern in (
            r"from app\.models\.snapshot",
            r"from app\.models\.entry",
            r"from app\.models\.key_envelope",
            r"\bVaultSnapshot\b",
            r"\bEncryptedEntry\b",
            r"\bKeyEnvelope\b",
        ):
            assert re.search(pattern, text) is None, f"{source.name} references {pattern}"

    def test_the_device_routes_never_select_envelope_bytes(self):
        """The Device-Key Envelope mirror is queried for existence only."""
        text = (BACKEND_DIR / "app" / "api" / "routes" / "devices.py").read_text()
        assert "DeviceKeyEnvelope" in text  # it is used…
        for column in (".nonce", ".ciphertext", ".tag", ".credential_id", ".public_key"):
            assert f"DeviceKeyEnvelope{column}" not in text, column
        # …and only through the two columns that answer "is one on file?".
        assert "DeviceKeyEnvelope.device_id" in text
        assert "DeviceKeyEnvelope.id" in text

    def test_the_response_schema_carries_no_key_material(self):
        """The device schema's field list is the contract; keep it metadata-only."""
        from app.schemas.device import DeviceOut, WebAuthnCredentialOut

        assert set(DeviceOut.model_fields) == {
            "id",
            "device_id",
            "display_name",
            "last_seen_at",
            "revoked_at",
            "webauthn_credentials",
            "has_device_key_envelope",
        }
        assert set(WebAuthnCredentialOut.model_fields) == {
            "id",
            "rp_id",
            "prf_supported",
            "large_blob_supported",
            "user_verification",
            "last_used_at",
            "revoked_at",
        }

    def test_the_token_payload_literal_carries_exactly_the_six_claims(self):
        """Read the claim set out of the source, not out of a token.

        A behavioural test proves today's token is minimal; this one fails when
        somebody *adds* a claim, even if no behavioural test covers it. Anything
        beyond these six — a vault id, a scope, a role — would turn a token into
        a capability, which is the one thing it must never be.
        """
        tree = ast.parse((BACKEND_DIR / "app" / "core" / "security.py").read_text())
        payloads = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Dict):
                continue
            keys = {k.value for k in node.keys if isinstance(k, ast.Constant)}
            if "sub" in keys:
                payloads.append(keys)
        assert payloads, "no token payload literal found in security.py"
        for keys in payloads:
            assert keys == {"sub", "iat", "exp", "jti", "iss", "aud"}

    @pytest.mark.parametrize("source", AUTH_SOURCES, ids=lambda p: p.name)
    def test_auth_code_never_reads_vault_or_device_state(self, source):
        """The auth path must not query vault-scoped tables at all."""
        text = source.read_text()
        for pattern in (
            r"from app\.models\.vault",
            r"from app\.models\.device",
            r"\bVault\b",
            r"\bDevice\b",
        ):
            assert re.search(pattern, text) is None, f"{source.name} references {pattern}"
