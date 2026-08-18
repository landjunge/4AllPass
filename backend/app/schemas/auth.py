"""Request/response shapes for account authentication.

Every response here is account-level metadata. None of it contains key
material, wrapped or otherwise, and none of it names a vault or a device: an
access token is proof of identity, never a capability (crypto-protocol.md §11).
"""

import uuid
from typing import Annotated

from email_validator import EmailNotValidError, validate_email
from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from app.core.config import get_settings

_settings = get_settings()


def _normalize_account_email(value: str) -> str:
    """Validate syntax and normalize case, without touching the network.

    Two deliberate choices:

    * `check_deliverability=False` — no DNS lookups. Resolving MX records inside
      a request would make registration depend on, and be slowed by, a network
      service, and would leak the address to a resolver.
    * `test_environment=True` — special-use domains (`.test`, `.local`, `.lan`)
      are accepted. This is self-hosted software; an internal-only deployment
      using `admin@vault.lan` is a normal setup, not a typo to reject.
    """
    try:
        result = validate_email(value, check_deliverability=False, test_environment=True)
    except EmailNotValidError as exc:
        raise ValueError(str(exc)) from exc
    return result.normalized.lower()


AccountEmail = Annotated[
    str, Field(max_length=320), AfterValidator(_normalize_account_email)
]


class RegisterRequest(BaseModel):
    email: AccountEmail
    password: str = Field(
        min_length=_settings.account_password_min_length,
        max_length=_settings.account_password_max_length,
    )


class LoginRequest(BaseModel):
    email: AccountEmail
    # Not length-validated: a login must not tell the caller which passwords
    # could not possibly be correct, and an over-long input is bounded anyway.
    password: str = Field(max_length=_settings.account_password_max_length)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=512)


class LogoutRequest(BaseModel):
    refresh_token: str | None = Field(default=None, max_length=512)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
