"""Ownership checks for vault-scoped resources.

Every vault-scoped route runs through :func:`require_vault_owner` before it
reads anything. The rule it enforces is deliberately blunt: a vault belongs to
exactly one account, and a request that is not that account is answered as if
the vault did not exist.
"""

from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.user import User
from app.models.vault import Vault

VAULT_NOT_FOUND_DETAIL = "vault not found"


def vault_not_found() -> HTTPException:
    """The single answer for "no such vault" and "not your vault".

    Distinguishing the two would make vault ids enumerable: an attacker could
    walk ids and read 403 as "exists, owned by someone else". One response for
    both means a wrong id tells the caller nothing it did not already know.
    """
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=VAULT_NOT_FOUND_DETAIL)


async def require_vault_owner(
    vault_id: uuid.UUID,
    current_user: User,
    db: AsyncSession,
    *,
    with_active_snapshot: bool = False,
) -> Vault:
    """Return the vault ``vault_id`` if ``current_user`` owns it, else raise 404.

    The owner is matched inside the query, so there is no window in which a
    non-owned vault has been loaded and is waiting on a later check, and no
    path on which a client-supplied owner id reaches the database. The
    authenticated identity comes from the session and from nowhere else.
    """
    query = select(Vault).where(Vault.id == vault_id, Vault.owner_user_id == current_user.id)
    if with_active_snapshot:
        query = query.options(selectinload(Vault.active_snapshot))

    result = await db.execute(query)
    vault = result.scalar_one_or_none()
    if vault is None:
        raise vault_not_found()
    return vault
