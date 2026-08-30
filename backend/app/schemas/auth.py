from datetime import datetime
from uuid import UUID

from pydantic import EmailStr, Field

from app.core.limits import ACCOUNT_PASSWORD_CHARS_MAX
from app.schemas.common import CamelModel, WriteModel


class RegisterRequest(WriteModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=ACCOUNT_PASSWORD_CHARS_MAX)


class LoginRequest(WriteModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=ACCOUNT_PASSWORD_CHARS_MAX)


class AccountSession(CamelModel):
    token: str
    expires_in: int
    account_id: UUID
    email: str
    device_id: str


class AccountMe(CamelModel):
    id: UUID
    email: str
    created_at: datetime
