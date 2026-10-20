"""Deployment origin and same-origin ceremony policy, with software COSE keys."""
from __future__ import annotations

import hashlib
import json

import pytest

from app.core.config import Settings
from app.core.webauthn_cose import (
    CeremonyError, allowed_origins, assert_rp_id, verify_assertion, verify_attestation,
)
from tests.webauthn_cose_fixtures import SoftwarePasskey, _sign_es256

ORIGIN = "https://localhost.example.test"
RP_ID = "example.test"
CHALLENGE = b"\x17" * 32


def settings(**overrides):
    values = dict(environment="production", profile="server",
                  cors_origins=[ORIGIN], webauthn_rp_id=RP_ID)
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.mark.parametrize("environment", ["production", "development", "testing"])
def test_domain_substrings_never_create_another_allowed_origin(environment):
    configured = settings(environment=environment)
    assert allowed_origins(configured) == [ORIGIN]


@pytest.mark.parametrize("profile,environment,aliases", [
    ("server", "production", False), ("server", "staging", False),
    ("server", "development", True), ("server", "testing", True),
    ("local", "production", True),
])
def test_literal_loopback_aliases_are_limited_to_local_or_development(profile, environment, aliases):
    configured = settings(profile=profile, environment=environment,
                          cors_origins=["http://localhost:5173"], webauthn_rp_id="localhost")
    expected = ["http://localhost:5173"]
    if aliases:
        expected.append("http://127.0.0.1:5173")
    assert allowed_origins(configured) == expected
    assert_rp_id("localhost", configured)
    if aliases:
        assert_rp_id("127.0.0.1", configured)
    else:
        with pytest.raises(CeremonyError):
            assert_rp_id("127.0.0.1", configured)


def test_production_accepts_explicit_loopback_origins_without_deriving_others():
    origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
    assert allowed_origins(settings(cors_origins=origins)) == origins


@pytest.mark.parametrize("origin", [
    "https://localhost.example.test", "https://127.0.0.1.example.test",
    "https://example.test/localhost", "https://localhost@example.test",
    "https://localhost:5173/?next=localhost", "tauri://localhost",
])
def test_development_aliasing_does_not_rewrite_url_components(origin):
    assert allowed_origins(settings(environment="development", cors_origins=[origin])) == [origin]


@pytest.mark.parametrize("origin", [
    "http://local\thost:5173", "http://local\nhost:5173", "http://localhost:",
    " http://localhost:5173", "http://localhost:05173", "http://localhost:5173\n",
])
def test_invalid_alias_configuration_never_creates_a_valid_trust_target(origin):
    assert allowed_origins(settings(environment="development", cors_origins=[origin])) == [origin]


def _registration(key, origin=ORIGIN, client_fields=None):
    blob = key.registration(CHALLENGE, rp_id=RP_ID, origin=origin)
    if client_fields is not None:
        data = json.loads(blob["client_data_json"])
        data.update(client_fields)
        blob["client_data_json"] = json.dumps(data, separators=(",", ":")).encode()
    return blob


def _verify_registration(blob):
    return verify_attestation(**blob, expected_challenge=CHALLENGE,
                              expected_rp_id=RP_ID, settings=settings())


def _assertion(key, origin=ORIGIN, client_fields=None):
    blob = key.assertion(CHALLENGE, rp_id=RP_ID, origin=origin)
    if client_fields is not None:
        data = json.loads(blob["client_data_json"])
        data.update(client_fields)
        blob["client_data_json"] = json.dumps(data, separators=(",", ":")).encode()
        blob["signature"] = _sign_es256(
            key.private_key, blob["authenticator_data"] + hashlib.sha256(blob["client_data_json"]).digest(),
        )
    return blob


def _verify_assertion(blob, registration):
    return verify_assertion(**blob, public_key=registration.public_key,
                            current_sign_count=0, expected_challenge=CHALLENGE,
                            expected_rp_id=RP_ID, settings=settings())


def test_unconfigured_substring_origin_is_rejected_by_both_ceremonies():
    key = SoftwarePasskey()
    verified = _verify_registration(_registration(key))
    bad_origin = "https://127.0.0.1.example.test"
    with pytest.raises(CeremonyError):
        _verify_registration(_registration(key, origin=bad_origin))
    with pytest.raises(CeremonyError):
        _verify_assertion(_assertion(key, origin=bad_origin), verified)


@pytest.mark.parametrize("client_fields", [
    {"crossOrigin": True, "topOrigin": "https://foreign.example"},
    {"crossOrigin": True},
    {"crossOrigin": False, "topOrigin": "https://foreign.example"},
    {"crossOrigin": "false"}, {"crossOrigin": None}, {"crossOrigin": 0},
])
def test_embedding_or_invalid_context_is_rejected_even_with_a_valid_signature(client_fields):
    key = SoftwarePasskey()
    verified = _verify_registration(_registration(key))
    with pytest.raises(CeremonyError):
        _verify_registration(_registration(key, client_fields=client_fields))
    with pytest.raises(CeremonyError):
        _verify_assertion(_assertion(key, client_fields=client_fields), verified)


@pytest.mark.parametrize("legacy", [False, True])
@pytest.mark.parametrize("top_origin", [False, True])
def test_same_origin_context_still_accepts_valid_ceremonies(legacy, top_origin):
    key = SoftwarePasskey()
    registration = _registration(key)
    assertion = _assertion(key)
    if top_origin:
        for blob in (registration, assertion):
            data = json.loads(blob["client_data_json"])
            data["topOrigin"] = ORIGIN
            blob["client_data_json"] = json.dumps(data, separators=(",", ":")).encode()
    if legacy:
        for blob in (registration, assertion):
            data = json.loads(blob["client_data_json"])
            del data["crossOrigin"]
            blob["client_data_json"] = json.dumps(data, separators=(",", ":")).encode()
    if legacy or top_origin:
        assertion["signature"] = _sign_es256(
            key.private_key, assertion["authenticator_data"] + hashlib.sha256(assertion["client_data_json"]).digest(),
        )
    verified = _verify_registration(registration)
    assert _verify_assertion(assertion, verified).sign_count == 1
    assertion["signature"] = bytes(64)
    with pytest.raises(CeremonyError):
        _verify_assertion(assertion, verified)


@pytest.mark.parametrize("field", ["type", "challenge", "origin"])
def test_missing_client_data_fields_are_ceremony_errors(field):
    key = SoftwarePasskey()
    registration = _verify_registration(_registration(key))
    for blob, verify in (
        (_registration(key), _verify_registration),
        (_assertion(key), lambda value: _verify_assertion(value, registration)),
    ):
        data = json.loads(blob["client_data_json"])
        del data[field]
        blob["client_data_json"] = json.dumps(data).encode()
        if "authenticator_data" in blob:
            blob["signature"] = _sign_es256(
                key.private_key, blob["authenticator_data"] + hashlib.sha256(blob["client_data_json"]).digest(),
            )
        with pytest.raises(CeremonyError):
            verify(blob)


@pytest.mark.parametrize("field,value", [
    ("challenge", 1), ("challenge", "\u00e9"), ("origin", None), ("type", None),
    ("tokenBinding", {}),
])
def test_malformed_client_data_is_a_ceremony_error(field, value):
    key = SoftwarePasskey()
    registration = _verify_registration(_registration(key))
    with pytest.raises(CeremonyError):
        _verify_registration(_registration(key, client_fields={field: value}))
    with pytest.raises(CeremonyError):
        _verify_assertion(_assertion(key, client_fields={field: value}), registration)
