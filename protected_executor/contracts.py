"""Versioned metadata only. Matching these claims does not authenticate a host."""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass

GRANT_SCHEMA = "4allpass-protected-grant-v1"
REQUEST_SCHEMA = "4allpass-protected-use-v1"
MAX_GRANT_TTL_SECONDS = 86_400  # Existing ACCESS_TTL_SECONDS_MAX; no unlimited grant.
_ID = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")
_HASH = re.compile(r"[a-f0-9]{64}\Z")


class Rejected(Exception):
    """Stable codes only; no input, provider, or secret details."""


@dataclass(frozen=True)
class Binding:
    project_id: str
    workflow_id: str
    task_id: str
    actor_id: str
    consumer_id: str
    attempt_id: str
    request_hash: str


@dataclass(frozen=True)
class UseRequest:
    binding: Binding
    grant_ref: str
    operation: str = "demo.quota.read"
    target_id: str = "demo-quota-v1"
    origin_ref: str | None = None
    principal_ref: str | None = None
    grant_version: int | None = None
    schema_version: str = REQUEST_SCHEMA

    def content_hash(self) -> str:
        # Hash excludes itself, includes the exact task/attempt, configured scope,
        # grant version, operation and target. It is correlation, not identity.
        fields = {
            "schema_version": self.schema_version,
            "grant_ref": self.grant_ref,
            "operation": self.operation,
            "target_id": self.target_id,
            "origin_ref": self.origin_ref,
            "principal_ref": self.principal_ref,
            "grant_version": self.grant_version,
            **{
                name: getattr(self.binding, name)
                for name in (
                    "project_id",
                    "workflow_id",
                    "task_id",
                    "actor_id",
                    "consumer_id",
                    "attempt_id",
                )
            },
        }
        return hashlib.sha256(
            json.dumps(fields, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()


@dataclass(frozen=True)
class ProtectedGrant:
    """Metadata provided by a host/consent source; never agent authorization.

    No secret field, material reference, callback, caller URL or claimed trust flag.
    The present implementation has no production host that can issue this grant.
    """

    reference: str
    project_id: str
    workflow_id: str
    task_id: str
    actor_id: str
    consumer_id: str
    attempt_id: str
    origin_ref: str
    principal_ref: str
    request_hash: str
    grant_version: int
    target_id: str
    operation: str
    issued_at: float
    expires_at: float
    lifecycle: str
    consent_ref: str
    schema_version: str = GRANT_SCHEMA


# Historical prototype import remains resolvable, but its old secret-bearing
# constructor is intentionally unsupported and cannot activate an executor.
Grant = ProtectedGrant


def _id(value: object) -> None:
    if type(value) is not str or not _ID.fullmatch(value):
        raise Rejected("invalid_binding")


def _hash(value: object) -> None:
    if type(value) is not str or not _HASH.fullmatch(value):
        raise Rejected("invalid_request_hash")


def _version(value: object) -> None:
    if type(value) is not int or not 1 <= value <= 2**31 - 1:
        raise Rejected("invalid_grant_version")


def _time(value: object) -> float:
    # Reject bool, strings, NaN/inf and enormous integers BEFORE comparisons.
    if type(value) not in (int, float):
        raise Rejected("invalid_grant_time")
    try:
        number = float(value)
    except (ValueError, OverflowError):
        raise Rejected("invalid_grant_time") from None
    if not math.isfinite(number) or not 0 <= number <= 2**53:
        raise Rejected("invalid_grant_time")
    return number


def validate_request(request: UseRequest) -> None:
    if type(request) is not UseRequest or type(request.binding) is not Binding:
        raise Rejected("invalid_binding")
    if request.schema_version != REQUEST_SCHEMA:
        raise Rejected("unsupported_request_schema")
    for value in (
        request.grant_ref,
        request.origin_ref,
        request.principal_ref,
        *(
            getattr(request.binding, name)
            for name in (
                "project_id",
                "workflow_id",
                "task_id",
                "actor_id",
                "consumer_id",
                "attempt_id",
            )
        ),
    ):
        _id(value)
    _version(request.grant_version)
    _hash(request.binding.request_hash)
    if request.operation != "demo.quota.read" or request.target_id != "demo-quota-v1":
        raise Rejected("unsupported_operation")
    if request.binding.request_hash != request.content_hash():
        raise Rejected("content_conflict")


def validate_grant(request: UseRequest, grant: ProtectedGrant, now: object) -> None:
    """Validate both complete records and lifetime on every actual send.

    This pure consistency check provides no host/identity/OS-boundary proof.
    """
    validate_request(request)
    if type(grant) is not ProtectedGrant or grant.schema_version != GRANT_SCHEMA:
        raise Rejected("unsupported_grant_schema")
    for name in (
        "reference",
        "project_id",
        "workflow_id",
        "task_id",
        "actor_id",
        "consumer_id",
        "attempt_id",
        "origin_ref",
        "principal_ref",
        "consent_ref",
    ):
        _id(getattr(grant, name))
    _hash(grant.request_hash)
    _version(grant.grant_version)
    issued, expires, current = (
        _time(grant.issued_at),
        _time(grant.expires_at),
        _time(now),
    )
    if not 0 < expires - issued <= MAX_GRANT_TTL_SECONDS:
        raise Rejected("invalid_grant_time")
    if type(grant.lifecycle) is not str or grant.lifecycle not in {
        "active",
        "revoked",
        "expired",
    }:
        raise Rejected("invalid_grant_lifecycle")
    if grant.lifecycle != "active" or not issued <= current < expires:
        raise Rejected("grant_unavailable")
    expected = {
        "reference": request.grant_ref,
        "origin_ref": request.origin_ref,
        "principal_ref": request.principal_ref,
        "grant_version": request.grant_version,
        "operation": request.operation,
        "target_id": request.target_id,
        "request_hash": request.binding.request_hash,
        **{
            name: getattr(request.binding, name)
            for name in (
                "project_id",
                "workflow_id",
                "task_id",
                "actor_id",
                "consumer_id",
                "attempt_id",
            )
        },
    }
    if any(getattr(grant, name) != value for name, value in expected.items()):
        raise Rejected("grant_binding_mismatch")
