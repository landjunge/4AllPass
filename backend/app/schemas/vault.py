import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import StrictRequest


class VaultCreate(StrictRequest):
    """Everything the server needs to create a vault: almost nothing.

    Creating a vault mints ownership metadata and nothing else. The Vault Key
    is generated on the client and is never sent here (crypto-protocol.md §2:
    "The Vault Key is generated once when the vault is created" — by the
    client, and it is never derived from any password). The vault stays empty
    until the client commits its first snapshot, per vault-revision.md §4.

    ``owner_user_id`` is deliberately absent: ownership comes from the session,
    and ``extra="forbid"`` turns an attempt to supply it into a 422.
    """

    crypto_protocol_version: int = Field(default=1, ge=1)


class VaultOut(BaseModel):
    """Vault metadata the owner may read — crypto-protocol.md §11.

    No key material, no envelope bytes, and no ``owner_user_id``: the only
    account that ever receives this object is the owner, so echoing the id back
    would add a user identifier to the response for no benefit.

    ``active_revision`` is the pointer from vault-revision.md §2 and is
    advisory. The client believes it only after the sealed manifest verifies
    (crypto-protocol.md §8.1); the server cannot make a revision number true.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    crypto_protocol_version: int
    active_revision: int | None = None
    created_at: datetime
    updated_at: datetime
