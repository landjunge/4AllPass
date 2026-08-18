"""Wire helpers: standard base64 for JSON, base64url for path segments."""

from __future__ import annotations

import base64


def b64encode(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def b64decode(value: str, *, label: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except Exception as exc:  # noqa: BLE001 — turn into a 422 at the call site
        raise ValueError(f"{label} is not valid standard base64") from exc


def b64url_decode(value: str) -> bytes:
    pad = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + pad)
