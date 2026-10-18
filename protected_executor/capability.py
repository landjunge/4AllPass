"""Explicit test fixture capability, NOT a production trust or OS boundary.

No production host is implemented. This synthetic fixture can only provide a
fixed non-credential string. A same-UID unrestricted process can inspect/modify
Python memory: the nominal seal is not isolation or authenticated identity.
"""

from __future__ import annotations

from .contracts import ProtectedGrant, Rejected

# Public fixed dummy fixture, never a credential.
SYNTHETIC_SECRET = "synthetic-only-not-a-real-key"  # nosec B105
_TEST_ONLY_SEAL = object()


class SyntheticHostCapability:
    """One in-memory synthetic metadata fixture, no vault/material input or store."""

    __slots__ = ("_grant", "_seal")

    def __init__(self, grant: ProtectedGrant, *, _seal=None):
        if _seal is not _TEST_ONLY_SEAL or type(grant) is not ProtectedGrant:
            raise Rejected("protected_host_unavailable")
        self._grant, self._seal = grant, _seal

    @classmethod
    def for_test(cls, grant: ProtectedGrant) -> SyntheticHostCapability:
        return cls(grant, _seal=_TEST_ONLY_SEAL)

    def replace_metadata_for_test(self, grant: ProtectedGrant) -> None:
        if type(grant) is not ProtectedGrant:
            raise Rejected("protected_host_unavailable")
        self._grant = grant

    def _lookup(self, reference: str) -> ProtectedGrant:
        if reference != self._grant.reference:
            raise Rejected("grant_unavailable")
        return self._grant

    def _synthetic_material(self, expected: ProtectedGrant) -> str:
        if self._grant != expected:
            raise Rejected("grant_unavailable")
        return SYNTHETIC_SECRET


def require_synthetic_host(value: object) -> SyntheticHostCapability:
    if (
        type(value) is not SyntheticHostCapability
        or getattr(value, "_seal", None) is not _TEST_ONLY_SEAL
    ):
        raise Rejected("protected_host_unavailable")
    return value
