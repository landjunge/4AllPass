"""Account authentication: registration, login, rotation, logout.

These tests are about the *boundary*, not about convenience: what a token
contains, what it does not contain, and what stops working after logout.
"""

import uuid

import jwt
import pytest

from app.core.config import get_settings
from app.core.security import decode_access_token

pytestmark = pytest.mark.asyncio(loop_scope="session")

PASSWORD = "correct-horse-battery-staple"


def _email() -> str:
    return f"user-{uuid.uuid4().hex[:12]}@example.test"


async def _register(api_client, email: str, password: str = PASSWORD):
    return await api_client.post("/auth/register", json={"email": email, "password": password})


async def _login(api_client, email: str, password: str = PASSWORD):
    return await api_client.post("/auth/login", json={"email": email, "password": password})


async def register_and_login(api_client, email: str | None = None) -> tuple[str, dict]:
    """Returns the account email and its token pair."""
    address = email or _email()
    registered = await _register(api_client, address)
    assert registered.status_code == 201, registered.text
    logged_in = await _login(api_client, address)
    assert logged_in.status_code == 200, logged_in.text
    return address, logged_in.json()


class TestRegister:
    async def test_creates_an_account_without_returning_tokens(self, api_client):
        email = _email()
        response = await _register(api_client, email)
        assert response.status_code == 201
        body = response.json()
        assert body["email"] == email
        assert uuid.UUID(body["id"])
        # Registration is not a login, and never echoes the password back.
        assert set(body) == {"id", "email"}

    async def test_email_is_case_insensitive_and_unique(self, api_client):
        email = _email()
        assert (await _register(api_client, email)).status_code == 201

        duplicate = await _register(api_client, email.upper())
        assert duplicate.status_code == 409
        assert "already registered" in duplicate.json()["detail"]

    async def test_rejects_a_short_password(self, api_client):
        settings = get_settings()
        response = await _register(api_client, _email(), "x" * (settings.account_password_min_length - 1))
        assert response.status_code == 422

    async def test_rejects_a_malformed_email(self, api_client):
        response = await api_client.post(
            "/auth/register", json={"email": "not-an-email", "password": PASSWORD}
        )
        assert response.status_code == 422

    async def test_stores_only_a_hash_of_the_password(self, api_client, db_session):
        from sqlalchemy import select

        from app.models.user import User

        email = _email()
        await _register(api_client, email)
        user = (await db_session.execute(select(User).where(User.email == email))).scalar_one()
        assert user.account_password_hash is not None
        assert PASSWORD not in user.account_password_hash
        assert user.account_password_hash.startswith("$argon2id$")


class TestLogin:
    async def test_returns_a_token_pair(self, api_client):
        _, tokens = await register_and_login(api_client)
        assert tokens["token_type"] == "bearer"
        assert tokens["expires_in"] == get_settings().access_token_ttl_seconds
        assert tokens["access_token"] and tokens["refresh_token"]

    async def test_access_token_carries_only_the_minimal_claims(self, api_client):
        _, tokens = await register_and_login(api_client)
        settings = get_settings()
        claims = jwt.decode(
            tokens["access_token"],
            options={"verify_signature": False},
            audience=settings.jwt_audience,
        )
        assert set(claims) == {"sub", "iat", "exp", "jti", "iss", "aud"}
        assert claims["iss"] == settings.jwt_issuer
        assert claims["aud"] == settings.jwt_audience
        # No vault id, device id, scope or role may ride along: a token is proof
        # of identity, never a capability.
        serialized = str(claims)
        for forbidden in ("vault", "device", "scope", "role", "key"):
            assert forbidden not in serialized.lower()

    async def test_access_token_is_signed_asymmetrically_and_short_lived(self, api_client):
        _, tokens = await register_and_login(api_client)
        header = jwt.get_unverified_header(tokens["access_token"])
        assert header["alg"] == get_settings().jwt_algorithm
        assert header["alg"] not in {"none", "HS256", "HS384", "HS512"}

        claims = decode_access_token(tokens["access_token"])
        lifetime = (claims.expires_at - claims.issued_at).total_seconds()
        assert lifetime == get_settings().access_token_ttl_seconds
        assert lifetime <= 15 * 60

    async def test_refresh_token_is_opaque(self, api_client):
        _, tokens = await register_and_login(api_client)
        # Not a JWT: it carries no readable claims at all.
        with pytest.raises(jwt.PyJWTError):
            jwt.get_unverified_header(tokens["refresh_token"])

    async def test_rejects_a_wrong_password(self, api_client):
        email, _ = await register_and_login(api_client)
        response = await _login(api_client, email, "not-the-password")
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"

    async def test_unknown_account_is_indistinguishable_from_a_wrong_password(self, api_client):
        email, _ = await register_and_login(api_client)
        wrong_password = await _login(api_client, email, "not-the-password")
        unknown_account = await _login(api_client, _email())
        assert wrong_password.status_code == unknown_account.status_code == 401
        assert wrong_password.json() == unknown_account.json()

    async def test_rejects_a_deactivated_account(self, api_client, db_session):
        from sqlalchemy import select

        from app.models.user import User

        email, _ = await register_and_login(api_client)
        user = (await db_session.execute(select(User).where(User.email == email))).scalar_one()
        user.is_active = False
        await db_session.commit()

        assert (await _login(api_client, email)).status_code == 401

    async def test_rejects_an_oauth_only_account_without_a_password(self, api_client, db_session):
        from app.models.user import User

        email = _email()
        db_session.add(User(email=email, account_password_hash=None, oauth_provider="google"))
        await db_session.commit()

        response = await _login(api_client, email, PASSWORD)
        assert response.status_code == 401


class TestProtectedEndpoint:
    async def test_me_requires_a_token(self, api_client):
        response = await api_client.get("/auth/me")
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"

    async def test_me_returns_the_calling_account(self, api_client):
        email, tokens = await register_and_login(api_client)
        response = await api_client.get(
            "/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"}
        )
        assert response.status_code == 200
        assert response.json()["email"] == email

    @pytest.mark.parametrize(
        "header",
        [
            "",
            "Bearer",
            "Bearer not-a-token",
            "Basic dXNlcjpwYXNz",
            "Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhIn0.",
        ],
    )
    async def test_rejects_malformed_authorization_headers(self, api_client, header):
        response = await api_client.get("/auth/me", headers={"Authorization": header})
        assert response.status_code == 401

    async def test_rejects_a_token_signed_by_someone_else(self, api_client):
        from cryptography.hazmat.primitives.asymmetric import ed25519

        settings = get_settings()
        _, tokens = await register_and_login(api_client)
        claims = decode_access_token(tokens["access_token"])
        forged = jwt.encode(
            {
                "sub": str(claims.subject),
                "iat": int(claims.issued_at.timestamp()),
                "exp": int(claims.expires_at.timestamp()),
                "jti": uuid.uuid4().hex,
                "iss": settings.jwt_issuer,
                "aud": settings.jwt_audience,
            },
            ed25519.Ed25519PrivateKey.generate(),
            algorithm="EdDSA",
        )
        response = await api_client.get("/auth/me", headers={"Authorization": f"Bearer {forged}"})
        assert response.status_code == 401


class TestRefresh:
    async def test_rotates_the_refresh_token(self, api_client):
        _, tokens = await register_and_login(api_client)
        response = await api_client.post(
            "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        )
        assert response.status_code == 200
        rotated = response.json()
        assert rotated["refresh_token"] != tokens["refresh_token"]
        assert rotated["access_token"] != tokens["access_token"]

        # The new access token works…
        live = await api_client.get(
            "/auth/me", headers={"Authorization": f"Bearer {rotated['access_token']}"}
        )
        assert live.status_code == 200

    async def test_the_old_refresh_token_stops_working(self, api_client):
        _, tokens = await register_and_login(api_client)
        first = await api_client.post(
            "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        )
        assert first.status_code == 200

        replay = await api_client.post(
            "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        )
        assert replay.status_code == 401

    async def test_replay_revokes_the_whole_family(self, api_client):
        """A rotated token presented twice means someone holds a copy."""
        _, tokens = await register_and_login(api_client)
        rotated = (
            await api_client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        ).json()

        replay = await api_client.post(
            "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        )
        assert replay.status_code == 401

        # The successor is revoked too, so the thief and the victim both have to
        # re-authenticate rather than the thief silently continuing.
        after = await api_client.post(
            "/auth/refresh", json={"refresh_token": rotated["refresh_token"]}
        )
        assert after.status_code == 401

    async def test_rejects_an_unknown_refresh_token(self, api_client):
        response = await api_client.post("/auth/refresh", json={"refresh_token": "nope"})
        assert response.status_code == 401

    async def test_rejects_an_access_token_used_as_a_refresh_token(self, api_client):
        _, tokens = await register_and_login(api_client)
        response = await api_client.post(
            "/auth/refresh", json={"refresh_token": tokens["access_token"]}
        )
        assert response.status_code == 401


class TestLogout:
    async def test_revokes_both_tokens_immediately(self, api_client):
        _, tokens = await register_and_login(api_client)
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        response = await api_client.post(
            "/auth/logout", json={"refresh_token": tokens["refresh_token"]}, headers=headers
        )
        assert response.status_code == 204

        # The access token is deny-listed, so it does not remain valid for the
        # rest of its ten minutes.
        assert (await api_client.get("/auth/me", headers=headers)).status_code == 401
        # And the refresh token cannot mint a replacement.
        assert (
            await api_client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        ).status_code == 401

    async def test_requires_authentication(self, api_client):
        _, tokens = await register_and_login(api_client)
        response = await api_client.post(
            "/auth/logout", json={"refresh_token": tokens["refresh_token"]}
        )
        assert response.status_code == 401
        # The refresh token survives an unauthenticated logout attempt: one
        # account must not be able to log another one out.
        assert (
            await api_client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        ).status_code == 200

    async def test_does_not_affect_other_sessions_of_other_accounts(self, api_client):
        _, alice = await register_and_login(api_client)
        _, bob = await register_and_login(api_client)

        await api_client.post(
            "/auth/logout",
            json={"refresh_token": alice["refresh_token"]},
            headers={"Authorization": f"Bearer {alice['access_token']}"},
        )

        still_live = await api_client.get(
            "/auth/me", headers={"Authorization": f"Bearer {bob['access_token']}"}
        )
        assert still_live.status_code == 200
