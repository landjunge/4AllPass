from datetime import datetime
from uuid import UUID

from pydantic import EmailStr, Field

from app.schemas.common import CamelModel, RequestModel


class RegisterRequest(RequestModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)


class LoginRequest(RequestModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class AccountMe(CamelModel):
    """Public account identity. Never includes hashes, session secrets, or OAuth ids."""

    id: UUID
    email: str
    created_at: datetime
