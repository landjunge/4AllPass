from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.models.vault import Vault
from app.schemas.vault import VaultCreate, VaultOut

router = APIRouter(prefix="/vaults", tags=["vaults"])


@router.post("", response_model=VaultOut, status_code=status.HTTP_201_CREATED)
async def create_vault(
    payload: VaultCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Vault:
    """Create ownership metadata without receiving or generating vault keys."""
    vault = Vault(
        owner_user_id=current_user.id,
        crypto_protocol_version=payload.crypto_protocol_version,
    )
    db.add(vault)
    await db.commit()
    await db.refresh(vault)
    return vault
