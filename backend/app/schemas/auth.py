from datetime import datetime
from uuid import UUID

from pydantic import EmailStr, Field

from app.schemas.common import CamelModel


class RegisterRequest(CamelModel):
    email: EmailStr
    password: str = Field(min_length=12)


class LoginRequest(CamelModel):
    email: EmailStr
    password: str = Field(min_length=1)


class AccountSession(CamelModel):
    expires_in: int
    expires_at: datetime
    account_id: UUID
    email: str


class AccountMe(CamelModel):
    id: UUID
    email: str
    created_at: datetime
