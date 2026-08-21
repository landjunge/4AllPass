"""Local-app metadata. Never vault secrets. 404 on the server profile."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.models.user import User
from app.schemas.common import CamelModel

router = APIRouter(prefix="/local", tags=["local"])


class LocalBrokerInfo(CamelModel):
    url: str
    token: str


@router.get("/broker", response_model=LocalBrokerInfo)
async def local_broker(_user: Annotated[User, Depends(get_current_user)]) -> LocalBrokerInfo:
    settings = get_settings()
    if not settings.is_local() or not settings.broker_token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")
    return LocalBrokerInfo(url=settings.broker_url.rstrip("/"), token=settings.broker_token)


class WebviewCaps(CamelModel):
    public_key_credential: bool
    credentials_create: bool
    platform_authenticator: bool | None = None
    prf: bool | None = None


def _require_local() -> None:
    if not get_settings().is_local():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")


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
