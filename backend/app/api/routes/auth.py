"""Account authentication — register, login, logout, whoami.

What crosses this boundary is an account credential and nothing else. The
Master Password, the Vault Key, the Device Key, the Device Wrapping Key and
the WebAuthn PRF output are all absent by construction: no schema in this
module has a field for any of them, and a body that invents one is rejected
by ``extra="forbid"``.

Authenticating here does not unlock anything. It establishes *who* is asking,
so the vault layer can decide *what* they may fetch — which is always
ciphertext (docs/backend-security-boundary.md §1).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_session, get_db
from app.core.security import (
    hash_password,
    password_needs_rehash,
    verify_password,
    verify_password_dummy,
)
from app.core.sessions import (
    clear_session_cookie,
    create_session,
    read_session_cookie,
    revoke_all_sessions_for_user,
    revoke_session_by_token,
    set_session_cookie,
    summarize_user_agent,
)
from app.models.session import UserSession
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])

INVALID_CREDENTIALS_DETAIL = "invalid email or password"


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)) -> User:
    """Create an account. Registration deliberately does not log the caller in.

    Keeping the two apart means a session is only ever minted by ``/auth/login``,
    so there is exactly one place where session fixation has to be handled.
    """
    user = User(email=payload.email, account_password_hash=hash_password(payload.password))
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        # This is an account-existence oracle, and an unavoidable one until
        # registration goes through e-mail confirmation: the alternative is to
        # claim success and leave the caller unable to log in. Recorded as a
        # residual risk in docs/backend-security-boundary.md §7.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="email already registered"
        ) from None

    await db.refresh(user)
    return user


@router.post("/login", response_model=UserOut)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> User:
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()

    if user is None:
        # Spend the same work as a real verification, so response time does not
        # distinguish "no such account" from "wrong password".
        verify_password_dummy()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS_DETAIL
        )

    if not verify_password(payload.password, user.account_password_hash) or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS_DETAIL
        )

    if user.account_password_hash is not None and password_needs_rehash(user.account_password_hash):
        user.account_password_hash = hash_password(payload.password)

    # Session fixation: whatever session token the caller arrived with is
    # destroyed before a new one is minted, so an attacker who plants a cookie
    # value in a victim's browser does not inherit the session it becomes.
    presented = read_session_cookie(request)
    if presented is not None:
        await revoke_session_by_token(db, presented)

    _session, token = await create_session(
        db, user, user_agent_summary=summarize_user_agent(request)
    )
    await db.commit()

    set_session_cookie(response, token)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    """Revoke the caller's session, if they have one.

    Deliberately not behind ``get_current_user``: logging out with an already
    invalid session is a success, not an error, and answering 401 would leave a
    client unable to clear a cookie it cannot read.
    """
    token = read_session_cookie(request)
    if token is not None:
        await revoke_session_by_token(db, token)
        await db.commit()

    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookie(response)
    return response


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all(
    session: UserSession = Depends(get_current_session), db: AsyncSession = Depends(get_db)
) -> Response:
    """Sign out of every browser, including this one.

    This is what server-side session state buys: it takes effect on the next
    request everywhere, which a self-contained bearer token cannot do.
    """
    await revoke_all_sessions_for_user(db, session.user_id)
    await db.commit()

    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookie(response)
    return response


@router.get("/me", response_model=UserOut)
async def me(session: UserSession = Depends(get_current_session)) -> User:
    return session.user
