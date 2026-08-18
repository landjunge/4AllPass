import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_vault_owner
from app.models.user import User
from app.models.vault import Vault
from app.schemas.vault import VaultCreate, VaultOut

router = APIRouter(prefix="/vaults", tags=["vaults"])


@router.post("", response_model=VaultOut, status_code=status.HTTP_201_CREATED)
async def create_vault(
    payload: VaultCreate = VaultCreate(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VaultOut:
    """Register vault ownership metadata for the authenticated user.

    IMPORTANT: This endpoint creates server-side ownership and routing metadata only.
    The server NEVER receives, generates, or stores the Vault Key (VK).
    Client-side cryptographic key generation and encryption remain strictly on the client.
    """
    vault = Vault(
        owner_user_id=current_user.id,
        crypto_protocol_version=payload.crypto_protocol_version,
    )
    db.add(vault)
    await db.commit()
    await db.refresh(vault)

    return VaultOut.model_validate(vault)


@router.get("", response_model=list[VaultOut])
async def list_vaults(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[VaultOut]:
    """List all vaults owned by the authenticated user."""
    result = await db.execute(select(Vault).where(Vault.owner_user_id == current_user.id))
    vaults = result.scalars().all()
    return [VaultOut.model_validate(v) for v in vaults]


@router.get("/{vault_id}", response_model=VaultOut)
async def get_vault(
    vault: Vault = Depends(require_vault_owner),
) -> VaultOut:
    """Retrieve metadata for a vault owned by the authenticated user."""
    return VaultOut.model_validate(vault)
