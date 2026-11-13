from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import (
    get_current_user,
    get_db,
    get_owned_vault,
    get_session_store,
    get_writable_vault,
)
from app.api.rate_limit import enforce_write_rate_limit
from app.core.config import get_settings
from app.core.security import verify_account_password
from app.core.signed_writes import (
    finalize,
    grant_expiry,
    new_creation_grant,
    prepare,
    sealed_manifest_digest,
)
from app.core.write_request import write_payload_digest_v2
from app.models.signed_write import WriteGrant
from app.core.sessions import SessionStore
from app.models.user import User
from app.models.vault import Vault
from app.schemas.snapshot import SnapshotCommit, VaultRevisionSummary, WireVaultSnapshot
from app.schemas.vault import VaultCreateRequest, VaultSummary
from app.services.snapshots import (
    RevisionConflict,
    commit_snapshot,
    list_revisions,
    load_active_snapshot,
    load_snapshot_at_revision,
    snapshot_to_wire,
)

router = APIRouter(prefix="/vaults", tags=["vaults"])


def _summary(vault: Vault, creation_grant: str | None = None) -> VaultSummary:
    snap = vault.active_snapshot
    return VaultSummary(
        vault_id=vault.id,
        crypto_protocol_version=vault.crypto_protocol_version,
        active_revision=snap.revision if snap is not None else None,
        active_vault_key_version=snap.vault_key_version if snap is not None else None,
        created_at=vault.created_at,
        creation_grant=creation_grant,
    )


@router.get("", response_model=list[VaultSummary])
async def list_vaults(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[VaultSummary]:
    result = await db.execute(
        select(Vault)
        .where(Vault.owner_user_id == user.id)
        .options(selectinload(Vault.active_snapshot))
        .order_by(Vault.created_at.asc())
    )
    return [_summary(vault) for vault in result.scalars().all()]


@router.post("", response_model=VaultSummary, status_code=status.HTTP_201_CREATED)
async def create_vault(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    payload: VaultCreateRequest | None = None,
) -> VaultSummary:
    settings = get_settings()
    requested = payload.crypto_protocol_version if payload is not None else 1
    if requested not in (1, 2):
        raise HTTPException(status_code=422, detail="unsupported cryptoProtocolVersion")
    grant: str | None = None
    if requested == 2:
        if not settings.signed_writes_enabled:
            raise HTTPException(status_code=403, detail="signed_writes_disabled")
        if payload is None or not payload.account_password:
            raise HTTPException(status_code=403, detail="step_up_required")
        if not user.account_password_hash or not verify_account_password(
            payload.account_password, user.account_password_hash
        ):
            raise HTTPException(status_code=403, detail="step_up_invalid")
    vault = Vault(owner_user_id=user.id, crypto_protocol_version=requested)
    db.add(vault)
    await db.flush()
    if requested == 2:
        grant, token_hash = new_creation_grant()
        db.add(
            WriteGrant(
                vault_id=vault.id,
                token_hash=token_hash,
                purpose="initial-key",
                expires_at=grant_expiry(),
            )
        )
        await db.flush()
    return _summary(vault, creation_grant=grant)


@router.get("/{vault_id}", response_model=VaultSummary)
async def get_vault(vault: Annotated[Vault, Depends(get_owned_vault)]) -> VaultSummary:
    return _summary(vault)


@router.get("/{vault_id}/snapshot", response_model=WireVaultSnapshot)
async def get_snapshot(
    vault: Annotated[Vault, Depends(get_owned_vault)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> WireVaultSnapshot:
    snapshot = await load_active_snapshot(db, vault)
    if snapshot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vault has no snapshot")
    return snapshot_to_wire(vault.id, snapshot)


@router.get("/{vault_id}/revisions", response_model=list[VaultRevisionSummary])
async def get_revisions(
    vault: Annotated[Vault, Depends(get_owned_vault)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[VaultRevisionSummary]:
    """Which revisions this vault still stores. Newest first, metadata only."""
    return await list_revisions(db, vault)


@router.get("/{vault_id}/revisions/{revision}", response_model=WireVaultSnapshot)
async def get_revision(
    revision: int,
    vault: Annotated[Vault, Depends(get_owned_vault)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> WireVaultSnapshot:
    """One superseded revision, byte-for-byte as it was committed.

    This is a read. It does not move ``active_snapshot_id`` and is not an
    advance for the client's freshness pin: restoring means committing the
    recovered content forward as a new revision.
    """
    snapshot = await load_snapshot_at_revision(db, vault, revision)
    if snapshot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="revision not found")
    return snapshot_to_wire(vault.id, snapshot)


@router.post("/{vault_id}/snapshots", response_model=WireVaultSnapshot)
async def post_snapshot(
    payload: SnapshotCommit,
    request: Request,
    vault: Annotated[Vault, Depends(get_writable_vault)],
    db: Annotated[AsyncSession, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> WireVaultSnapshot | JSONResponse:
    await enforce_write_rate_limit(store, request, "snapshot")
    active = await load_active_snapshot(db, vault)
    current_revision = active.revision if active is not None else 0
    base_revision = payload.expected_revision if payload.expected_revision is not None else current_revision
    manifest_digest = (
        sealed_manifest_digest(payload.sealed_manifest.model_dump())
        if payload.sealed_manifest is not None
        else b""
    )
    prepared = await prepare(
        db,
        vault=vault,
        request=request,
        user_id=vault.owner_user_id,
        device_id=request.state.session_device_id,
        method="POST",
        route="/api/v1/vaults/{vaultId}/snapshots",
        resource_type="vault",
        resource_id="",
        parent_id="",
        payload_digest=write_payload_digest_v2(await request.body()),
        base_revision=base_revision,
        result_revision=payload.revision,
        has_manifest=payload.sealed_manifest is not None,
        manifest_digest=manifest_digest,
        payload_vault_key_version=payload.vault_key_version,
    )
    try:
        snapshot = await commit_snapshot(db, vault, payload)
    except RevisionConflict as exc:
        # prepare() already flushed the receipt claim, nonce and any rotation
        # key rows. A handled conflict must not let get_db commit those side
        # effects with an unchanged snapshot head.
        await db.rollback()
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": "revision conflict", "currentRevision": exc.current_revision},
        )
    if prepared is not None:
        await finalize(
            db,
            prepared,
            vault_id=vault.id,
            status_code=200,
            code="ok",
            result={
                "revision": snapshot.revision,
                "vaultKeyVersion": snapshot.vault_key_version,
                "manifestDigest": manifest_digest.hex() if manifest_digest else None,
                "resourceState": "active",
            },
        )
    return snapshot_to_wire(vault.id, snapshot)
