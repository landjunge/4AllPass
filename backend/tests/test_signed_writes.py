"""Server-authoritative v2 signed writes (ADR-015 step 3, default off)."""

from __future__ import annotations

import base64
import hashlib
import json
import time
import uuid

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.core.config import get_settings
from app.core.signed_writes import sealed_manifest_digest
from app.core.write_request import (
    WriteRequestV2,
    write_payload_digest_v2,
    write_public_key_digest_v2,
    write_request_bytes_v2,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

PASSWORD = "CorrectHorseBatteryStaple9!"
EMAIL = "signed.writes@example.com"
DEVICE = "dev_signed_writes_0001"


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def body_bytes(payload: dict) -> bytes:
    return json.dumps(payload, separators=(",", ":")).encode()


def manifest(seed: bytes = b"m1") -> dict:
    return {
        "version": 1,
        "encryption": "AES-256-GCM",
        "nonce": b64(bytes(range(12))),
        "ciphertext": b64(hashlib.sha256(seed).digest()),
        "tag": b64(bytes(range(16))),
    }


def envelope() -> dict:
    return {
        "version": 1,
        "type": "master",
        "vaultKeyVersion": 1,
        "encryption": "AES-256-GCM",
        "nonce": b64(bytes(range(12))),
        "ciphertext": b64(b"x" * 8),
        "tag": b64(bytes(range(16))),
        "kdf": {
            "algorithm": "argon2id",
            "version": 19,
            "memory": 65536,
            "iterations": 3,
            "parallelism": 2,
            "hashLen": 32,
            "salt": b64(bytes(range(16))),
        },
    }


def sign(
    *,
    priv: Ed25519PrivateKey,
    pub: bytes,
    vault_id: str,
    device_id: str,
    method: str,
    route: str,
    resource_type: str,
    resource_id: str,
    parent_id: str,
    base: int,
    result: int,
    key_version: int,
    result_key_version: int,
    has_manifest: bool,
    manifest_digest: bytes,
    payload_digest: bytes,
    operation_id: uuid.UUID,
    nonce: bytes,
    has_next: bool = False,
    next_pub: bytes | None = None,
    next_priv: Ed25519PrivateKey | None = None,
) -> tuple[dict, bytes]:
    request = WriteRequestV2(
        vaultId=vault_id,
        deviceId=device_id,
        method=method,
        route=route,
        resourceType=resource_type,
        resourceId=resource_id,
        parentId=parent_id,
        baseRevision=base,
        resultRevision=result,
        signingKeyVersion=key_version,
        resultKeyVersion=result_key_version,
        hasManifest=1 if has_manifest else 0,
        manifestDigest=manifest_digest if has_manifest else b"",
        payloadDigest=payload_digest,
        hasNextKey=1 if has_next else 0,
        nextPublicKeyDigest=write_public_key_digest_v2(next_pub) if has_next and next_pub else b"",
        operationId=str(operation_id),
        nonce=nonce,
        timestamp=int(time.time()),
    )
    message = write_request_bytes_v2(request)
    headers = {
        "Content-Type": "application/json",
        "X-4AP-Write-Scheme": "ed25519-v1",
        "X-4AP-Write-Signature": b64url(priv.sign(message)),
        "X-4AP-Write-Operation-Id": str(operation_id),
        "X-4AP-Write-Nonce": b64url(nonce),
        "X-4AP-Write-Timestamp": str(request.timestamp),
        "X-4AP-Write-Key-Version": str(key_version),
        "X-4AP-Write-Result-Key-Version": str(result_key_version),
        "X-4AP-Write-Resource-Type": resource_type,
        "X-4AP-Write-Resource-Id": b64url(resource_id.encode()),
        "X-4AP-Write-Parent-Id": b64url(parent_id.encode()),
        "X-4AP-Write-Base-Revision": str(base),
        "X-4AP-Write-Result-Revision": str(result),
    }
    if has_next and next_pub is not None:
        headers["X-4AP-Write-Next-Public-Key"] = b64url(next_pub)
        if next_priv is not None:
            headers["X-4AP-Write-Next-Signature"] = b64url(next_priv.sign(message))
    return headers, message


@pytest.fixture
async def account(client):
    settings = get_settings()
    previous = settings.signed_writes_enabled
    settings.signed_writes_enabled = True
    try:
        email = f"signed-writes-{uuid.uuid4().hex}@example.com"
        register = await client.post(
            "/api/v1/auth/register", json={"email": email, "password": PASSWORD}
        )
        assert register.status_code == 200, register.text
        token = register.json()["token"]
        # The fixture client always sends TEST_DEVICE_ID; mint a session bound
        # to DEVICE by logging in with that header instead.
        login = await client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": PASSWORD},
            headers={"X-Device-Id": DEVICE},
        )
        assert login.status_code == 200, login.text
        yield {"Authorization": f"Bearer {login.json()['token']}", "X-Device-Id": DEVICE}
    finally:
        settings.signed_writes_enabled = previous


async def _create_v2_vault(client, headers) -> tuple[str, str]:
    created = await client.post(
        "/api/v1/vaults",
        json={"cryptoProtocolVersion": 2, "accountPassword": PASSWORD},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["creationGrant"]
    return body["vaultId"], body["creationGrant"]


async def _bootstrap_device(client, headers, vault_id, grant):
    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key().public_bytes_raw()
    payload = {"deviceId": DEVICE}
    raw = body_bytes(payload)
    op = uuid.uuid4()
    signed, _ = sign(
        priv=priv,
        pub=pub,
        vault_id=vault_id,
        device_id=DEVICE,
        method="POST",
        route="/api/v1/vaults/{vaultId}/devices",
        resource_type="device",
        resource_id=DEVICE,
        parent_id="",
        base=0,
        result=0,
        key_version=1,
        result_key_version=1,
        has_manifest=False,
        manifest_digest=b"",
        payload_digest=write_payload_digest_v2(raw),
        operation_id=op,
        nonce=uuid.uuid4().bytes,
        has_next=True,
        next_pub=pub,
        next_priv=priv,
    )
    signed["X-4AP-Creation-Grant"] = grant
    response = await client.post(
        f"/api/v1/vaults/{vault_id}/devices", content=raw, headers={**headers, **signed}
    )
    assert response.status_code == 200, response.text
    return priv, pub


async def _commit(
    client,
    headers,
    vault_id,
    priv,
    pub,
    *,
    revision: int,
    base: int,
    key_version: int,
    result_key_version: int,
    manifest_obj: dict,
    next_priv=None,
    next_pub=None,
):
    payload = {
        "expectedRevision": base,
        "revision": revision,
        "vaultKeyVersion": result_key_version,
        "cryptoProtocolVersion": 2,
        "envelopes": [envelope()],
        "entries": [],
        "sealedManifest": manifest_obj,
    }
    raw = body_bytes(payload)
    signed, message = sign(
        priv=priv,
        pub=pub,
        vault_id=vault_id,
        device_id=DEVICE,
        method="POST",
        route="/api/v1/vaults/{vaultId}/snapshots",
        resource_type="vault",
        resource_id="",
        parent_id="",
        base=base,
        result=revision,
        key_version=key_version,
        result_key_version=result_key_version,
        has_manifest=True,
        manifest_digest=sealed_manifest_digest(manifest_obj),
        payload_digest=write_payload_digest_v2(raw),
        operation_id=uuid.uuid4(),
        nonce=uuid.uuid4().bytes,
        has_next=next_priv is not None,
        next_pub=next_pub,
        next_priv=next_priv,
    )
    signed.update(headers)
    return await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers=signed
    ), signed, raw


async def test_v2_requires_flag_and_step_up(client, account):
    settings = get_settings()
    settings.signed_writes_enabled = False
    try:
        response = await client.post(
            "/api/v1/vaults",
            json={"cryptoProtocolVersion": 2, "accountPassword": PASSWORD},
            headers=account,
        )
        assert response.status_code == 403
        assert response.json()["detail"] == "signed_writes_disabled"
    finally:
        settings.signed_writes_enabled = True

    missing = await client.post(
        "/api/v1/vaults", json={"cryptoProtocolVersion": 2}, headers=account
    )
    assert missing.status_code == 403
    assert missing.json()["detail"] == "step_up_required"


async def test_bootstrap_snapshot_replay_and_rotation(client, account):
    vault_id, grant = await _create_v2_vault(client, account)
    priv, pub = await _bootstrap_device(client, account, vault_id, grant)

    # Second use of the same grant is rejected.
    replay_grant = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        content=body_bytes({"deviceId": "dev_other_00000001"}),
        headers={**account},
    )
    assert replay_grant.status_code in (403, 422)

    snapshot, signed, raw = await _commit(
        client,
        account,
        vault_id,
        priv,
        pub,
        revision=1,
        base=0,
        key_version=1,
        result_key_version=1,
        manifest_obj=manifest(),
    )
    assert snapshot.status_code == 200, snapshot.text

    # Exact retry: same bytes, same operation id, no second effect.
    retry = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers=signed
    )
    assert retry.status_code == 200, retry.text
    receipt = retry.json()
    assert retry.headers.get("X-4AP-Write-Replayed") == "true"
    assert receipt["bodyAvailable"] is False
    assert "owner" not in json.dumps(receipt)
    assert receipt["result"]["revision"] == 1

    # Same operation id, different body -> mismatch, no effect.
    changed = json.loads(raw)
    changed["sealedManifest"]["ciphertext"] = b64(b"different-body")
    changed_raw = body_bytes(changed)
    mismatch = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots", content=changed_raw, headers=signed
    )
    assert mismatch.status_code == 409
    assert mismatch.json()["detail"] == "write_operation_mismatch"

    # Rotation: old key signs, new key proves possession.
    new_priv = Ed25519PrivateKey.generate()
    new_pub = new_priv.public_key().public_bytes_raw()
    rotated, _, _ = await _commit(
        client,
        account,
        vault_id,
        priv,
        pub,
        revision=2,
        base=1,
        key_version=1,
        result_key_version=2,
        manifest_obj=manifest(b"m2"),
        next_priv=new_priv,
        next_pub=new_pub,
    )
    assert rotated.status_code == 200, rotated.text

    # The retired key can no longer write.
    stale, _, _ = await _commit(
        client,
        account,
        vault_id,
        priv,
        pub,
        revision=3,
        base=2,
        key_version=1,
        result_key_version=1,
        manifest_obj=manifest(b"m3"),
    )
    assert stale.status_code == 409
    assert stale.json()["detail"] == "write_key_version_mismatch"


async def test_v2_rejects_unsigned_and_v1_rejects_signed(client, account):
    vault_id, grant = await _create_v2_vault(client, account)
    await _bootstrap_device(client, account, vault_id, grant)

    payload = {
        "expectedRevision": 0,
        "revision": 1,
        "vaultKeyVersion": 1,
        "cryptoProtocolVersion": 2,
        "envelopes": [envelope()],
        "entries": [],
        "sealedManifest": manifest(),
    }
    unsigned = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots", json=payload, headers=account
    )
    assert unsigned.status_code == 422
    assert unsigned.json()["detail"] == "signed_write_required"

    v1 = await client.post("/api/v1/vaults", json={"cryptoProtocolVersion": 1}, headers=account)
    assert v1.status_code == 201
    v1_id = v1.json()["vaultId"]
    signed_headers, _ = sign(
        priv=Ed25519PrivateKey.generate(),
        pub=b"\x00" * 32,
        vault_id=v1_id,
        device_id=DEVICE,
        method="POST",
        route="/api/v1/vaults/{vaultId}/snapshots",
        resource_type="vault",
        resource_id="",
        parent_id="",
        base=0,
        result=1,
        key_version=1,
        result_key_version=1,
        has_manifest=True,
        manifest_digest=sealed_manifest_digest(manifest()),
        payload_digest=b"\x00" * 32,
        operation_id=uuid.uuid4(),
        nonce=uuid.uuid4().bytes,
    )
    response = await client.post(
        f"/api/v1/vaults/{v1_id}/snapshots", json=payload, headers={**account, **signed_headers}
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "signed_write_not_supported_for_v1"
