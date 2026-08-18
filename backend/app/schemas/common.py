from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Frontend contract is camelCase (see frontend/src/lib/api.ts)."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class WriteModel(BaseModel):
    """Request body: camelCase aliases, unknown fields rejected.

    Server-controlled state (owner, user id, revoked_at, revision pointers)
    must not be injectable via extra keys. extra='forbid' makes that a 422.
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )
