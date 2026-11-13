"""Server-side verification for v2 signed writes (ADR-015 step 3).

Default off. The canonical bytes come from ``app.core.write_request``; this
module only supplies the server's view of the same values, verifies Ed25519,
and maintains the receipt/nonce/key rows. It intentionally does not sign
anything and never stores request or response bodies.

Order is the contract order: session/device authentication and the vault lock
happen in the route dependencies, then receipt lookup, then timestamp/key/
nonce/signature checks, then a receipt claim *before* the mutation.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.write_request import (
    WriteRequestV2,
    decode_base64url_canonical,
    write_payload_digest_v2,
    write_public_key_digest_v2,
    write_request_bytes_v2,
)
from app.models.signed_write import VaultWriteKey, WriteGrant, WriteNonce, WriteReceipt
from app.models.snapshot import VaultSnapshot
from app.models.vault import Vault

SCHEME = "ed25519-v1"
SIGNATURE_BYTES = 64
PUBLIC_KEY_BYTES = 32
MANIFEST_LABEL = "4allpass-sealed-manifest-digest-v1"
REPLAYABLE = True


class SignedWriteReplay(Exception):
    """Authorized exact retry: return the stored receipt, no mutation."""

    def __init__(self, receipt: dict[str, Any]) -> None:
        self.receipt = receipt


@dataclass(frozen=True)
class SignedHeaders:
    operation_id: uuid.UUID
    nonce: bytes
    timestamp: int
    key_version: int
    result_key_version: int
    resource_type: str
    resource_id: str
    parent_id: str
    base_revision: int
    result_revision: int
    signature: bytes
    next_signature: bytes | None
    next_public_key: bytes | None
    grant: str | None
    payload_digest: bytes


@dataclass
class PreparedWrite:
    operation_id: uuid.UUID
    request_digest: bytes
    route: str
    resource_type: str
    resource_id: str
    parent_id: str
    key_version: int
    result_key_version: int
    rotate: bool
    bootstrap: bool


def _fail(code: int, detail: str) -> None:
    raise HTTPException(status_code=code, detail=detail)


def _header(request: Request, name: str) -> str | None:
    return request.headers.get(name)


def _required_uuid(value: str | None, name: str) -> uuid.UUID:
    if value is None:
        _fail(422, f"missing {name}")
    try:
        return uuid.UUID(value)
    except ValueError:
        _fail(422, f"invalid {name}")


def _required_int(value: str | None, name: str, *, minimum: int = 0) -> int:
    if value is None:
        _fail(422, f"missing {name}")
    try:
        number = int(value)
    except ValueError:
        _fail(422, f"invalid {name}")
    if number < minimum or number > 0xFFFFFFFF:
        _fail(422, f"invalid {name}")
    return number


def _b64(value: str | None, name: str, *, length: int | None = None) -> bytes:
    if value is None:
        _fail(422, f"missing {name}")
    try:
        raw = decode_base64url_canonical(name, value)
    except Exception as exc:  # WriteRequestV2Error is a ValueError
        raise HTTPException(status_code=422, detail=f"invalid {name}") from exc
    if length is not None and len(raw) != length:
        _fail(422, f"invalid {name}")
    return raw


def parse_headers(request: Request, payload_digest: bytes, *, grant: str | None) -> SignedHeaders:
    if _header(request, "X-4AP-Write-Scheme") != SCHEME:
        _fail(422, "signed_write_required")
    next_public_key = (
        _b64(_header(request, "X-4AP-Write-Next-Public-Key"), "nextPublicKey", length=PUBLIC_KEY_BYTES)
        if _header(request, "X-4AP-Write-Next-Public-Key")
        else None
    )
    return SignedHeaders(
        operation_id=_required_uuid(_header(request, "X-4AP-Write-Operation-Id"), "operationId"),
        nonce=_b64(_header(request, "X-4AP-Write-Nonce"), "nonce", length=16),
        timestamp=_required_int(_header(request, "X-4AP-Write-Timestamp"), "timestamp"),
        key_version=_required_int(_header(request, "X-4AP-Write-Key-Version"), "keyVersion", minimum=1),
        result_key_version=_required_int(
            _header(request, "X-4AP-Write-Result-Key-Version"), "resultKeyVersion", minimum=1
        ),
        resource_type=_header(request, "X-4AP-Write-Resource-Type") or "",
        resource_id=_b64(_header(request, "X-4AP-Write-Resource-Id"), "resourceId").decode("utf-8"),
        parent_id=_b64(_header(request, "X-4AP-Write-Parent-Id"), "parentId").decode("utf-8"),
        base_revision=_required_int(_header(request, "X-4AP-Write-Base-Revision"), "baseRevision"),
        result_revision=_required_int(_header(request, "X-4AP-Write-Result-Revision"), "resultRevision"),
        signature=_b64(_header(request, "X-4AP-Write-Signature"), "signature", length=SIGNATURE_BYTES),
        next_signature=(
            _b64(_header(request, "X-4AP-Write-Next-Signature"), "nextSignature", length=SIGNATURE_BYTES)
            if _header(request, "X-4AP-Write-Next-Signature")
            else None
        ),
        next_public_key=next_public_key,
        grant=grant,
        payload_digest=payload_digest,
    )


def sealed_manifest_digest(manifest: dict[str, Any]) -> bytes:
    """Mirror of the TS ``sealedManifestDigest`` framing (uint32be lengths)."""
    from app.core.write_request import _frame, _frame_str, _frame_u32  # local import: private helpers

    return hashlib.sha256(
        b"".join(
            [
                _frame_str(MANIFEST_LABEL),
                _frame_u32(int(manifest["version"])),
                _frame_str(str(manifest["nonce"])),
                _frame_str(str(manifest["ciphertext"])),
                _frame_str(str(manifest["tag"])),
            ]
        )
    ).digest()


def active_manifest_digest(snapshot: VaultSnapshot | None) -> bytes:
    if snapshot is None or snapshot.sealed_manifest is None:
        return b""
    return sealed_manifest_digest(snapshot.sealed_manifest)


def canonical_request(
    *,
    vault: Vault,
    device_id: str,
    method: str,
    route: str,
    headers: SignedHeaders,
    has_manifest: bool,
    manifest_digest: bytes,
    has_next_key: bool,
    next_public_key: bytes | None,
) -> WriteRequestV2:
    return WriteRequestV2(
        vaultId=str(vault.id),
        deviceId=device_id,
        method=method,
        route=route,
        resourceType=headers.resource_type,
        resourceId=headers.resource_id,
        parentId=headers.parent_id,
        baseRevision=headers.base_revision,
        resultRevision=headers.result_revision,
        signingKeyVersion=headers.key_version,
        resultKeyVersion=headers.result_key_version,
        hasManifest=1 if has_manifest else 0,
        manifestDigest=manifest_digest if has_manifest else b"",
        payloadDigest=headers.payload_digest,
        hasNextKey=1 if has_next_key else 0,
        nextPublicKeyDigest=write_public_key_digest_v2(next_public_key) if has_next_key else b"",
        operationId=str(headers.operation_id),
        nonce=headers.nonce,
        timestamp=headers.timestamp,
    )


def _verify(public_key: bytes, message: bytes, signature: bytes) -> None:
    try:
        Ed25519PublicKey.from_public_bytes(public_key).verify(signature, message)
    except (InvalidSignature, ValueError):
        _fail(403, "write_signature_invalid")


def _request_digest(message: bytes) -> bytes:
    return hashlib.sha256(message).digest()


def _receipt(
    *,
    receipt: WriteReceipt,
    status_code: int,
    code: str,
    result: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schema": "4allpass-write-receipt-v1",
        "operationId": str(receipt.operation_id),
        "vaultId": str(receipt.vault_id),
        "route": receipt.route,
        "resource": {
            "type": receipt.resource_type,
            "id": receipt.resource_id,
            "parentId": receipt.parent_id,
        },
        "outcome": {"status": status_code, "code": code},
        "result": result,
        "replayable": REPLAYABLE,
        "bodyAvailable": False,
        "responseDigest": receipt.response_digest.hex() if receipt.response_digest else None,
        "createdAt": receipt.created_at.isoformat(),
    }


async def _lookup_receipt(
    db: AsyncSession, vault_id: uuid.UUID, operation_id: uuid.UUID
) -> WriteReceipt | None:
    return await db.scalar(
        select(WriteReceipt).where(
            WriteReceipt.vault_id == vault_id, WriteReceipt.operation_id == operation_id
        )
    )


async def prepare(
    db: AsyncSession,
    *,
    vault: Vault,
    request: Request,
    user_id: uuid.UUID,
    device_id: str,
    method: str,
    route: str,
    resource_type: str,
    resource_id: str,
    parent_id: str,
    payload_digest: bytes,
    base_revision: int,
    result_revision: int,
    has_manifest: bool,
    manifest_digest: bytes,
    payload_vault_key_version: int | None = None,
    bootstrap_allowed: bool = False,
    creation_grant: str | None = None,
) -> PreparedWrite | None:
    """Verify one signed write and claim its operation id.

    Returns ``None`` for a v1 vault with no signed headers (legacy path).
    Raises ``SignedWriteReplay`` for an authorized exact retry.
    """
    settings = get_settings()
    scheme = _header(request, "X-4AP-Write-Scheme")
    if vault.crypto_protocol_version < 2:
        if scheme is not None:
            _fail(422, "signed_write_not_supported_for_v1")
        return None
    if not settings.signed_writes_enabled:
        _fail(403, "signed_writes_disabled")

    headers = parse_headers(request, payload_digest, grant=creation_grant)
    if (
        headers.resource_type != resource_type
        or headers.resource_id != resource_id
        or headers.parent_id != parent_id
    ):
        _fail(422, "write_resource_mismatch")
    if headers.key_version > headers.result_key_version:
        _fail(422, "write_key_version_order")
    has_next_key = headers.next_public_key is not None
    rotate = headers.result_key_version == headers.key_version + 1
    if not rotate and headers.result_key_version != headers.key_version:
        _fail(422, "write_key_version_order")

    message = write_request_bytes_v2(
        canonical_request(
            vault=vault,
            device_id=device_id,
            method=method,
            route=route,
            headers=headers,
            has_manifest=has_manifest,
            manifest_digest=manifest_digest,
            has_next_key=has_next_key,
            next_public_key=headers.next_public_key,
        )
    )
    request_digest = _request_digest(message)

    # Receipt first: an existing operation always ends here, never falls
    # through to a new mutation (V3 §1.1 step 6).
    existing = await _lookup_receipt(db, vault.id, headers.operation_id)
    if existing is not None:
        if (
            existing.owner_user_id != user_id
            or existing.device_id != device_id
            or existing.route != route
            or existing.resource_type != resource_type
            or existing.resource_id != resource_id
            or existing.parent_id != parent_id
        ):
            _fail(404, "not_found")
        context = existing.signed_context or {}
        incoming = {
            "nonce": headers.nonce.hex(),
            "timestamp": headers.timestamp,
            "keyVersion": headers.key_version,
            "resultKeyVersion": headers.result_key_version,
            "baseRevision": headers.base_revision,
            "resultRevision": headers.result_revision,
            "resourceType": headers.resource_type,
            "resourceId": headers.resource_id,
            "parentId": headers.parent_id,
            "payloadDigest": headers.payload_digest.hex(),
            "hasNextKey": 1 if headers.next_public_key is not None else 0,
            "nextPublicKeyDigest": (
                write_public_key_digest_v2(headers.next_public_key).hex()
                if headers.next_public_key is not None
                else None
            ),
        }
        if context != incoming:
            _fail(409, "write_operation_mismatch")
        if existing.status != "committed" or existing.outcome_status is None:
            _fail(409, "write_incomplete")
        raise SignedWriteReplay(
            _receipt(
                receipt=existing,
                status_code=existing.outcome_status,
                code=existing.outcome_code or "ok",
                result=existing.result or {},
            )
        )

    if headers.base_revision != base_revision or headers.result_revision != result_revision:
        _fail(409, "write_revision_conflict")
    if payload_vault_key_version is not None:
        expected = headers.result_key_version if rotate else headers.key_version
        if payload_vault_key_version != expected:
            _fail(422, "write_vault_key_version_mismatch")

    now = datetime.now(timezone.utc)
    if abs(int(now.timestamp()) - headers.timestamp) > settings.signed_write_window_seconds:
        _fail(409, "write_timestamp_stale")

    keys = await db.execute(
        select(VaultWriteKey)
        .where(VaultWriteKey.vault_id == vault.id)
        .order_by(VaultWriteKey.key_version.desc())
    )
    key_rows = list(keys.scalars().all())
    current = key_rows[0] if key_rows else None

    bootstrap = False
    if current is None:
        if not bootstrap_allowed or resource_type != "device":
            _fail(403, "write_bootstrap_route_invalid")
        if headers.key_version != 1 or headers.result_key_version != 1:
            _fail(422, "write_bootstrap_key_version_invalid")
        if not has_next_key or headers.next_public_key is None or headers.next_signature is None:
            _fail(403, "write_key_unknown")
        await bootstrap_check(db, vault.id, creation_grant, headers)
        bootstrap = True
        _verify(headers.next_public_key, message, headers.next_signature)
    else:
        if headers.key_version != current.key_version or current.retired_at is not None:
            _fail(409, "write_key_version_mismatch")
        if not rotate and has_next_key:
            _fail(422, "write_next_key_mismatch")
        _verify(current.public_key, message, headers.signature)
        if rotate:
            if headers.next_signature is None or headers.next_public_key is None:
                _fail(422, "write_next_key_missing")
            _verify(headers.next_public_key, message, headers.next_signature)

    nonce_exists = await db.scalar(
        select(WriteNonce.id).where(
            WriteNonce.vault_id == vault.id,
            WriteNonce.key_version == headers.key_version,
            WriteNonce.nonce == headers.nonce,
        )
    )
    if nonce_exists is not None:
        _fail(409, "write_nonce_reused")

    # Claim before mutation. A failure rolls the whole transaction back,
    # including this row, so no receipt exists without its effect.
    db.add(
        WriteReceipt(
            vault_id=vault.id,
            operation_id=headers.operation_id,
            owner_user_id=user_id,
            device_id=device_id,
            route=route,
            resource_type=resource_type,
            resource_id=resource_id,
            parent_id=parent_id,
            request_digest=request_digest,
            status="pending",
            signed_context={
                "nonce": headers.nonce.hex(),
                "timestamp": headers.timestamp,
                "keyVersion": headers.key_version,
                "resultKeyVersion": headers.result_key_version,
                "baseRevision": headers.base_revision,
                "resultRevision": headers.result_revision,
                "resourceType": headers.resource_type,
                "resourceId": headers.resource_id,
                "parentId": headers.parent_id,
                "payloadDigest": headers.payload_digest.hex(),
                "hasNextKey": 1 if headers.next_public_key is not None else 0,
                "nextPublicKeyDigest": (
                    write_public_key_digest_v2(headers.next_public_key).hex()
                    if headers.next_public_key is not None
                    else None
                ),
            },
        )
    )
    db.add(WriteNonce(vault_id=vault.id, key_version=headers.key_version, nonce=headers.nonce))
    if bootstrap:
        db.add(
            VaultWriteKey(vault_id=vault.id, key_version=headers.key_version, public_key=headers.next_public_key or b"")
        )
    elif rotate:
        current.retired_at = now
        db.add(
            VaultWriteKey(
                vault_id=vault.id,
                key_version=headers.result_key_version,
                public_key=headers.next_public_key or b"",
            )
        )
    await db.flush()
    return PreparedWrite(
        operation_id=headers.operation_id,
        request_digest=request_digest,
        route=route,
        resource_type=resource_type,
        resource_id=resource_id,
        parent_id=parent_id,
        key_version=headers.key_version,
        result_key_version=headers.result_key_version,
        rotate=rotate,
        bootstrap=bootstrap,
    )


async def bootstrap_check(db: AsyncSession, vault_id: uuid.UUID, grant: str | None, headers: SignedHeaders) -> None:
    if not grant:
        _fail(403, "creation_grant_required")
    token_hash = hashlib.sha256(grant.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)
    row = await db.scalar(
        select(WriteGrant).where(WriteGrant.vault_id == vault_id, WriteGrant.token_hash == token_hash)
    )
    expires_at = row.expires_at if row is not None else None
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if row is None or row.consumed_at is not None or expires_at <= now:
        _fail(403, "creation_grant_invalid")
    if row.purpose != "initial-key":
        _fail(403, "creation_grant_invalid")
    row.consumed_at = now


async def finalize(
    db: AsyncSession,
    prepared: PreparedWrite,
    *,
    vault_id: uuid.UUID,
    status_code: int,
    code: str,
    result: dict[str, Any],
) -> dict[str, Any]:
    receipt = await db.scalar(
        select(WriteReceipt).where(
            WriteReceipt.vault_id == vault_id, WriteReceipt.operation_id == prepared.operation_id
        )
    )
    if receipt is None:  # pragma: no cover - prepare inserted it in this transaction
        _fail(500, "write_receipt_missing")
    response_digest = hashlib.sha256(
        json.dumps(result, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).digest()
    receipt.status = "committed"
    receipt.outcome_status = status_code
    receipt.outcome_code = code
    receipt.result = result
    receipt.response_digest = response_digest
    await db.flush()
    return _receipt(receipt=receipt, status_code=status_code, code=code, result=result)


# --- bootstrap / creation grant -------------------------------------------


def new_creation_grant() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, hashlib.sha256(token.encode("utf-8")).hexdigest()


def grant_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(seconds=get_settings().creation_grant_ttl_seconds)
