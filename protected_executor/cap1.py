"""Local 4AP-CAP-1 candidate for the synthetic executor.

The detached Ed25519 proof and encoding here are a fixture profile. Production
wire format, issuer enrollment and durable nonce store are separate decisions.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from dataclasses import asdict, dataclass

from .contracts import MAX_GRANT_TTL_SECONDS, Rejected, UseRequest

_ID = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")
_NONCE = re.compile(r"[a-f0-9]{32}\Z")


@dataclass(frozen=True, repr=False)
class CapabilityClaims:
    capability_id: str
    grant_ref: str
    principal: str
    request_hash: str
    aud: str
    nonce: str
    iat: int
    expires_at: int
    v: str = "4AP-CAP-1"

    def signing_bytes(self) -> bytes:
        data = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))
        return b"4AP-CAP-1 local fixture\x00" + data.encode("ascii")


@dataclass(frozen=True, repr=False)
class SignedCapability:
    claims: CapabilityClaims
    signature: bytes


@dataclass(frozen=True)
class LocalCapabilityVerifier:
    """Trusted fixture dependencies chosen by the local host.

    consume_nonce atomically inserts a digest and its signed expiry. It returns
    False when that digest already exists. Store failures raise an exception.
    """

    expected_audience: str
    issuer_ref: str
    verify_signature: Callable[[bytes, bytes], bool]
    consume_nonce: Callable[[str, int], bool]

    def claim(
        self, request: UseRequest, proof: SignedCapability, now: float
    ) -> tuple[int, int]:
        if (
            type(self.expected_audience) is not str
            or not _ID.fullmatch(self.expected_audience)
            or type(self.issuer_ref) is not str
            or not _ID.fullmatch(self.issuer_ref)
        ):
            raise Rejected("capability_verifier_unavailable")
        if (
            type(proof) is not SignedCapability
            or type(proof.claims) is not CapabilityClaims
        ):
            raise Rejected("invalid_capability")
        claims = proof.claims
        if type(claims.aud) is not str or claims.aud != self.expected_audience:
            raise Rejected("capability_audience_mismatch")
        if (
            type(claims.v) is not str
            or claims.v != "4AP-CAP-1"
            or type(claims.capability_id) is not str
            or not _ID.fullmatch(claims.capability_id)
            or type(proof.signature) is not bytes
            or len(proof.signature) != 64
        ):
            raise Rejected("invalid_capability")
        if (
            type(claims.grant_ref) is not str
            or type(claims.principal) is not str
            or type(claims.request_hash) is not str
            or claims.grant_ref != request.grant_ref
            or claims.principal != request.principal_ref
            or claims.request_hash != request.binding.request_hash
        ):
            raise Rejected("capability_binding_mismatch")
        if type(claims.nonce) is not str or not _NONCE.fullmatch(claims.nonce):
            raise Rejected("invalid_capability_nonce")
        if (
            type(claims.iat) is not int
            or type(claims.expires_at) is not int
            or not 0 <= claims.iat < claims.expires_at <= 2**53
            or claims.expires_at - claims.iat > MAX_GRANT_TTL_SECONDS
        ):
            raise Rejected("invalid_capability_time")
        if not claims.iat <= now < claims.expires_at:
            raise Rejected("capability_time_unavailable")

        try:
            verified = self.verify_signature(claims.signing_bytes(), proof.signature)
        except Exception:  # noqa: BLE001 - never propagate dependency input or errors
            raise Rejected("capability_verifier_unavailable") from None
        if verified is not True:
            raise Rejected("capability_signature_invalid")

        # Attempt identity stays in the signed request hash, but never partitions
        # replay protection. Retain only a digest in the store.
        identity = json.dumps(
            [self.issuer_ref, claims.aud, claims.nonce], separators=(",", ":")
        )
        nonce_digest = hashlib.sha256(identity.encode("ascii")).hexdigest()
        try:
            consumed = self.consume_nonce(nonce_digest, claims.expires_at)
        except Exception:  # noqa: BLE001 - suppress storage paths and records
            raise Rejected("capability_nonce_store_unavailable") from None
        if consumed is False:
            raise Rejected("capability_nonce_used")
        if consumed is not True:
            raise Rejected("capability_nonce_store_unavailable")
        return claims.iat, claims.expires_at
