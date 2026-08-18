from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Frontend contract is camelCase (see frontend/src/lib/api.ts).

    ``extra="forbid"`` is the anti-mass-assignment rule and applies to every
    request body in the API. Pydantic's default is to drop unknown fields
    silently, which is safe today only because no schema happens to expose an
    ownership column — a future schema that did would inherit the
    vulnerability without anyone noticing. Rejecting the request instead means
    a client that sends ``ownerId``, ``userId``, or ``isActive`` gets a loud
    422 rather than the quiet impression that the server took it.

    Ownership and identity are never read from a request body regardless; this
    is the second lock on that door.
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
        extra="forbid",
    )
