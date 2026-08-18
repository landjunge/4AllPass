from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator, Field

from app.core.config import get_settings
from app.core.emails import AccountEmail
from app.schemas.common import CamelModel

# Upper bound only guards against someone pushing a megabyte through Argon2id;
# the real policy is the configurable minimum below.
MAX_ACCOUNT_PASSWORD_LENGTH = 1024


def _enforce_password_policy(value: str) -> str:
    minimum = get_settings().auth_min_password_length
    if len(value) < minimum:
        raise ValueError(f"password must be at least {minimum} characters")
    return value


NewAccountPassword = Annotated[
    str, Field(max_length=MAX_ACCOUNT_PASSWORD_LENGTH), AfterValidator(_enforce_password_policy)
]


class _Credentials(CamelModel):
    email: AccountEmail
    # Browsers leave this false and authenticate with the HttpOnly session
    # cookie, so the session token never reaches JavaScript and cannot be read
    # by a script on the page. Non-browser clients (CLI, scripts, tests) opt in
    # and get the token in the response body instead.
    issue_bearer_token: bool = False


class RegisterRequest(_Credentials):
    password: NewAccountPassword


class LoginRequest(_Credentials):
    # No minimum here. Rejecting a too-short password before checking it would
    # report the current *policy* rather than the credential, and would answer
    # faster than a real verification does.
    password: str = Field(min_length=1, max_length=MAX_ACCOUNT_PASSWORD_LENGTH)


class AccountSession(CamelModel):
    """What a successful register/login returns.

    ``token`` is ``None`` for browser clients — their session lives in the
    HttpOnly cookie set on this response. It is populated only when the caller
    asked for a bearer session.
    """

    expires_in: int
    account_id: UUID
    email: str
    token: str | None = None


class AccountMe(CamelModel):
    id: UUID
    email: str
    created_at: datetime
