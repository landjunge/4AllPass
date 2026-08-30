"""Local-app metadata. Never vault secrets. 404 on the server profile."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.api.routes.auth import LOCAL_ACCOUNT_EMAIL
from app.core.config import get_settings
from app.models.entry import EncryptedEntry
from app.models.user import User
from app.models.vault import Vault
from app.schemas.common import CamelModel

router = APIRouter(prefix="/local", tags=["local"])


class LocalBrokerInfo(CamelModel):
    url: str
    token: str


@router.get("/broker", response_model=LocalBrokerInfo)
async def local_broker(user: Annotated[User, Depends(get_current_user)]) -> LocalBrokerInfo:
    """Pairing token. Not a vault secret. Not for the passwordless local row."""
    settings = get_settings()
    if not settings.is_local() or not settings.broker_token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")
    if user.email == LOCAL_ACCOUNT_EMAIL:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")
    return LocalBrokerInfo(url=settings.broker_url.rstrip("/"), token=settings.broker_token)


class WebviewCaps(CamelModel):
    public_key_credential: bool
    credentials_create: bool
    platform_authenticator: bool | None = None
    prf: bool | None = None


class LocalStoreStatus(CamelModel):
    """Opaque counts only. Never emails of other accounts, never plaintext."""

    has_local_vault: bool
    local_entries: int
    has_other_accounts: bool
    local_vault_id: str | None = None


class AdoptLocalVaultResult(CamelModel):
    vault_id: str | None = None
    entries: int = 0


def _require_local() -> None:
    if not get_settings().is_local():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")


@router.get("/status", response_model=LocalStoreStatus)
async def local_store_status(db: Annotated[AsyncSession, Depends(get_db)]) -> LocalStoreStatus:
    """This Mac already has a local vault — do not create another one."""
    _require_local()
    users = list((await db.execute(select(User))).scalars())
    local = next((row for row in users if row.email == LOCAL_ACCOUNT_EMAIL), None)
    others = any(row.email != LOCAL_ACCOUNT_EMAIL for row in users)
    has_vault = False
    entries = 0
    vault_id: str | None = None
    if local is not None:
        vaults = list((await db.execute(select(Vault).where(Vault.owner_user_id == local.id))).scalars())
        for vault in vaults:
            if vault.active_snapshot_id is None:
                continue
            has_vault = True
            vault_id = str(vault.id)
            n = await db.execute(
                select(func.count())
                .select_from(EncryptedEntry)
                .where(EncryptedEntry.snapshot_id == vault.active_snapshot_id)
            )
            entries += int(n.scalar_one())
    return LocalStoreStatus(
        has_local_vault=has_vault,
        local_entries=entries,
        has_other_accounts=others,
        local_vault_id=vault_id,
    )


@router.post("/adopt-local-vault", response_model=AdoptLocalVaultResult)
async def adopt_local_vault(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> AdoptLocalVaultResult:
    """Give this account the on-disk local vault. Decrypt still needs its master password."""
    _require_local()
    if user.email == LOCAL_ACCOUNT_EMAIL:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="already the local account")
    local = (
        await db.execute(select(User).where(User.email == LOCAL_ACCOUNT_EMAIL))
    ).scalar_one_or_none()
    if local is None:
        return AdoptLocalVaultResult()
    vaults = list((await db.execute(select(Vault).where(Vault.owner_user_id == local.id))).scalars())
    vault_id: str | None = None
    entries = 0
    for vault in vaults:
        vault.owner_user_id = user.id
        vault_id = str(vault.id)
        if vault.active_snapshot_id is None:
            continue
        n = await db.execute(
            select(func.count())
            .select_from(EncryptedEntry)
            .where(EncryptedEntry.snapshot_id == vault.active_snapshot_id)
        )
        entries += int(n.scalar_one())
    return AdoptLocalVaultResult(vault_id=vault_id, entries=entries)


@router.get("/webview-caps", response_model=WebviewCaps)
async def get_webview_caps(request: Request) -> WebviewCaps:
    """Last report from the UI. Not a PRF proof — see docs/webauthn-prf.md §7."""
    _require_local()
    stored = getattr(request.app.state, "webview_caps", None)
    if stored is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")
    return stored


@router.post("/webview-caps", response_model=WebviewCaps)
async def post_webview_caps(payload: WebviewCaps, request: Request) -> WebviewCaps:
    _require_local()
    request.app.state.webview_caps = payload
    return payload
