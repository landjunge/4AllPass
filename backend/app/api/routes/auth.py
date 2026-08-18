from fastapi import APIRouter, Depends, Request, Response, status

from app.api.deps import AccountDep, RedisDep, SessionDep, SettingsDep, bearer_token
from app.errors import AuthenticationError, RateLimitError
from app.schemas.api import AccountResponse, LoginRequest, RegisterRequest, SessionResponse
from app.services import accounts as account_service
from app.services import sessions as session_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_bucket(request: Request, email: str) -> str:
    host = request.client.host if request.client else "unknown"
    return f"login:{host}:{email.lower()}"


@router.post("/register", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    session: SessionDep,
    redis: RedisDep,
    settings: SettingsDep,
    response: Response,
) -> SessionResponse:
    account = await account_service.create_account(session, payload.email, payload.password)
    token, ttl = await session_service.create_session(
        redis, str(account.id), settings.session_ttl_seconds
    )
    _set_cookie(response, settings, token, ttl)
    return SessionResponse(
        token=token, expires_in=ttl, account_id=str(account.id), email=account.email
    )


@router.post("/login", response_model=SessionResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    session: SessionDep,
    redis: RedisDep,
    settings: SettingsDep,
    response: Response,
) -> SessionResponse:
    allowed = await session_service.register_attempt(
        redis, _client_bucket(request, payload.email), settings.login_attempts_per_minute
    )
    if not allowed:
        raise RateLimitError("too many login attempts, try again later")
    account = await account_service.authenticate(session, payload.email, payload.password)
    if account is None:
        raise AuthenticationError("invalid email or password")
    token, ttl = await session_service.create_session(
        redis, str(account.id), settings.session_ttl_seconds
    )
    _set_cookie(response, settings, token, ttl)
    return SessionResponse(
        token=token, expires_in=ttl, account_id=str(account.id), email=account.email
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    redis: RedisDep,
    settings: SettingsDep,
    response: Response,
    token: str = Depends(bearer_token),
) -> None:
    await session_service.revoke_session(redis, token)
    response.delete_cookie(settings.session_cookie_name)


@router.get("/me", response_model=AccountResponse)
async def me(account: AccountDep) -> AccountResponse:
    return AccountResponse(id=str(account.id), email=account.email, created_at=account.created_at)


def _set_cookie(response: Response, settings: SettingsDep, token: str, ttl: int) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=ttl,
        httponly=True,
        samesite="lax",
        secure=settings.environment == "production",
    )
