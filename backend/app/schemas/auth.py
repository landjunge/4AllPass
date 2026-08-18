"""Auth request/response schemas.

Response models are explicit allow-lists: ``UserOut`` can never leak
``account_password_hash``, OAuth subjects, or any internal column because
those fields simply do not exist on the schema. Request models ignore
unknown fields (pydantic default), so mass assignment of e.g. ``is_active``
or ``id`` in a register body has no effect.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

# The account password authenticates against the server and is unrelated to
# the Master Password (which never leaves the client). Bound the length to
# keep the server-side Argon2id hashing cost predictable.
_PASSWORD_MIN = 8
_PASSWORD_MAX = 256


class RegisterRequest(BaseModel):
    email: EmailStr = Field(max_length=320)
    password: str = Field(min_length=_PASSWORD_MIN, max_length=_PASSWORD_MAX)


class LoginRequest(BaseModel):
    email: EmailStr = Field(max_length=320)
    password: str = Field(min_length=1, max_length=_PASSWORD_MAX)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    created_at: datetime
