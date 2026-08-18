"""Vault ownership metadata.

Creating a vault here creates a *row*, not a key. The server has no part in
generating the Vault Key: it is 256 random bits produced on the client
(crypto-protocol.md §2, Hard Invariant #1) and it reaches the server only
wrapped inside envelopes it cannot open.

Snapshot commit, envelope upload and the ``active_revision`` compare-and-swap
of vault-revision.md §4 are the next milestone and are not implemented here.
Until then a new vault has no snapshot and ``active_revision`` is ``null``,
which is the honest representation of "the client has not published revision 1
yet" — not an invitation to invent a storage format for it.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, get_db, get_owned_vault_with_snapshot
from app.core.config import get_settings
from app.models.user import User
from app.models.vault import Vault
from app.schemas.vault import VaultCreate, VaultOut

router = APIRouter(prefix="/vaults", tags=["vaults"])


def _to_out(vault: Vault) -> VaultOut:
    return VaultOut(
        id=vault.id,
        crypto_protocol_version=vault.crypto_protocol_version,
        active_revision=vault.active_snapshot.revision if vault.active_snapshot else None,
        created_at=vault.created_at,
        updated_at=vault.updated_at,
    )


@router.post("", response_model=VaultOut, status_code=status.HTTP_201_CREATED)
async def create_vault(
    payload: VaultCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VaultOut:
    settings = get_settings()
    if payload.crypto_protocol_version != settings.crypto_protocol_version:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "unsupported crypto_protocol_version; this server speaks "
                f"version {settings.crypto_protocol_version}"
            ),
        )

    # Ownership is taken from the session, never from the request body.
    vault = Vault(
        owner_user_id=current_user.id,
        crypto_protocol_version=payload.crypto_protocol_version,
    )
    db.add(vault)
    await db.commit()
    await db.refresh(vault)
    return _to_out(vault)


@router.get("", response_model=list[VaultOut])
async def list_vaults(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[VaultOut]:
    """List the caller's own vaults. There is no endpoint that lists anyone else's."""
    result = await db.execute(
        select(Vault)
        .where(Vault.owner_user_id == current_user.id)
        .options(selectinload(Vault.active_snapshot))
        .order_by(Vault.created_at)
    )
    return [_to_out(vault) for vault in result.scalars().all()]


@router.get("/{vault_id}", response_model=VaultOut)
async def get_vault(vault: Vault = Depends(get_owned_vault_with_snapshot)) -> VaultOut:
    return _to_out(vault)
