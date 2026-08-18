import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.config import get_settings
from app.schemas.base import StrictRequest

_settings = get_settings()

NewAccountPassword = Annotated[
    str,
    Field(
        min_length=_settings.password_min_length,
        max_length=_settings.password_max_length,
        repr=False,
    ),
]

SubmittedAccountPassword = Annotated[
    str,
    # Only an upper bound on login: a minimum here would answer "that is not
    # even long enough to be a password on this server" with a different status
    # code than a wrong password, and it would lock out accounts whenever the
    # policy is tightened. The bound itself stays, so a huge body cannot force
    # an expensive hash.
    Field(min_length=1, max_length=_settings.password_max_length, repr=False),
]


def _normalize_email(value: str) -> str:
    # The uniqueness constraint is on the stored string, so folding case at the
    # edge is what stops Alice@ and alice@ from becoming two accounts.
    return value.strip().lower()


class RegisterRequest(StrictRequest):
    email: EmailStr
    password: NewAccountPassword

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return _normalize_email(value)


class LoginRequest(StrictRequest):
    email: EmailStr
    password: SubmittedAccountPassword

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return _normalize_email(value)


class UserOut(BaseModel):
    """The account as the account holder may see it.

    Explicitly enumerated rather than dumped from the ORM: ``User`` also holds
    ``account_password_hash`` and the OAuth subject, and neither belongs in a
    response.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    is_active: bool
    created_at: datetime
