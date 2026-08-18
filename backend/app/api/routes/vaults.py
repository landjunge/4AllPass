"""Vault ownership endpoints.

POST /vaults creates *ownership metadata only*. The server neither
generates nor receives the Vault Key: VK creation, the Master Envelope,
and the initial snapshot commit are client-side concerns governed by
crypto-protocol.md §4 and docs/vault-revision.md §4. Until the client
commits snapshot revision 1, ``active_snapshot_id`` stays NULL.

The owner is always the authenticated user from the session — request
bodies are not consulted, so a forged ``owner_user_id`` cannot exist here
even as an ignored field (mass-assignment defense by construction).
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_owned_vault
from app.core.config import get_settings
from app.models.user import User
from app.models.vault import Vault
from app.schemas.vault import VaultOut

router = APIRouter(prefix="/vaults", tags=["vaults"])


@router.post("", response_model=VaultOut, status_code=status.HTTP_201_CREATED)
async def create_vault(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Vault:
    settings = get_settings()
    vault = Vault(
        owner_user_id=current_user.id,
        crypto_protocol_version=settings.crypto_protocol_version,
    )
    db.add(vault)
    await db.commit()
    await db.refresh(vault)
    return vault


@router.get("", response_model=list[VaultOut])
async def list_vaults(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Vault]:
    result = await db.execute(
        select(Vault).where(Vault.owner_user_id == current_user.id).order_by(Vault.created_at)
    )
    return list(result.scalars().all())


@router.get("/{vault_id}", response_model=VaultOut)
async def get_vault(vault: Vault = Depends(get_owned_vault)) -> Vault:
    return vault
