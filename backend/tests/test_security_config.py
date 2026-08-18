"""Signing-key configuration: the parts that only bite in production.

`app.core.security` caches both the settings and the loaded key, so each test
here rebuilds them explicitly. That is also the honest way to test it: the
production behaviour depends on process startup, not on a request.
"""

import uuid

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519

from app.core import security
from app.core.config import Settings, get_settings


@pytest.fixture(autouse=True)
def _reset_caches():
    """Every test starts and ends with the process-wide caches cleared."""
    get_settings.cache_clear()
    security._signing_key.cache_clear()
    security._password_hasher.cache_clear()
    yield
    get_settings.cache_clear()
    security._signing_key.cache_clear()
    security._password_hasher.cache_clear()


def _pem(key) -> str:
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()


def _configure(monkeypatch, **env: str) -> Settings:
    for key, value in env.items():
        monkeypatch.setenv(f"FOURALLPASS_{key.upper()}", value)
    get_settings.cache_clear()
    security._signing_key.cache_clear()
    return get_settings()


class TestConfiguredKeys:
    def test_signs_and_verifies_with_a_configured_ed25519_key(self, monkeypatch):
        _configure(
            monkeypatch,
            jwt_algorithm="EdDSA",
            jwt_private_key=_pem(ed25519.Ed25519PrivateKey.generate()),
        )
        subject = uuid.uuid4()
        token = security.create_access_token(subject)
        assert jwt.get_unverified_header(token.token)["alg"] == "EdDSA"
        assert security.decode_access_token(token.token).subject == subject

    def test_signs_and_verifies_with_a_configured_es256_key(self, monkeypatch):
        _configure(
            monkeypatch,
            jwt_algorithm="ES256",
            jwt_private_key=_pem(ec.generate_private_key(ec.SECP256R1())),
        )
        subject = uuid.uuid4()
        token = security.create_access_token(subject)
        assert jwt.get_unverified_header(token.token)["alg"] == "ES256"
        assert security.decode_access_token(token.token).subject == subject

    def test_exposes_the_matching_public_key(self, monkeypatch):
        key = ed25519.Ed25519PrivateKey.generate()
        _configure(monkeypatch, jwt_algorithm="EdDSA", jwt_private_key=_pem(key))

        exported = serialization.load_pem_public_key(security.public_key_pem().encode())
        token = security.create_access_token(uuid.uuid4())
        # A third party holding only the public half can verify, which is the
        # point of using an asymmetric algorithm here.
        settings = get_settings()
        jwt.decode(
            token.token,
            exported,
            algorithms=["EdDSA"],
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
        )


class TestProductionGuards:
    def test_production_refuses_to_start_without_a_configured_key(self, monkeypatch):
        _configure(monkeypatch, environment="production")
        monkeypatch.delenv("FOURALLPASS_JWT_PRIVATE_KEY", raising=False)
        get_settings.cache_clear()
        security._signing_key.cache_clear()

        with pytest.raises(RuntimeError, match="JWT_PRIVATE_KEY"):
            security.create_access_token(uuid.uuid4())

    def test_development_falls_back_to_an_ephemeral_key(self, monkeypatch, caplog):
        _configure(monkeypatch, environment="development")
        monkeypatch.delenv("FOURALLPASS_JWT_PRIVATE_KEY", raising=False)
        get_settings.cache_clear()
        security._signing_key.cache_clear()

        with caplog.at_level("WARNING"):
            token = security.create_access_token(uuid.uuid4())
        assert security.decode_access_token(token.token) is not None
        assert "ephemeral" in caplog.text


class TestTokenValidation:
    def test_rejects_a_token_signed_with_another_key(self, monkeypatch):
        settings = _configure(
            monkeypatch,
            jwt_algorithm="EdDSA",
            jwt_private_key=_pem(ed25519.Ed25519PrivateKey.generate()),
        )
        foreign = jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "iat": 1,
                "exp": 2**31,
                "jti": uuid.uuid4().hex,
                "iss": settings.jwt_issuer,
                "aud": settings.jwt_audience,
            },
            ed25519.Ed25519PrivateKey.generate(),
            algorithm="EdDSA",
        )
        with pytest.raises(security.InvalidTokenError):
            security.decode_access_token(foreign)

    @pytest.mark.parametrize("claim", ["sub", "iat", "exp", "jti", "iss", "aud"])
    def test_requires_every_claim(self, monkeypatch, claim):
        key = ed25519.Ed25519PrivateKey.generate()
        settings = _configure(monkeypatch, jwt_algorithm="EdDSA", jwt_private_key=_pem(key))
        payload = {
            "sub": str(uuid.uuid4()),
            "iat": 1,
            "exp": 2**31,
            "jti": uuid.uuid4().hex,
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
        }
        del payload[claim]
        token = jwt.encode(payload, key, algorithm="EdDSA")
        with pytest.raises(security.InvalidTokenError):
            security.decode_access_token(token)

    def test_rejects_a_foreign_issuer_or_audience(self, monkeypatch):
        key = ed25519.Ed25519PrivateKey.generate()
        settings = _configure(monkeypatch, jwt_algorithm="EdDSA", jwt_private_key=_pem(key))
        base = {
            "sub": str(uuid.uuid4()),
            "iat": 1,
            "exp": 2**31,
            "jti": uuid.uuid4().hex,
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
        }
        for override in ({"iss": "somebody-else"}, {"aud": "another-service"}):
            token = jwt.encode({**base, **override}, key, algorithm="EdDSA")
            with pytest.raises(security.InvalidTokenError):
                security.decode_access_token(token)

    def test_rejects_an_expired_token(self, monkeypatch):
        key = ed25519.Ed25519PrivateKey.generate()
        settings = _configure(monkeypatch, jwt_algorithm="EdDSA", jwt_private_key=_pem(key))
        token = jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "iat": 1,
                "exp": 2,
                "jti": uuid.uuid4().hex,
                "iss": settings.jwt_issuer,
                "aud": settings.jwt_audience,
            },
            key,
            algorithm="EdDSA",
        )
        with pytest.raises(security.InvalidTokenError):
            security.decode_access_token(token)

    def test_rejects_an_unsigned_token(self, monkeypatch):
        settings = _configure(
            monkeypatch,
            jwt_algorithm="EdDSA",
            jwt_private_key=_pem(ed25519.Ed25519PrivateKey.generate()),
        )
        unsigned = jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "iat": 1,
                "exp": 2**31,
                "jti": uuid.uuid4().hex,
                "iss": settings.jwt_issuer,
                "aud": settings.jwt_audience,
            },
            key=None,
            algorithm="none",
        )
        with pytest.raises(security.InvalidTokenError):
            security.decode_access_token(unsigned)
