from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import CamelModel, WriteModel

ChallengePurpose = Literal["create", "assert"]


class IssueChallengeRequest(WriteModel):
    purpose: ChallengePurpose
    device_id: str | None = Field(default=None, max_length=128)


class IssuedChallengeOut(CamelModel):
    challenge_id: UUID
    """Standard base64 of the 32-byte ceremony challenge. Shown once."""
    challenge: str
    expires_in: int
    purpose: ChallengePurpose


class ConsumeChallengeRequest(WriteModel):
    purpose: ChallengePurpose
    """The same 32 bytes that were used as publicKey.challenge."""
    challenge: str
