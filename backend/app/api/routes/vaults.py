from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, get_db, get_owned_vault, get_session_store
from app.api.rate_limit import enforce_write_rate_limit
from app.core.config import get_settings
from app.core.sessions import SessionStore
from app.models.user import User
from app.models.vault import Vault
from app.schemas.snapshot import SnapshotCommit, WireVaultSnapshot
from app.schemas.vault import VaultSummary
from app.services.snapshots import RevisionConflict, commit_snapshot, load_active_snapshot, snapshot_to_wire

router = APIRouter(prefix="/vaults", tags=["vaults"])


def _summary(vault: Vault) -> VaultSummary:
    snap = vault.active_snapshot
    return VaultSummary(
        vault_id=vault.id,
        crypto_protocol_version=vault.crypto_protocol_version,
        active_revision=snap.revision if snap is not None else None,
        active_vault_key_version=snap.vault_key_version if snap is not None else None,
        created_at=vault.created_at,
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
) -> VaultSummary:
    vault = Vault(
        owner_user_id=user.id,
        crypto_protocol_version=get_settings().crypto_protocol_version,
    )
    db.add(vault)
    await db.flush()
    return _summary(vault)


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


@router.post("/{vault_id}/snapshots", response_model=WireVaultSnapshot)
async def post_snapshot(
    payload: SnapshotCommit,
    request: Request,
    vault: Annotated[Vault, Depends(get_owned_vault)],
    db: Annotated[AsyncSession, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> WireVaultSnapshot | JSONResponse:
    await enforce_write_rate_limit(store, request, "snapshot")
    try:
        snapshot = await commit_snapshot(db, vault, payload)
    except RevisionConflict as exc:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": "revision conflict", "currentRevision": exc.current_revision},
        )
    return snapshot_to_wire(vault.id, snapshot)
