"""Canonical v2 signed WriteRequest: shared-vector parity with TypeScript.

The fixture is produced by an independent reference generator
(``packages/crypto/test/fixtures/generate-write-request-vectors.mjs``), not by
either implementation. Ed25519 values are anchored by RFC 8032.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from app.core.write_request import (
    WRITE_V2_DRAFT_LAYOUT_REVISION,
    WRITE_V2_LABEL,
    WriteRequestV2Error,
    parse_write_request_wire,
    write_payload_digest_v2,
    write_public_key_digest_v2,
    write_request_bytes_v2,
    write_request_v2_hex,
)

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "crypto"
    / "test"
    / "fixtures"
    / "write-request-vectors.json"
)


@pytest.fixture(scope="module")
def vectors() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def encode_wire(wire: dict) -> bytes:
    return write_request_bytes_v2(parse_write_request_wire(wire))


def code_of(wire: dict) -> str:
    with pytest.raises(WriteRequestV2Error) as excinfo:
        encode_wire(wire)
    return excinfo.value.code


def test_uses_contract_label_and_field_order(vectors: dict) -> None:
    assert WRITE_V2_LABEL == "4allpass-vault-write-v2"
    assert vectors["protocol_label"] == WRITE_V2_LABEL
    data = encode_wire(vectors["valid"][0]["wire"])
    assert data[:4].hex() == "00000017"
    assert data[4:27] == WRITE_V2_LABEL.encode("utf-8")
    # The old, wrong label must never appear in a preimage.
    assert b"4allpass-write-request-v1" not in data
    assert WRITE_V2_DRAFT_LAYOUT_REVISION == 2
    assert vectors["draft_layout_revision"] == 2
    assert vectors["schema_revision"] == 2


@pytest.mark.parametrize("vector", json.loads(FIXTURE.read_text(encoding="utf-8"))["valid"], ids=lambda v: v["name"])
def test_reproduces_fixed_preimage_digest_and_signature(vector: dict, vectors: dict) -> None:
    data = encode_wire(vector["wire"])
    assert data.hex() == vector["preimage_hex"]
    assert write_request_v2_hex(parse_write_request_wire(vector["wire"])) == vector["preimage_hex"]
    assert hashlib.sha256(data).hexdigest() == vector["sha256_hex"]
    seed = bytes(vectors["rfc8032"][0]["secret_key"])
    private_key = Ed25519PrivateKey.from_private_bytes(seed)
    assert private_key.sign(data).hex() == vector["signature_hex"]
    public_key = private_key.public_key()
    public_key.verify(bytes.fromhex(vector["signature_hex"]), data)


def test_hashes_exact_body_and_next_key(vectors: dict) -> None:
    for vector in vectors["valid"]:
        body = base64.urlsafe_b64decode(vector["body_b64url"] + "=" * (-len(vector["body_b64url"]) % 4))
        assert write_payload_digest_v2(body).hex() == vector["payload_digest_hex"], vector["name"]
    assert write_payload_digest_v2(b'{"entries":[]}') != write_payload_digest_v2(b'{"entries":[]}\n')
    next_key = bytes(vectors["next_public_key_digest"]["next_public_key"])
    assert write_public_key_digest_v2(next_key).hex() == vectors["next_public_key_digest"]["digest_hex"]


def test_preserves_unicode_identity_and_character_bound(vectors: dict) -> None:
    nfc = next(v for v in vectors["valid"] if v["name"] == "credential_post_nfc")
    nfd = next(v for v in vectors["valid"] if v["name"] == "credential_post_nfd")
    assert nfc["preimage_hex"] != nfd["preimage_hex"]
    emoji = next(v for v in vectors["valid"] if v["name"] == "device_post_128_emoji")
    resource_id = emoji["wire"]["resourceId"]
    assert len(resource_id) == 128
    assert len(resource_id.encode("utf-8")) == 512
    assert resource_id.encode("utf-8").hex() in emoji["preimage_hex"]


def test_json_number_semantics_match_typescript(vectors: dict) -> None:
    base = json.dumps(vectors["numeric_base_wire"], separators=(",", ":"))
    for case in vectors["numeric_cases"]:
        text = re.sub(r'"baseRevision":\d+', f'"baseRevision":{case["json_value"]}', base)
        wire = json.loads(text)
        if case["accepted"]:
            parsed = parse_write_request_wire(wire)
            assert parsed.baseRevision == case["expected_value"], case["name"]
            if case["expected_value"] == 1:
                assert write_request_bytes_v2(parsed).hex() == vectors["numeric_base_preimage_hex"]
        else:
            assert code_of(wire) == case["code"], case["name"]
    # 1.0 must parse as a float in Python; the acceptance rule is integral value.
    parsed_float = json.loads(re.sub(r'"baseRevision":\d+', '"baseRevision":1.0', base))
    assert isinstance(parsed_float["baseRevision"], float)
    assert parse_write_request_wire(parsed_float).baseRevision == 1


@pytest.mark.parametrize(
    "vector", json.loads(FIXTURE.read_text(encoding="utf-8"))["invalid"], ids=lambda v: v["name"]
)
def test_rejects_negative_vectors_with_stable_code(vector: dict) -> None:
    assert code_of(vector["wire"]) == vector["code"]


def test_requires_canonical_lowercase_uuid_at_wire_boundary(vectors: dict) -> None:
    valid = dict(vectors["valid"][0]["wire"])
    assert valid["vaultId"] == valid["vaultId"].lower()
    bad = [
        {**valid, "vaultId": valid["vaultId"].upper()},
        {**valid, "vaultId": "{" + valid["vaultId"] + "}"},
        {**valid, "operationId": "urn:uuid:" + valid["operationId"]},
        {**valid, "operationId": valid["operationId"][:35]},
    ]
    for wire in bad:
        assert code_of(wire) == "write_request_uuid_invalid"


def test_device_id_sits_directly_after_vault_id(vectors: dict) -> None:
    import struct

    wire = vectors["valid"][0]["wire"]
    data = encode_wire(wire)
    offset = 4 + len(WRITE_V2_LABEL.encode()) + 4 + len(wire["vaultId"].encode())
    (length,) = struct.unpack(">I", data[offset : offset + 4])
    device_id = wire["deviceId"]
    assert length == len(device_id.encode())
    assert data[offset + 4 : offset + 4 + length].decode() == device_id


def test_single_field_tamper_and_false_pairs_never_collapse(vectors: dict) -> None:
    base = encode_wire(vectors["tamper_base"]).hex()
    for case in vectors["tamper_cases"]:
        tampered = encode_wire({**vectors["tamper_base"], case["field"]: case["value"]}).hex()
        assert tampered != base, f"tamper not bound: {case['field']}"
    for pair in vectors["false_pairs"]:
        left = encode_wire({**vectors["tamper_base"], pair["field"]: pair["a"]}).hex()
        right = encode_wire({**vectors["tamper_base"], pair["field"]: pair["b"]}).hex()
        assert left != right, f"false pair collapsed: {pair['name']}"
    requirements = vectors["server_requirements"]
    assert len(requirements) == 4
    assert any("X-Device-Id" in entry for entry in requirements)


def test_rejects_trailing_line_terminators_but_keeps_opaque_ids(vectors: dict) -> None:
    names = [
        vector["name"]
        for vector in vectors["invalid"]
        if vector["name"].endswith(("_lf", "_cr", "_crlf", "_line_separator", "_paragraph_separator"))
    ]
    assert len(names) == 20
    opaque = next(vector for vector in vectors["valid"] if vector["name"] == "device_id_trailing_lf")
    assert opaque["wire"]["deviceId"].endswith("\n")
    assert "dev-01\n".encode().hex() in opaque["preimage_hex"]


def test_rfc8032_anchor(vectors: dict) -> None:
    for vector in vectors["rfc8032"]:
        seed = bytes(vector["secret_key"])
        private_key = Ed25519PrivateKey.from_private_bytes(seed)
        message = bytes.fromhex(vector["message_hex"])
        assert private_key.public_key().public_bytes_raw() == bytes(vector["public_key"])
        assert private_key.sign(message).hex() == vector["signature_hex"]
        Ed25519PublicKey.from_public_bytes(bytes(vector["public_key"])).verify(
            bytes.fromhex(vector["signature_hex"]), message
        )
