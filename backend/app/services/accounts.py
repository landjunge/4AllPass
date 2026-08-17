import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ConflictError
from app.models import Account
from app.security import hash_account_password, needs_rehash, verify_account_password


def normalize_email(email: str) -> str:
    return email.strip().lower()


async def create_account(session: AsyncSession, email: str, password: str) -> Account:
    normalized = normalize_email(email)
    existing = await session.scalar(select(Account).where(Account.email == normalized))
    if existing is not None:
        raise ConflictError("an account with this email already exists")
    account = Account(email=normalized, password_hash=hash_account_password(password))
    session.add(account)
    await session.commit()
    await session.refresh(account)
    return account


async def authenticate(session: AsyncSession, email: str, password: str) -> Account | None:
    account = await session.scalar(select(Account).where(Account.email == normalize_email(email)))
    if account is None or not account.is_active:
        # Still spend the work factor so a missing account is not faster.
        hash_account_password(password)
        return None
    if not verify_account_password(account.password_hash, password):
        return None
    if needs_rehash(account.password_hash):
        account.password_hash = hash_account_password(password)
        await session.commit()
    return account


async def get_account(session: AsyncSession, account_id: uuid.UUID) -> Account | None:
    return await session.scalar(select(Account).where(Account.id == account_id))
