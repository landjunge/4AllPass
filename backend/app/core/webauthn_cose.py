"""WebAuthn ceremony verification (COSE). Not vault-key material.

`fmt=none` registration extracts a public key bound to a server-issued
challenge. Assertion verification proves the authenticator still holds that
key. Neither path sees PRF output, DWK, DK, or the Vault Key.
"""

from __future__ import annotations

from dataclasses import dataclass

from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from webauthn import verify_authentication_response, verify_registration_response
from webauthn.helpers import bytes_to_base64url
from webauthn.helpers.exceptions import (
    InvalidAuthenticationResponse,
    InvalidRegistrationResponse,
)

from app.core.config import Settings


class CeremonyError(ValueError):
    """Client sent a WebAuthn blob the server cannot verify."""


@dataclass(frozen=True)
class VerifiedRegistration:
    credential_id: bytes
    public_key: bytes
    sign_count: int


@dataclass(frozen=True)
class VerifiedAssertion:
    credential_id: bytes
    sign_count: int


def _loopback_rp_ids(rp_id: str) -> bool:
    return rp_id in {"localhost", "127.0.0.1"}


def assert_rp_id(rp_id: str, settings: Settings) -> None:
    configured = settings.webauthn_rp_id
    if rp_id == configured:
        return
    if _loopback_rp_ids(rp_id) and _loopback_rp_ids(configured):
        return
    raise CeremonyError("rpId does not match this deployment")


def ecdsa_signature_to_der(signature: bytes) -> bytes:
    """WebAuthn ES256 signatures are IEEE P1363 (r||s). cryptography wants DER."""
    if len(signature) == 64:
        r = int.from_bytes(signature[:32], "big")
        s = int.from_bytes(signature[32:], "big")
        return encode_dss_signature(r, s)
    return signature


def allowed_origins(settings: Settings) -> list[str]:
    """Origins the authenticator is allowed to name in clientDataJSON.

    Production should set `FOURALLPASS_CORS_ORIGINS` to the PWA origin.
    Localhost and 127.0.0.1 are treated as the same host for dev/e2e.
    """
    seen: list[str] = []
    for origin in settings.cors_origins:
        for candidate in (origin, origin.replace("localhost", "127.0.0.1"), origin.replace("127.0.0.1", "localhost")):
            if candidate not in seen:
                seen.append(candidate)
    return seen


def _b64url_credential(
    *,
    credential_id: bytes,
    client_data_json: bytes,
    attestation_object: bytes | None = None,
    authenticator_data: bytes | None = None,
    signature: bytes | None = None,
) -> dict[str, object]:
    body: dict[str, object] = {
        "id": bytes_to_base64url(credential_id),
        "rawId": bytes_to_base64url(credential_id),
        "type": "public-key",
        "response": {
            "clientDataJSON": bytes_to_base64url(client_data_json),
        },
    }
    response = body["response"]
    assert isinstance(response, dict)
    if attestation_object is not None:
        response["attestationObject"] = bytes_to_base64url(attestation_object)
    if authenticator_data is not None:
        response["authenticatorData"] = bytes_to_base64url(authenticator_data)
    if signature is not None:
        response["signature"] = bytes_to_base64url(signature)
    return body


def verify_attestation(
    *,
    credential_id: bytes,
    client_data_json: bytes,
    attestation_object: bytes,
    expected_challenge: bytes,
    expected_rp_id: str,
    settings: Settings,
) -> VerifiedRegistration:
    assert_rp_id(expected_rp_id, settings)
    try:
        verified = verify_registration_response(
            credential=_b64url_credential(
                credential_id=credential_id,
                client_data_json=client_data_json,
                attestation_object=attestation_object,
            ),
            expected_challenge=expected_challenge,
            expected_rp_id=expected_rp_id,
            expected_origin=allowed_origins(settings),
            require_user_verification=True,
        )
    except InvalidRegistrationResponse as exc:
        raise CeremonyError(str(exc)) from exc
    if verified.credential_id != credential_id:
        raise CeremonyError("attestation credential id does not match the posted id")
    return VerifiedRegistration(
        credential_id=verified.credential_id,
        public_key=verified.credential_public_key,
        sign_count=verified.sign_count,
    )


def verify_assertion(
    *,
    credential_id: bytes,
    client_data_json: bytes,
    authenticator_data: bytes,
    signature: bytes,
    public_key: bytes,
    current_sign_count: int,
    expected_challenge: bytes,
    expected_rp_id: str,
    settings: Settings,
) -> VerifiedAssertion:
    assert_rp_id(expected_rp_id, settings)
    try:
        verified = verify_authentication_response(
            credential=_b64url_credential(
                credential_id=credential_id,
                client_data_json=client_data_json,
                authenticator_data=authenticator_data,
                signature=ecdsa_signature_to_der(signature),
            ),
            expected_challenge=expected_challenge,
            expected_rp_id=expected_rp_id,
            expected_origin=allowed_origins(settings),
            credential_public_key=public_key,
            credential_current_sign_count=current_sign_count,
            require_user_verification=True,
        )
    except InvalidAuthenticationResponse as exc:
        raise CeremonyError(str(exc)) from exc
    if verified.credential_id != credential_id:
        raise CeremonyError("assertion credential id does not match the stored id")
    return VerifiedAssertion(credential_id=verified.credential_id, sign_count=verified.new_sign_count)
