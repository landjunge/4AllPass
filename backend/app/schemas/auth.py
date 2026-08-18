import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AccountCredentials(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=12, max_length=1024)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized.count("@") != 1:
            raise ValueError("email must contain one @")
        local, domain = normalized.split("@")
        if not local or "." not in domain:
            raise ValueError("email must be valid")
        return normalized


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    created_at: datetime
