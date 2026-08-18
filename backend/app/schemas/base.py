from pydantic import BaseModel, ConfigDict


class StrictRequest(BaseModel):
    """Base for request bodies: unknown fields are an error, not a shrug.

    ``extra="forbid"`` is the mass-assignment defence. A body carrying
    ``owner_user_id``, ``user_id`` or ``is_active`` is rejected outright rather
    than silently dropped, so a client that believes it can set those finds
    out instead of assuming it worked.
    """

    model_config = ConfigDict(extra="forbid")
