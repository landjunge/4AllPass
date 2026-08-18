from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_session_store
from app.core.config import get_settings
from app.core.security import hash_account_password, verify_account_password
from app.core.sessions import SessionStore
from app.models.user import User
from app.schemas.auth import AccountCredentials, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_session_cookie(response: Response, session_id: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.session_cookie_name,
        value=session_id,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=settings.is_production,
        samesite=settings.session_cookie_samesite,
        path="/",
    )


def _delete_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.session_cookie_name,
        httponly=True,
        secure=settings.is_production,
        samesite=settings.session_cookie_samesite,
        path="/",
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(
    credentials: AccountCredentials,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    sessions: Annotated[SessionStore, Depends(get_session_store)],
) -> User:
    user = User(
        email=credentials.email,
        account_password_hash=hash_account_password(credentials.password),
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="account already exists") from None

    await db.refresh(user)
    _set_session_cookie(response, await sessions.create(user.id))
    return user


@router.post("/login", response_model=UserOut)
async def login(
    credentials: AccountCredentials,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    sessions: Annotated[SessionStore, Depends(get_session_store)],
) -> User:
    user = await db.scalar(select(User).where(User.email == credentials.email))
    if (
        user is None
        or not user.is_active
        or user.account_password_hash is None
        or not verify_account_password(credentials.password, user.account_password_hash)
    ):
        raise HTTPException(status_code=401, detail="invalid email or password")

    _set_session_cookie(response, await sessions.create(user.id))
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    sessions: Annotated[SessionStore, Depends(get_session_store)],
) -> None:
    session_id = request.cookies.get(get_settings().session_cookie_name)
    if session_id:
        await sessions.revoke(session_id)
    _delete_session_cookie(response)


@router.get("/me", response_model=UserOut)
async def me(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    return current_user
