from datetime import datetime
from uuid import UUID

from pydantic import EmailStr, Field

from app.schemas.common import CamelModel, StrictCamelModel


class RegisterRequest(StrictCamelModel):
    email: EmailStr
    password: str = Field(min_length=12)


class LoginRequest(StrictCamelModel):
    email: EmailStr
    password: str = Field(min_length=1)


class AccountSession(CamelModel):
    token: str
    expires_in: int
    account_id: UUID
    email: str


class AccountMe(CamelModel):
    id: UUID
    email: str
    created_at: datetime
