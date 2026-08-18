"""Unit tests for the session cookie, the origin matcher and password hashing.

These cover the settings a request-level test cannot reach: the suite runs in a
development environment, so `Secure` is off and the production cookie has to be
checked by building it directly.
"""

from __future__ import annotations

import pytest
from fastapi import Response
from pydantic import ValidationError

from app.core.config import Settings
from app.core.origin import is_allowed_origin
from app.core.security import (
    generate_session_token,
    hash_password,
    hash_session_token,
    password_needs_rehash,
    verify_password,
)
from app.core.sessions import clear_session_cookie, set_session_cookie


def _settings(**overrides) -> Settings:
    base = {
        "environment": "production",
        "password_hash_time_cost": 1,
        "password_hash_memory_cost_kib": 512,
        "password_hash_parallelism": 1,
    }
    return Settings(**{**base, **overrides})


# --------------------------------------------------------------------------
# Session cookie
# --------------------------------------------------------------------------


def test_the_production_cookie_is_secure_httponly_and_samesite():
    response = Response()
    set_session_cookie(response, "a-token", settings=_settings())

    header = response.headers["set-cookie"]
    assert header.startswith("fourallpass_session=a-token")
    assert "HttpOnly" in header
    assert "Secure" in header
    assert "SameSite=lax" in header
    assert "Max-Age=1209600" in header


def test_secure_is_off_only_in_a_development_environment():
    assert _settings(environment="development").cookie_secure is False
    assert _settings(environment="production").cookie_secure is True
    assert _settings(environment="staging").cookie_secure is True
    # An unknown environment name fails closed rather than open.
    assert _settings(environment="whatever-this-is").cookie_secure is True


def test_secure_can_be_forced_on_in_development():
    assert _settings(environment="development", session_cookie_secure=True).cookie_secure is True


def test_samesite_none_without_secure_is_refused_at_startup():
    with pytest.raises(ValidationError):
        _settings(
            environment="development",
            session_cookie_samesite="none",
            session_cookie_secure=False,
        )


def test_a_wildcard_cors_origin_is_refused_at_startup():
    """The API is credentialed, so `*` is not a harmless default.

    Starlette echoes the caller's own origin when credentials are allowed, so a
    wildcard would let any site read a signed-in user's vault metadata.
    """
    with pytest.raises(ValidationError):
        _settings(cors_origins=["*"])

    assert _settings(cors_origins=["https://vault.example"]).cors_origins == [
        "https://vault.example"
    ]


def test_clearing_the_cookie_keeps_the_same_attributes():
    response = Response()
    clear_session_cookie(response, settings=_settings())

    header = response.headers["set-cookie"]
    # Attributes have to match the cookie that was set, or the browser keeps
    # the original and the logout appears to do nothing.
    assert "HttpOnly" in header
    assert "Secure" in header
    assert "SameSite=lax" in header
    assert "Max-Age=0" in header


# --------------------------------------------------------------------------
# Origin matching
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("origin", "host", "allowed"),
    [
        ("https://vault.example", "vault.example", True),
        # The proxy terminated TLS and forwarded `http`; host still matches.
        ("https://vault.example", "vault.example", True),
        ("http://vault.example:8000", "vault.example:8000", True),
        ("https://vault.example", "other.example", False),
        ("https://vault.example.evil", "vault.example", False),
        ("https://evil.example", "vault.example", False),
        ("null", "vault.example", False),
        ("", "vault.example", False),
        ("not a url", "vault.example", False),
        # Port is part of the comparison: a different port is a different origin.
        ("http://vault.example:9999", "vault.example", False),
    ],
)
def test_origin_is_matched_against_the_deployments_own_host(origin, host, allowed):
    assert is_allowed_origin(origin, host, []) is allowed


def test_a_configured_origin_is_allowed_even_when_the_host_differs():
    assert is_allowed_origin("http://localhost:5173", "localhost:8000", ["http://localhost:5173"])
    assert not is_allowed_origin("http://localhost:5174", "localhost:8000", ["http://localhost:5173"])


def test_matching_ignores_scheme_but_not_authority():
    # A TLS-terminating proxy makes the scheme unreliable; the authority is not.
    assert is_allowed_origin("https://vault.example", "vault.example", [])
    assert not is_allowed_origin("https://attacker.example", "vault.example", [])


# --------------------------------------------------------------------------
# Password hashing
# --------------------------------------------------------------------------


def test_hashing_the_same_password_twice_gives_different_hashes():
    first = hash_password("correct-horse-battery-staple")
    second = hash_password("correct-horse-battery-staple")

    assert first != second
    assert first.startswith("$argon2id$")
    assert verify_password("correct-horse-battery-staple", first)
    assert verify_password("correct-horse-battery-staple", second)


def test_a_wrong_password_does_not_verify():
    stored = hash_password("correct-horse-battery-staple")

    assert not verify_password("correct-horse-battery-stapl", stored)
    assert not verify_password("", stored)


def test_an_account_without_a_password_never_verifies():
    assert not verify_password("anything at all", None)


def test_a_corrupt_stored_hash_is_a_failed_login_not_a_crash():
    assert not verify_password("correct-horse-battery-staple", "not-a-phc-string")


def test_a_hash_from_weaker_parameters_is_flagged_for_rehash():
    # Produced under the suite's deliberately cheap parameters.
    weak = "$argon2id$v=19$m=8,t=1,p=1$c29tZXNhbHRzb21lc2E$3g2Z2iVoDCA6VjVGDsxdMH0ZzTGbnkJ8Vz0DfNXVJv0"
    assert password_needs_rehash(weak)


def test_an_unparseable_hash_is_treated_as_needing_a_rehash():
    assert password_needs_rehash("not-a-phc-string")


# --------------------------------------------------------------------------
# Session tokens
# --------------------------------------------------------------------------


def test_session_tokens_are_unique_and_long_enough():
    tokens = {generate_session_token() for _ in range(256)}

    assert len(tokens) == 256
    # 32 random bytes in urlsafe base64, unpadded.
    assert all(len(token) >= 43 for token in tokens)


def test_the_token_digest_is_deterministic_and_hides_the_token():
    token = generate_session_token()

    assert hash_session_token(token) == hash_session_token(token)
    assert hash_session_token(token) != hash_session_token(generate_session_token())
    assert len(hash_session_token(token)) == 32
    assert token.encode() not in hash_session_token(token)
