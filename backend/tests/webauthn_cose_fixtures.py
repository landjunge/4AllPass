"""Build fmt=none registration and ES256 assertion blobs for tests.

These are software keys. They prove the server verifies COSE against a
challenge. They are not platform authenticators and not PRF material.
"""

from __future__ import annotations

import hashlib
import json
import os
import struct

import cbor2
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives import hashes
from webauthn.helpers import bytes_to_base64url

ORIGIN = "http://localhost:5173"
RP_ID = "localhost"


def _cose_ec2_p256(public_key: ec.EllipticCurvePublicKey) -> bytes:
    numbers = public_key.public_numbers()
    return cbor2.dumps(
        {
            1: 2,
            3: -7,
            -1: 1,
            -2: numbers.x.to_bytes(32, "big"),
            -3: numbers.y.to_bytes(32, "big"),
        }
    )


def _client_data(*, webauthn_type: str, challenge: bytes, origin: str = ORIGIN) -> bytes:
    payload = {
        "type": webauthn_type,
        "challenge": bytes_to_base64url(challenge),
        "origin": origin,
        "crossOrigin": False,
    }
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


def _sign_es256(private_key: ec.EllipticCurvePrivateKey, data: bytes) -> bytes:
    der = private_key.sign(data, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    return r.to_bytes(32, "big") + s.to_bytes(32, "big")


def _auth_data(
    *,
    rp_id: str,
    sign_count: int,
    attested: bytes | None = None,
    flags: int = 0x05,
) -> bytes:
    rp_hash = hashlib.sha256(rp_id.encode("utf-8")).digest()
    body = rp_hash + bytes([flags]) + struct.pack(">I", sign_count)
    if attested is not None:
        body += attested
    return body


class SoftwarePasskey:
    def __init__(self, credential_id: bytes | None = None) -> None:
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = credential_id or os.urandom(16)
        self.sign_count = 0

    def registration(self, challenge: bytes, *, rp_id: str = RP_ID, origin: str = ORIGIN) -> dict[str, bytes]:
        cose = _cose_ec2_p256(self.private_key.public_key())
        attested = (
            b"\x00" * 16
            + struct.pack(">H", len(self.credential_id))
            + self.credential_id
            + cose
        )
        auth_data = _auth_data(rp_id=rp_id, sign_count=0, attested=attested, flags=0x45)
        attestation_object = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        return {
            "credential_id": self.credential_id,
            "client_data_json": _client_data(
                webauthn_type="webauthn.create", challenge=challenge, origin=origin
            ),
            "attestation_object": attestation_object,
        }

    def assertion(
        self, challenge: bytes, *, rp_id: str = RP_ID, origin: str = ORIGIN, sign_count: int | None = None
    ) -> dict[str, bytes]:
        self.sign_count = sign_count if sign_count is not None else self.sign_count + 1
        auth_data = _auth_data(rp_id=rp_id, sign_count=self.sign_count, flags=0x05)
        client_data = _client_data(webauthn_type="webauthn.get", challenge=challenge, origin=origin)
        signed = auth_data + hashlib.sha256(client_data).digest()
        return {
            "credential_id": self.credential_id,
            "client_data_json": client_data,
            "authenticator_data": auth_data,
            "signature": _sign_es256(self.private_key, signed),
        }
