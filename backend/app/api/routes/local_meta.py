"""Local-app metadata. Never vault secrets. 404 on the server profile."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.locking import lock_vault_rows
from app.api.routes.auth import LOCAL_ACCOUNT_EMAIL
from app.core.config import get_settings
from app.models.device import Device
from app.models.entry import EncryptedEntry
from app.models.user import User
from app.models.vault import Vault
from app.schemas.common import CamelModel

router = APIRouter(prefix="/local", tags=["local"])


class LocalBrokerInfo(CamelModel):
    url: str
    token: str


@router.get("/broker", response_model=LocalBrokerInfo)
async def local_broker(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LocalBrokerInfo:
    """Pairing token. Not a vault secret. Not for local@ or a throwaway register."""
    settings = get_settings()
    if not settings.is_local() or not settings.broker_token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")
    if user.email == LOCAL_ACCOUNT_EMAIL:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")
    owned = int(
        (
            await db.execute(
                select(func.count())
                .select_from(Vault)
                .where(
                    Vault.owner_user_id == user.id,
                    Vault.active_snapshot_id.is_not(None),
                )
            )
        ).scalar_one()
    )
    if owned < 1:
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
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> AdoptLocalVaultResult:
    """Give this account the on-disk local vault. Decrypt still needs its master password.

    This is an ownership transfer of existing vaults, so it must not bypass the
    revoked-device write guard. The guard is vault-scoped; this route has no
    vault id, therefore every local vault is locked in a stable order and the
    session device is checked for a revoked row in any of them before any owner
    change. A device without a row (first setup / legacy) remains allowed.
    """
    _require_local()
    if user.email == LOCAL_ACCOUNT_EMAIL:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="already the local account")
    local = (
        await db.execute(select(User).where(User.email == LOCAL_ACCOUNT_EMAIL))
    ).scalar_one_or_none()
    if local is None:
        return AdoptLocalVaultResult()
    vault_ids = list(
        (
            await db.execute(
                select(Vault.id)
                .where(Vault.owner_user_id == local.id)
                .order_by(Vault.id)
            )
        ).scalars()
    )
    if not vault_ids:
        return AdoptLocalVaultResult()
    await lock_vault_rows(db, vault_ids)
    # The pre-lock ID read is not ownership truth. Re-read under the lock and
    # require every selected row to still belong to LOCAL; a concurrent adopter
    # may have committed first. No partial transfer and no foreign data leak.
    local_vaults = list(
        (
            await db.execute(
                select(Vault)
                .where(Vault.id.in_(vault_ids), Vault.owner_user_id == local.id)
            )
        ).scalars()
    )
    if len(local_vaults) != len(vault_ids):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="local_vault_changed",
        )
    session_device_id = getattr(request.state, "session_device_id", None)
    if session_device_id is None:  # pragma: no cover - get_current_user guarantees it
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    revoked = await db.execute(
        select(Device.id)
        .where(
            Device.vault_id.in_(vault_ids),
            Device.device_id == session_device_id,
            Device.revoked_at.is_not(None),
        )
        .limit(1)
    )
    if revoked.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="device is revoked for this vault",
        )
    vaults = local_vaults
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
