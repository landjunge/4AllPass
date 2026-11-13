"""Canonical v2 signed WriteRequest bytes (ADR-015 §3, not yet active).

Python mirror of ``writeRequestBytesV2`` in ``packages/crypto/src/requester.ts``.
Normative source is ``SIGNED-WRITE-CONTRACT-v2 §1``; this module adds no field,
no marker and no version of its own. Pure encoding: no signing, no key
derivation, no transport, no database.

Draft Layout Rev2 inserts ``deviceId`` immediately after ``vaultId`` (private
V3-ERRATUM-2 device binding); every other V2 §1 field and the label are
unchanged. There is no compatibility claim to Draft Rev1: no request, key or
route of that draft was ever delivered.

Field order (all ``uint32be``-length-prefixed, the existing ``frame`` style)::

    "4allpass-vault-write-v2", vaultId, deviceId, method, route, resourceType,
    resourceId, parentId, baseRevision, resultRevision, signingKeyVersion,
    resultKeyVersion, hasManifest, manifestDigest, payloadDigest, hasNextKey,
    nextPublicKeyDigest, operationId, nonce, timestamp

``hasManifest``/``hasNextKey`` are uint32 ``0|1``; the optional digests are
empty byte strings when the flag is 0. There is no separate marker byte.

Identifiers are the exact decoded strings, UTF-8, no normalization and no URL
re-encoding. ``deviceId`` must equal the validated session ``X-Device-Id``;
binding it to the session is a server requirement, not a property of these
bytes. ``vaultId``/``operationId`` must already be canonical lowercase
UUID text; ``resourceId``/``parentId`` are 0..128 characters (``device_id`` is 1..128 characters in
``schemas/device.py``; a 128-emoji id is 512 bytes and still valid). Strings
with lone surrogates have no UTF-8 encoding and are rejected, never replaced.
"""

from __future__ import annotations

import base64
import hashlib
import math
import re
import struct
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

WRITE_V2_LABEL = "4allpass-vault-write-v2"
WRITE_V2_PUBLIC_KEY_LABEL = "4allpass-write-public-key-v1"
WRITE_V2_NONCE_BYTES = 16
WRITE_V2_DIGEST_BYTES = 32
WRITE_V2_ID_CHARS_MAX = 128

#: Rev 2 adds ``deviceId`` after ``vaultId``; the domain label stays ``…-v2``.
WRITE_V2_DRAFT_LAYOUT_REVISION = 2

CODE_TYPE = "write_request_type_invalid"
CODE_METHOD = "write_request_method_invalid"
CODE_ROUTE = "write_request_route_invalid"
CODE_ID = "write_request_id_invalid"
CODE_UINT32 = "write_request_uint32_invalid"
CODE_NONCE = "write_request_nonce_invalid"
CODE_DIGEST = "write_request_digest_invalid"
CODE_PRESENCE = "write_request_presence_invalid"
CODE_BASE64 = "write_request_base64_invalid"
CODE_UNKNOWN_FIELD = "write_request_field_unknown"
CODE_RESOURCE_TYPE = "write_request_resource_type_invalid"
CODE_UUID = "write_request_uuid_invalid"

RESOURCE_TYPES = ("vault", "device", "credential", "challenge")

_WIRE_KEYS = (
    "vaultId",
    "deviceId",
    "method",
    "route",
    "resourceType",
    "resourceId",
    "parentId",
    "baseRevision",
    "resultRevision",
    "signingKeyVersion",
    "resultKeyVersion",
    "hasManifest",
    "manifestDigest",
    "payloadDigest",
    "hasNextKey",
    "nextPublicKeyDigest",
    "operationId",
    "nonce",
    "timestamp",
)

_METHOD_RE = re.compile(r"^[A-Z]{1,16}$")
_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_ROUTE_RE = re.compile(r"^/api/v1/[\x21-\x7e]+$")
_BASE64URL_RE = re.compile(r"[A-Za-z0-9_-]*")


class WriteRequestV2Error(ValueError):
    """Stable, machine-readable failure. The code is the API, the text is for humans."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


@dataclass(frozen=True)
class WriteRequestV2:
    vaultId: str
    deviceId: str
    method: str
    route: str
    resourceType: str
    resourceId: str
    parentId: str
    baseRevision: int
    resultRevision: int
    signingKeyVersion: int
    resultKeyVersion: int
    hasManifest: int
    manifestDigest: bytes
    payloadDigest: bytes
    hasNextKey: int
    nextPublicKeyDigest: bytes
    operationId: str
    nonce: bytes
    timestamp: int


def _fail(code: str, message: str) -> None:
    raise WriteRequestV2Error(code, message)


def _frame(payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + payload


def _frame_str(value: str) -> bytes:
    return _frame(value.encode("utf-8"))


def _frame_u32(value: int) -> bytes:
    return _frame(struct.pack(">I", value))


def _read_id(name: str, value: Any, min_chars: int) -> str:
    if not isinstance(value, str):
        _fail(CODE_TYPE, f"{name} must be a string")
    for ch in value:
        if 0xD800 <= ord(ch) <= 0xDFFF:
            _fail(CODE_ID, f"{name} contains an unpaired surrogate")
    chars = len(value)
    if chars < min_chars or chars > WRITE_V2_ID_CHARS_MAX:
        _fail(CODE_ID, f"{name} must be {min_chars}..{WRITE_V2_ID_CHARS_MAX} characters, got {chars}")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        _fail(CODE_ID, f"{name} has no UTF-8 encoding")
    return value


def _read_uuid(name: str, value: Any) -> str:
    """Canonical lowercase hyphenated UUID text; no normalization here.

    FastAPI's UUID path parser is lenient (uppercase, braces, ``urn:uuid:``), so
    the server must serialize ``str(uuid)`` before building these bytes.
    Rejecting a non-canonical spelling keeps two texts of one UUID from
    producing two preimages. This is a wire-validation boundary, not route
    authorization.
    """
    if not isinstance(value, str):
        _fail(CODE_TYPE, f"{name} must be a string")
    if not _UUID_RE.fullmatch(value):
        _fail(CODE_UUID, f"{name} must be a canonical lowercase UUID")
    return value


def _read_uint32(name: str, value: Any) -> int:
    """JSON numbers are compared by value: 1.0 and 1 are both accepted, 1.5 is not.

    JavaScript cannot distinguish ``1`` from ``1.0``, so accepting integral
    values in Python is the only cross-language-consistent reading of "reject
    non-integers".
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _fail(CODE_TYPE, f"{name} must be a number")
    if isinstance(value, float):
        if not math.isfinite(value) or not value.is_integer():
            _fail(CODE_UINT32, f"{name} must be an integer, got {value!r}")
        value = int(value)
    if value < 0 or value > 0xFFFFFFFF:
        _fail(CODE_UINT32, f"{name} must be in [0, 4294967295], got {value}")
    return int(value)


def _read_presence(name: str, value: Any) -> int:
    number = _read_uint32(name, value)
    if number not in (0, 1):
        _fail(CODE_PRESENCE, f"{name} must be 0 or 1, got {number}")
    return number


def _read_digest(name: str, value: Any, length: int, code: str = CODE_DIGEST) -> bytes:
    if not isinstance(value, (bytes, bytearray, memoryview)):
        _fail(CODE_TYPE, f"{name} must be bytes")
    data = bytes(value)
    if len(data) != length:
        _fail(code, f"{name} must be {length} bytes, got {len(data)}")
    return data


def decode_base64url_canonical(name: str, value: Any) -> bytes:
    """Strict unpadded base64url: no ``+``/``/``/``=``/whitespace, canonical bits."""
    if not isinstance(value, str):
        _fail(CODE_TYPE, f"{name} must be a base64url string")
    if len(value) % 4 == 1:
        _fail(CODE_BASE64, f"{name} has an impossible base64url length")
    if not _BASE64URL_RE.fullmatch(value):
        _fail(CODE_BASE64, f"{name} is not unpadded base64url")
    try:
        data = base64.urlsafe_b64decode((value + "=" * (-len(value) % 4)).encode("ascii"))
    except (ValueError, UnicodeEncodeError):
        _fail(CODE_BASE64, f"{name} is not valid base64url")
        raise AssertionError("unreachable")
    if base64.urlsafe_b64encode(data).decode("ascii").rstrip("=") != value:
        _fail(CODE_BASE64, f"{name} is not canonical base64url")
    return data


def write_payload_digest_v2(body: bytes | bytearray | memoryview) -> bytes:
    """SHA-256 over the exact raw body bytes; no trimming, no newline normalization."""
    if not isinstance(body, (bytes, bytearray, memoryview)):
        _fail(CODE_TYPE, "body must be bytes")
    return hashlib.sha256(bytes(body)).digest()


def write_public_key_digest_v2(next_public_key_raw: bytes) -> bytes:
    """``SHA-256(frame(["4allpass-write-public-key-v1", nextPublicKeyRaw32]))``."""
    if not isinstance(next_public_key_raw, (bytes, bytearray, memoryview)):
        _fail(CODE_TYPE, "nextPublicKeyRaw must be bytes")
    raw = bytes(next_public_key_raw)
    if len(raw) != 32:
        _fail(CODE_TYPE, "nextPublicKeyRaw must be 32 bytes")
    return hashlib.sha256(_frame_str(WRITE_V2_PUBLIC_KEY_LABEL) + _frame(raw)).digest()


def _validate(request: WriteRequestV2) -> WriteRequestV2:
    vault_id = _read_uuid("vaultId", request.vaultId)
    device_id = _read_id("deviceId", request.deviceId, 1)
    if not isinstance(request.method, str) or not _METHOD_RE.fullmatch(request.method):
        _fail(CODE_METHOD, "method must be an upper-case ASCII token")
    if (
        not isinstance(request.route, str)
        or not 1 <= len(request.route) <= 512
        or not _ROUTE_RE.fullmatch(request.route)
        or "?" in request.route
        or "#" in request.route
    ):
        _fail(CODE_ROUTE, "route must be a fixed /api/v1/ path template without query or fragment")
    if request.resourceType not in RESOURCE_TYPES:
        _fail(CODE_RESOURCE_TYPE, f"unknown resourceType: {request.resourceType!r}")
    resource_id = _read_id("resourceId", request.resourceId, 0)
    parent_id = _read_id("parentId", request.parentId, 0)
    base_revision = _read_uint32("baseRevision", request.baseRevision)
    result_revision = _read_uint32("resultRevision", request.resultRevision)
    signing_key_version = _read_uint32("signingKeyVersion", request.signingKeyVersion)
    result_key_version = _read_uint32("resultKeyVersion", request.resultKeyVersion)
    has_manifest = _read_presence("hasManifest", request.hasManifest)
    manifest_digest = _read_digest(
        "manifestDigest", request.manifestDigest, WRITE_V2_DIGEST_BYTES if has_manifest else 0
    )
    payload_digest = _read_digest("payloadDigest", request.payloadDigest, WRITE_V2_DIGEST_BYTES)
    has_next_key = _read_presence("hasNextKey", request.hasNextKey)
    next_public_key_digest = _read_digest(
        "nextPublicKeyDigest", request.nextPublicKeyDigest, WRITE_V2_DIGEST_BYTES if has_next_key else 0
    )
    operation_id = _read_uuid("operationId", request.operationId)
    nonce = _read_digest("nonce", request.nonce, WRITE_V2_NONCE_BYTES, CODE_NONCE)
    timestamp = _read_uint32("timestamp", request.timestamp)
    return WriteRequestV2(
        vaultId=vault_id,
        deviceId=device_id,
        method=request.method,
        route=request.route,
        resourceType=request.resourceType,
        resourceId=resource_id,
        parentId=parent_id,
        baseRevision=base_revision,
        resultRevision=result_revision,
        signingKeyVersion=signing_key_version,
        resultKeyVersion=result_key_version,
        hasManifest=has_manifest,
        manifestDigest=manifest_digest,
        payloadDigest=payload_digest,
        hasNextKey=has_next_key,
        nextPublicKeyDigest=next_public_key_digest,
        operationId=operation_id,
        nonce=nonce,
        timestamp=timestamp,
    )


def write_request_bytes_v2(request: WriteRequestV2) -> bytes:
    """Canonical preimage for one signed v2 write. Pure function."""
    if not isinstance(request, WriteRequestV2):
        _fail(CODE_TYPE, "write request must be a WriteRequestV2")
    value = _validate(request)
    return b"".join(
        [
            _frame_str(WRITE_V2_LABEL),
            _frame_str(value.vaultId),
            _frame_str(value.deviceId),
            _frame_str(value.method),
            _frame_str(value.route),
            _frame_str(value.resourceType),
            _frame_str(value.resourceId),
            _frame_str(value.parentId),
            _frame_u32(value.baseRevision),
            _frame_u32(value.resultRevision),
            _frame_u32(value.signingKeyVersion),
            _frame_u32(value.resultKeyVersion),
            _frame_u32(value.hasManifest),
            _frame(value.manifestDigest),
            _frame(value.payloadDigest),
            _frame_u32(value.hasNextKey),
            _frame(value.nextPublicKeyDigest),
            _frame_str(value.operationId),
            _frame(value.nonce),
            _frame_u32(value.timestamp),
        ]
    )


def write_request_v2_hex(request: WriteRequestV2) -> str:
    return write_request_bytes_v2(request).hex()


def parse_write_request_wire(value: Any) -> WriteRequestV2:
    """Parse and fully validate the untrusted wire shape.

    Every field is required and checked before anything is returned. Unknown and
    missing fields are errors: a field this build does not authenticate must
    never be silently dropped, or an older writer and a newer reader would sign
    different bytes while both believing they agree.
    """
    if not isinstance(value, Mapping):
        _fail(CODE_TYPE, "write request wire value must be an object")
    for key in value:
        if key not in _WIRE_KEYS:
            _fail(CODE_UNKNOWN_FIELD, f"unknown write request field: {key}")
    for key in _WIRE_KEYS:
        if key not in value:
            _fail(CODE_TYPE, f"missing write request field: {key}")
    nonce = decode_base64url_canonical("nonce", value["nonce"])
    manifest_digest = decode_base64url_canonical("manifestDigest", value["manifestDigest"])
    payload_digest = decode_base64url_canonical("payloadDigest", value["payloadDigest"])
    next_public_key_digest = decode_base64url_canonical(
        "nextPublicKeyDigest", value["nextPublicKeyDigest"]
    )
    parsed = WriteRequestV2(
        vaultId=value["vaultId"],
        deviceId=value["deviceId"],
        method=value["method"],
        route=value["route"],
        resourceType=value["resourceType"],
        resourceId=value["resourceId"],
        parentId=value["parentId"],
        baseRevision=value["baseRevision"],
        resultRevision=value["resultRevision"],
        signingKeyVersion=value["signingKeyVersion"],
        resultKeyVersion=value["resultKeyVersion"],
        hasManifest=value["hasManifest"],
        manifestDigest=manifest_digest,
        payloadDigest=payload_digest,
        hasNextKey=value["hasNextKey"],
        nextPublicKeyDigest=next_public_key_digest,
        operationId=value["operationId"],
        nonce=nonce,
        timestamp=value["timestamp"],
    )
    return _validate(parsed)
