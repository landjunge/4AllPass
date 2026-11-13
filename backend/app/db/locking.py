"""Vault-row write locks shared by mutation guards and revoke paths.

Postgres: ``SELECT ... FOR UPDATE`` on the vault row.
SQLite: the engine's ``begin`` hook already issues ``BEGIN IMMEDIATE``
(``app/db/session.py``), so the first statement in the transaction is the
writer reservation. No second lock primitive is introduced.
"""

from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vault import Vault


async def lock_vault_row(db: AsyncSession, vault_id: UUID) -> None:
    stmt = select(Vault.id).where(Vault.id == vault_id)
    if db.get_bind().dialect.name != "sqlite":
        stmt = stmt.with_for_update()
    found = await db.execute(stmt)
    if found.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vault not found")


async def lock_vault_rows(db: AsyncSession, vault_ids: Iterable[UUID]) -> None:
    """Lock several vaults in a stable order so revoke/write cannot deadlock."""
    for vault_id in sorted(vault_ids, key=str):
        await lock_vault_row(db, vault_id)
