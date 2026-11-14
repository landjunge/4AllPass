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

_ACCOUNT_EMAIL: str | None = None

PASSWORD = "CorrectHorseBatteryStaple9!"
EMAIL = "signed.writes@example.com"
DEVICE = "dev_signed_writes_0001"


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def body_bytes(payload: dict) -> bytes:
    return json.dumps(payload, separators=(",", ":")).encode()


def manifest(seed: bytes = b"m1", *, version: int = 1) -> dict:
    return {
        "version": version,
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
        global _ACCOUNT_EMAIL
        email = f"signed-writes-{uuid.uuid4().hex}@example.com"
        _ACCOUNT_EMAIL = email
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
    payload_vault_key: int | None = None,
):
    payload = {
        "expectedRevision": base,
        "revision": revision,
        "vaultKeyVersion": payload_vault_key if payload_vault_key is not None else result_key_version,
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
        manifest_obj=manifest(version=2),
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
        manifest_obj=manifest(b"m2", version=2),
        next_priv=new_priv,
        next_pub=new_pub,
    )
    assert rotated.status_code == 200, rotated.text

    # Original signed bytes, after a real VK1->VK2 rotation: stored receipt,
    # no re-signing and no mutation.
    replay_after_rotation = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers=signed
    )
    assert replay_after_rotation.status_code == 200, replay_after_rotation.text
    assert replay_after_rotation.headers.get("X-4AP-Write-Replayed") == "true"
    assert replay_after_rotation.json()["result"]["revision"] == 1

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
        manifest_obj=manifest(b"m3", version=2),
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
        "sealedManifest": manifest(version=2),
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
        manifest_digest=sealed_manifest_digest(manifest(version=2)),
        payload_digest=b"\x00" * 32,
        operation_id=uuid.uuid4(),
        nonce=uuid.uuid4().bytes,
    )
    response = await client.post(
        f"/api/v1/vaults/{v1_id}/snapshots", json=payload, headers={**account, **signed_headers}
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "signed_write_not_supported_for_v1"


async def test_replay_after_head_advanced_returns_stored_receipt(client, account):
    vault_id, grant = await _create_v2_vault(client, account)
    priv, pub = await _bootstrap_device(client, account, vault_id, grant)

    first, signed, raw = await _commit(
        client,
        account,
        vault_id,
        priv,
        pub,
        revision=1,
        base=0,
        key_version=1,
        result_key_version=1,
        manifest_obj=manifest(version=2),
    )
    assert first.status_code == 200, first.text

    new_priv = Ed25519PrivateKey.generate()
    second, _, _ = await _commit(
        client,
        account,
        vault_id,
        priv,
        pub,
        revision=2,
        base=1,
        key_version=1,
        result_key_version=2,
        manifest_obj=manifest(b"m2", version=2),
        next_priv=new_priv,
        next_pub=new_priv.public_key().public_bytes_raw(),
    )
    assert second.status_code == 200, second.text

    # The signed base revision (0) is stale, but an authorized exact retry
    # must still return the stored receipt, not a CAS error.
    replay = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers=signed
    )
    assert replay.status_code == 200, replay.text
    assert replay.headers.get("X-4AP-Write-Replayed") == "true"
    assert replay.json()["result"]["revision"] == 1


async def test_v1_reads_and_unsigned_commit_still_work(client, account):
    created = await client.post("/api/v1/vaults", json={"cryptoProtocolVersion": 1}, headers=account)
    assert created.status_code == 201
    vault_id = created.json()["vaultId"]
    payload = {
        "expectedRevision": 0,
        "revision": 1,
        "vaultKeyVersion": 1,
        "cryptoProtocolVersion": 1,
        "envelopes": [envelope()],
        "entries": [],
        "sealedManifest": manifest(),
    }
    committed = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots", json=payload, headers=account
    )
    assert committed.status_code == 200, committed.text
    read = await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=account)
    assert read.status_code == 200, read.text
    assert read.json()["revision"] == 1


async def test_signed_key_version_must_match_payload(client, account):
    vault_id, grant = await _create_v2_vault(client, account)
    priv, pub = await _bootstrap_device(client, account, vault_id, grant)

    # header 1->1 with payload VK 2 would advance the head without a key row.
    mismatch, _, _ = await _commit(
        client,
        account,
        vault_id,
        priv,
        pub,
        revision=1,
        base=0,
        key_version=1,
        result_key_version=1,
        manifest_obj=manifest(version=2),
        payload_vault_key=2,
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["detail"] == "write_vault_key_version_mismatch"

    # rotation header 1->2 with payload VK 1 must be rejected.
    rotated_wrong, _, _ = await _commit(
        client,
        account,
        vault_id,
        priv,
        pub,
        revision=1,
        base=0,
        key_version=1,
        result_key_version=2,
        manifest_obj=manifest(version=2),
        payload_vault_key=1,
        next_priv=Ed25519PrivateKey.generate(),
        next_pub=Ed25519PrivateKey.generate().public_key().public_bytes_raw(),
    )
    assert rotated_wrong.status_code == 422
    assert rotated_wrong.json()["detail"] == "write_vault_key_version_mismatch"


async def test_bootstrap_only_on_first_device_registration(client, account):
    vault_id, grant = await _create_v2_vault(client, account)
    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key().public_bytes_raw()
    raw = body_bytes(
        {
            "expectedRevision": 0,
            "revision": 1,
            "vaultKeyVersion": 1,
            "cryptoProtocolVersion": 2,
            "envelopes": [envelope()],
            "entries": [],
            "sealedManifest": manifest(version=2),
        }
    )
    signed, _ = sign(
        priv=priv,
        pub=pub,
        vault_id=vault_id,
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
        manifest_digest=sealed_manifest_digest(manifest(version=2)),
        payload_digest=write_payload_digest_v2(raw),
        operation_id=uuid.uuid4(),
        nonce=uuid.uuid4().bytes,
        has_next=True,
        next_pub=pub,
        next_priv=priv,
    )
    signed["X-4AP-Creation-Grant"] = grant
    response = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**account, **signed}
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "write_bootstrap_route_invalid"


import asyncio
import os
import uuid as _uuid

import pytest as _pytest
from sqlalchemy import func as _func, select as _select, update as _update
from sqlalchemy.ext.asyncio import AsyncSession as _AsyncSession

from app.api import deps as _deps
from app.db.session import create_db_engine as _create_engine
from app.models.snapshot import VaultSnapshot as _Snapshot
from app.models.vault import Vault as _Vault
from app.models.user import User as _User
from app.models.signed_write import VaultWriteKey as _Key, WriteGrant as _Grant, WriteNonce as _Nonce, WriteReceipt as _Receipt


@_pytest.mark.skipif(
    "postgres" not in os.environ.get("FOURALLPASS_DATABASE_URL", ""),
    reason="real-engine barrier test runs on the Postgres CI job",
)
async def test_pg_head_progress_during_lock_wait(client, account):
    vault_id, grant = await _create_v2_vault(client, account)
    priv, pub = await _bootstrap_device(client, account, vault_id, grant)
    first, _, _ = await _commit(
        client, account, vault_id, priv, pub,
        revision=1, base=0, key_version=1, result_key_version=1, manifest_obj=manifest(version=2),
    )
    assert first.status_code == 200, first.text

    entered = asyncio.Event()
    release = asyncio.Event()
    original = _deps.lock_vault_row

    async def gated(db, vid):
        entered.set()
        await release.wait()
        await original(db, vid)

    _deps.lock_vault_row = gated
    engine2 = _create_engine(os.environ["FOURALLPASS_DATABASE_URL"])
    try:
        writer = asyncio.create_task(
            _commit(
                client, account, vault_id, priv, pub,
                revision=2, base=1, key_version=1, result_key_version=1,
                manifest_obj=manifest(b"m2", version=2),
            )
        )
        await entered.wait()
        async with _AsyncSession(bind=engine2) as other:
            async with other.begin():
                await other.execute(
                    _select(_Vault).where(_Vault.id == _uuid.UUID(vault_id)).with_for_update()
                )
                snap = _Snapshot(
                    vault_id=_uuid.UUID(vault_id),
                    revision=2,
                    vault_key_version=1,
                    crypto_protocol_version=2,
                    sealed_manifest=manifest(b"m2", version=2),
                )
                other.add(snap)
                await other.flush()
                await other.execute(
                    _Vault.__table__.update()
                    .where(_Vault.id == _uuid.UUID(vault_id))
                    .values(active_snapshot_id=snap.id)
                )
        release.set()
        response, _, _ = await writer
        assert response.status_code == 409, response.text
    finally:
        release.set()
        _deps.lock_vault_row = original
        await engine2.dispose()


async def test_signed_credential_post_and_replay(client, account):
    vault_id, grant = await _create_v2_vault(client, account)
    priv, pub = await _bootstrap_device(client, account, vault_id, grant)
    snapshot, _, _ = await _commit(
        client, account, vault_id, priv, pub,
        revision=1, base=0, key_version=1, result_key_version=1, manifest_obj=manifest(version=2),
    )
    assert snapshot.status_code == 200, snapshot.text

    credential_id = b64(b"cred-0001")
    payload = {
        "credentialId": credential_id,
        "rpId": "localhost",
        "mechanism": "prf",
        "prfSupported": True,
        "largeBlobSupported": False,
    }
    raw = body_bytes(payload)
    signed, _ = sign(
        priv=priv, pub=pub,
        vault_id=vault_id, device_id=DEVICE,
        method="POST",
        route="/api/v1/vaults/{vaultId}/devices/{deviceId}/credentials",
        resource_type="credential", resource_id=credential_id, parent_id=DEVICE,
        base=1, result=1, key_version=1, result_key_version=1,
        has_manifest=True, manifest_digest=sealed_manifest_digest(manifest(version=2)),
        payload_digest=write_payload_digest_v2(raw),
        operation_id=uuid.uuid4(), nonce=uuid.uuid4().bytes,
    )
    response = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE}/credentials",
        content=raw, headers={**account, **signed},
    )
    assert response.status_code == 200, response.text
    replay = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE}/credentials",
        content=raw, headers={**account, **signed},
    )
    assert replay.status_code == 200, replay.text
    assert replay.headers.get("X-4AP-Write-Replayed") == "true"


def device_envelope(device_id: str) -> dict:
    return {
        "version": 1,
        "type": "device",
        "vaultKeyVersion": 1,
        "encryption": "AES-256-GCM",
        "nonce": b64(bytes(range(12))),
        "ciphertext": b64(b"device" * 4),
        "tag": b64(bytes(range(16))),
        "deviceId": device_id,
        "deviceKeyVersion": 1,
        "kdf": None,
    }


async def test_signed_device_key_envelope_put_and_replay(client, account):
    vault_id, grant = await _create_v2_vault(client, account)
    priv, pub = await _bootstrap_device(client, account, vault_id, grant)
    payload = {
        "expectedRevision": 0,
        "revision": 1,
        "vaultKeyVersion": 1,
        "cryptoProtocolVersion": 2,
        "envelopes": [envelope(), device_envelope(DEVICE)],
        "entries": [],
        "sealedManifest": manifest(version=2),
    }
    raw = body_bytes(payload)
    signed, _ = sign(
        priv=priv, pub=pub, vault_id=vault_id, device_id=DEVICE,
        method="POST", route="/api/v1/vaults/{vaultId}/snapshots",
        resource_type="vault", resource_id="", parent_id="",
        base=0, result=1, key_version=1, result_key_version=1,
        has_manifest=True, manifest_digest=sealed_manifest_digest(manifest(version=2)),
        payload_digest=write_payload_digest_v2(raw),
        operation_id=uuid.uuid4(), nonce=uuid.uuid4().bytes,
    )
    committed = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**account, **signed}
    )
    assert committed.status_code == 200, committed.text

    credential_id = b64(b"cred-env-01")
    cred_raw = body_bytes(
        {"credentialId": credential_id, "rpId": "localhost", "mechanism": "prf",
         "prfSupported": True, "largeBlobSupported": False}
    )
    cred_signed, _ = sign(
        priv=priv, pub=pub, vault_id=vault_id, device_id=DEVICE,
        method="POST", route="/api/v1/vaults/{vaultId}/devices/{deviceId}/credentials",
        resource_type="credential", resource_id=credential_id, parent_id=DEVICE,
        base=1, result=1, key_version=1, result_key_version=1,
        has_manifest=True, manifest_digest=sealed_manifest_digest(manifest(version=2)),
        payload_digest=write_payload_digest_v2(cred_raw),
        operation_id=uuid.uuid4(), nonce=uuid.uuid4().bytes,
    )
    cred = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE}/credentials",
        content=cred_raw, headers={**account, **cred_signed},
    )
    assert cred.status_code == 200, cred.text

    env_payload = {
        "version": 1, "vaultId": vault_id, "deviceId": DEVICE,
        "credentialId": credential_id, "deviceKeyVersion": 1,
        "encryption": "AES-256-GCM", "nonce": b64(bytes(range(12))),
        "ciphertext": b64(b"mirror" * 4), "tag": b64(bytes(range(16))),
    }
    env_raw = body_bytes(env_payload)
    env_signed, _ = sign(
        priv=priv, pub=pub, vault_id=vault_id, device_id=DEVICE,
        method="PUT",
        route="/api/v1/vaults/{vaultId}/devices/{deviceId}/credentials/{credentialId}/device-key-envelope",
        resource_type="credential", resource_id=credential_id, parent_id=DEVICE,
        base=1, result=1, key_version=1, result_key_version=1,
        has_manifest=True, manifest_digest=sealed_manifest_digest(manifest(version=2)),
        payload_digest=write_payload_digest_v2(env_raw),
        operation_id=uuid.uuid4(), nonce=uuid.uuid4().bytes,
    )
    url = f"/api/v1/vaults/{vault_id}/devices/{DEVICE}/credentials/{credential_id}/device-key-envelope?expectedRevision=1"
    put = await client.put(url, content=env_raw, headers={**account, **env_signed})
    assert put.status_code == 200, put.text
    replay = await client.put(url, content=env_raw, headers={**account, **env_signed})
    assert replay.status_code == 200, replay.text
    assert replay.headers.get("X-4AP-Write-Replayed") == "true"


from fastapi import Depends as _Depends, Request as _Request
from httpx import ASGITransport as _ASGITransport, AsyncClient as _Client
from sqlalchemy.ext.asyncio import async_sessionmaker as _sessionmaker

from app.api.deps import get_current_user as _gcuser, get_db as _gdb, get_owned_vault as _gowned, get_writable_vault as _gwritable
from app.main import create_app as _create_app


def _two_clients(engine_a, engine_b, gate_old_writer: bool):
    import asyncio

    entered = asyncio.Event()
    release = asyncio.Event()

    def build(engine, gate: bool):
        app2 = _create_app()
        factory = _sessionmaker(bind=engine, class_=_AsyncSession, expire_on_commit=False, autoflush=False)

        async def override_db():
            async with factory() as session:
                try:
                    yield session
                    await session.commit()
                except Exception:
                    await session.rollback()
                    raise

        app2.dependency_overrides[_gdb] = override_db
        if gate:
            async def gated(
                request: _Request,
                vault=_Depends(_gowned),
                db=_Depends(_gdb),
                user=_Depends(_gcuser),
            ):
                # Ownership was already read by _gowned. Wait before the real
                # vault lock so the rotation can acquire it while we wait.
                if request.headers.get("X-Test-Barrier") == "old-writer":
                    entered.set()
                    await release.wait()
                return await _gwritable(request, vault, db, user)

            app2.dependency_overrides[_gwritable] = gated

        async def hook(request):
            request.headers.setdefault("X-Device-Id", DEVICE)

        base_url = "http://127.0.0.1" if get_settings().is_local() else "http://test"
        return _Client(transport=_ASGITransport(app=app2), base_url=base_url, event_hooks={"request": [hook]})

    return build(engine_a, False), build(engine_b, gate_old_writer), entered, release


async def test_duplicate_operation_two_engines_one_effect(client, account, engine):
    vault_id, grant = await _create_v2_vault(client, account)
    priv, pub = await _bootstrap_device(client, account, vault_id, grant)
    first, _, _ = await _commit(
        client, account, vault_id, priv, pub,
        revision=1, base=0, key_version=1, result_key_version=1, manifest_obj=manifest(version=2),
    )
    assert first.status_code == 200, first.text

    operation = uuid.uuid4()
    nonce = uuid.uuid4().bytes
    payload = {
        "expectedRevision": 1, "revision": 2, "vaultKeyVersion": 1,
        "cryptoProtocolVersion": 2, "envelopes": [envelope()], "entries": [],
        "sealedManifest": manifest(b"m2", version=2),
    }
    raw = body_bytes(payload)
    signed, _ = sign(
        priv=priv, pub=pub, vault_id=vault_id, device_id=DEVICE,
        method="POST", route="/api/v1/vaults/{vaultId}/snapshots",
        resource_type="vault", resource_id="", parent_id="",
        base=1, result=2, key_version=1, result_key_version=1,
        has_manifest=True, manifest_digest=sealed_manifest_digest(payload["sealedManifest"]),
        payload_digest=write_payload_digest_v2(raw),
        operation_id=operation, nonce=nonce,
    )

    engine2 = _create_engine(os.environ["FOURALLPASS_DATABASE_URL"])
    c1, c2, _, _ = _two_clients(engine, engine2, False)
    try:
        async with c1, c2:
            async def send(c):
                return await c.post(
                    f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**account, **signed}
                )
            r1, r2 = await asyncio.gather(send(c1), send(c2))
        assert sorted([r1.status_code, r2.status_code]) == [200, 200], (r1.text, r2.text)
        replayed = [r for r in (r1, r2) if r.headers.get("X-4AP-Write-Replayed") == "true"]
        assert len(replayed) == 1
        revisions = await client.get(f"/api/v1/vaults/{vault_id}/revisions", headers=account)
        assert len(revisions.json()) == 2
        async with _AsyncSession(bind=engine) as chk:
            receipts = await chk.scalar(
                _select(_func.count()).select_from(_Receipt).where(
                    _Receipt.vault_id == _uuid.UUID(vault_id),
                    _Receipt.operation_id == operation,
                )
            )
            assert receipts == 1
    finally:
        await engine2.dispose()


@_pytest.mark.skipif(
    "postgres" not in os.environ.get("FOURALLPASS_DATABASE_URL", ""),
    reason="real-engine rotation barrier runs on the Postgres CI job",
)
async def test_pg_rotation_beats_waiting_old_key_write(client, account, engine):
    vault_id, grant = await _create_v2_vault(client, account)
    priv, pub = await _bootstrap_device(client, account, vault_id, grant)
    first, _, _ = await _commit(
        client, account, vault_id, priv, pub,
        revision=1, base=0, key_version=1, result_key_version=1, manifest_obj=manifest(version=2),
    )
    assert first.status_code == 200, first.text

    engine2 = _create_engine(os.environ["FOURALLPASS_DATABASE_URL"])
    _, gated_client, entered, release = _two_clients(engine, engine2, True)
    try:
        old_payload = {
            "expectedRevision": 1, "revision": 2, "vaultKeyVersion": 1,
            "cryptoProtocolVersion": 2, "envelopes": [envelope()], "entries": [],
            "sealedManifest": manifest(b"old", version=2),
        }
        old_raw = body_bytes(old_payload)
        old_signed, _ = sign(
            priv=priv, pub=pub, vault_id=vault_id, device_id=DEVICE,
            method="POST", route="/api/v1/vaults/{vaultId}/snapshots",
            resource_type="vault", resource_id="", parent_id="",
            base=1, result=2, key_version=1, result_key_version=1,
            has_manifest=True, manifest_digest=sealed_manifest_digest(old_payload["sealedManifest"]),
            payload_digest=write_payload_digest_v2(old_raw),
            operation_id=uuid.uuid4(), nonce=uuid.uuid4().bytes,
        )
        old_signed["X-Test-Barrier"] = "old-writer"

        async with gated_client:
            writer = asyncio.create_task(
                gated_client.post(
                    f"/api/v1/vaults/{vault_id}/snapshots", content=old_raw, headers={**account, **old_signed}
                )
            )
            await entered.wait()

            new_priv = Ed25519PrivateKey.generate()
            rotated, _, _ = await _commit(
                client, account, vault_id, priv, pub,
                revision=2, base=1, key_version=1, result_key_version=2,
                manifest_obj=manifest(b"rotated", version=2),
                next_priv=new_priv,
                next_pub=new_priv.public_key().public_bytes_raw(),
            )
            assert rotated.status_code == 200, rotated.text

            release.set()
            stale = await writer
            assert stale.status_code == 409, stale.text
            assert stale.json()["detail"] in {
                "write_revision_conflict", "write_key_version_mismatch"
            }
            async with _AsyncSession(bind=engine) as chk:
                rows = (
                    await chk.execute(
                        _select(_Key).where(_Key.vault_id == _uuid.UUID(vault_id)).order_by(_Key.key_version)
                    )
                ).scalars().all()
                assert [(r.key_version, r.retired_at is not None) for r in rows] == [(1, True), (2, False)]
            revisions = await client.get(f"/api/v1/vaults/{vault_id}/revisions", headers=account)
            assert len(revisions.json()) == 2
    finally:
        release.set()
        await engine2.dispose()


def _snapshot_request(vault_id, priv, pub, *, base, revision, vk, op, nonce, manifest_obj=None, next_priv=None, next_pub=None):
    payload = {
        "expectedRevision": base, "revision": revision, "vaultKeyVersion": vk,
        "cryptoProtocolVersion": 2, "envelopes": [envelope()], "entries": [],
        "sealedManifest": manifest_obj or manifest(version=2),
    }
    raw = body_bytes(payload)
    headers, _ = sign(
        priv=priv, pub=pub, vault_id=vault_id, device_id=DEVICE,
        method="POST", route="/api/v1/vaults/{vaultId}/snapshots",
        resource_type="vault", resource_id="", parent_id="",
        base=base, result=revision, key_version=vk, result_key_version=vk,
        has_manifest=True, manifest_digest=sealed_manifest_digest(payload["sealedManifest"]),
        payload_digest=write_payload_digest_v2(raw), operation_id=op, nonce=nonce,
        has_next=next_priv is not None, next_pub=next_pub, next_priv=next_priv,
    )
    return headers, raw


async def test_owner_transfer_and_foreign_bearer_404(client, account, engine):
    vault_id, grant = await _create_v2_vault(client, account)
    priv, pub = await _bootstrap_device(client, account, vault_id, grant)
    op, nonce = uuid.uuid4(), uuid.uuid4().bytes
    headers, raw = _snapshot_request(vault_id, priv, pub, base=0, revision=1, vk=1, op=op, nonce=nonce)
    first = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**account, **headers})
    assert first.status_code == 200, first.text

    other_email = f"other-{uuid.uuid4().hex}@example.com"
    reg = await client.post("/api/v1/auth/register", json={"email": other_email, "password": PASSWORD})
    assert reg.status_code == 200
    other_login = await client.post(
        "/api/v1/auth/login", json={"email": other_email, "password": PASSWORD},
        headers={"X-Device-Id": "dev_other_owner_0001"},
    )
    assert other_login.status_code == 200, other_login.text
    other = {"Authorization": f"Bearer {other_login.json()['token']}", "X-Device-Id": "dev_other_owner_0001"}

    foreign = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**other, **headers})
    assert foreign.status_code == 404

    async with _AsyncSession(bind=engine) as db:
        async with db.begin():
            other_id = await db.scalar(_select(_User.id).where(_User.email == other_email))
            await db.execute(
                _update(_Vault).where(_Vault.id == _uuid.UUID(vault_id)).values(owner_user_id=other_id)
            )
    old_owner = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**account, **headers})
    assert old_owner.status_code == 404
    new_owner = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**other, **headers})
    assert new_owner.status_code == 404
    revisions = await client.get(f"/api/v1/vaults/{vault_id}/revisions", headers=other)
    assert len(revisions.json()) == 1


async def test_same_owner_other_device_and_route_mismatch(client, account, engine):
    vault_id, grant = await _create_v2_vault(client, account)
    priv, pub = await _bootstrap_device(client, account, vault_id, grant)
    op, nonce = uuid.uuid4(), uuid.uuid4().bytes
    headers, raw = _snapshot_request(vault_id, priv, pub, base=0, revision=1, vk=1, op=op, nonce=nonce)
    first = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**account, **headers})
    assert first.status_code == 200, first.text

    login = await client.post(
        "/api/v1/auth/login", json={"email": _ACCOUNT_EMAIL, "password": PASSWORD},
        headers={"X-Device-Id": "dev_same_owner_0002"},
    )
    other_device = {"Authorization": f"Bearer {login.json()['token']}", "X-Device-Id": "dev_same_owner_0002"}
    wrong_device = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**other_device, **headers})
    assert wrong_device.status_code == 404

    cred = b64(b"cred-45")
    body = body_bytes({"credentialId": cred, "rpId": "localhost", "mechanism": "prf", "prfSupported": True, "largeBlobSupported": False})
    cred_headers, _ = sign(
        priv=priv, pub=pub, vault_id=vault_id, device_id=DEVICE,
        method="POST", route="/api/v1/vaults/{vaultId}/devices/{deviceId}/credentials",
        resource_type="credential", resource_id=cred, parent_id=DEVICE,
        base=1, result=1, key_version=1, result_key_version=1,
        has_manifest=True, manifest_digest=sealed_manifest_digest(manifest(version=2)),
        payload_digest=write_payload_digest_v2(body), operation_id=op, nonce=nonce,
    )
    mismatch = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE}/credentials", content=body, headers={**account, **cred_headers}
    )
    assert mismatch.status_code == 409
    assert mismatch.json()["detail"] == "write_operation_mismatch"


async def test_self_revoke_keep_token_blocks_write_and_replay(client, account):
    vault_id, grant = await _create_v2_vault(client, account)
    priv, pub = await _bootstrap_device(client, account, vault_id, grant)
    op, nonce = uuid.uuid4(), uuid.uuid4().bytes
    headers, raw = _snapshot_request(vault_id, priv, pub, base=0, revision=1, vk=1, op=op, nonce=nonce)
    first = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**account, **headers})
    assert first.status_code == 200, first.text

    revoked = await client.delete(f"/api/v1/vaults/{vault_id}/devices/{DEVICE}", headers=account)
    assert revoked.status_code == 200, revoked.text

    replay = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**account, **headers})
    assert replay.status_code == 403
    assert replay.json()["detail"] == "device_revoked"

    new_headers, new_raw = _snapshot_request(vault_id, priv, pub, base=1, revision=2, vk=1, op=uuid.uuid4(), nonce=uuid.uuid4().bytes, manifest_obj=manifest(b"m2", version=2))
    blocked = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", content=new_raw, headers={**account, **new_headers})
    assert blocked.status_code == 403

    read = await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=account)
    assert read.status_code == 200
    revisions = await client.get(f"/api/v1/vaults/{vault_id}/revisions", headers=account)
    assert len(revisions.json()) == 1


async def test_negative_signature_nonce_and_grant(client, account, engine):
    vault_id, grant = await _create_v2_vault(client, account)
    priv, pub = await _bootstrap_device(client, account, vault_id, grant)
    op, nonce = uuid.uuid4(), uuid.uuid4().bytes
    headers, raw = _snapshot_request(vault_id, priv, pub, base=0, revision=1, vk=1, op=op, nonce=nonce)
    bad = dict(headers)
    bad["X-4AP-Write-Signature"] = b64url(b"\x00" * 64)
    rejected = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**account, **bad})
    assert rejected.status_code == 403
    assert rejected.json()["detail"] == "write_signature_invalid"

    ok = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**account, **headers})
    assert ok.status_code == 200, ok.text
    reused_nonce = uuid.uuid4()
    h2, r2 = _snapshot_request(vault_id, priv, pub, base=1, revision=2, vk=1, op=reused_nonce, nonce=nonce, manifest_obj=manifest(b"m2", version=2))
    nonce_reuse = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", content=r2, headers={**account, **h2})
    assert nonce_reuse.status_code == 409
    assert nonce_reuse.json()["detail"] == "write_nonce_reused"

    for name, mutate in (("expired", "expired"), ("purpose", "purpose")):
        vid, token = await _create_v2_vault(client, account)
        async with _AsyncSession(bind=engine) as db:
            async with db.begin():
                row = await db.scalar(_select(_Grant).where(_Grant.vault_id == _uuid.UUID(vid)))
                if mutate == "expired":
                    row.expires_at = __import__("datetime").datetime(2000, 1, 1, tzinfo=__import__("datetime").timezone.utc)
                else:
                    row.purpose = "other"
        gpriv = Ed25519PrivateKey.generate()
        gpub = gpriv.public_key().public_bytes_raw()
        gbody = body_bytes({"deviceId": DEVICE})
        gh, _ = sign(
            priv=gpriv, pub=gpub, vault_id=vid, device_id=DEVICE,
            method="POST", route="/api/v1/vaults/{vaultId}/devices",
            resource_type="device", resource_id=DEVICE, parent_id="",
            base=0, result=0, key_version=1, result_key_version=1,
            has_manifest=False, manifest_digest=b"",
            payload_digest=write_payload_digest_v2(gbody), operation_id=uuid.uuid4(),
            nonce=uuid.uuid4().bytes, has_next=True, next_pub=gpub, next_priv=gpriv,
        )
        gh["X-4AP-Creation-Grant"] = token
        denied = await client.post(f"/api/v1/vaults/{vid}/devices", content=gbody, headers={**account, **gh})
        assert denied.status_code == 403, (name, denied.text)


async def test_session_removed_yields_401_no_receipt(client, account, engine):
    vault_id, grant = await _create_v2_vault(client, account)
    priv, pub = await _bootstrap_device(client, account, vault_id, grant)
    op, nonce = uuid.uuid4(), uuid.uuid4().bytes
    headers, raw = _snapshot_request(vault_id, priv, pub, base=0, revision=1, vk=1, op=op, nonce=nonce)
    first = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**account, **headers})
    assert first.status_code == 200, first.text

    logout = await client.post("/api/v1/auth/logout", headers=account)
    assert logout.status_code == 204

    replay = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**account, **headers})
    assert replay.status_code == 401
    async with _AsyncSession(bind=engine) as db:
        receipts = await db.scalar(
            _select(_func.count()).select_from(_Receipt).where(_Receipt.vault_id == _uuid.UUID(vault_id))
        )
        assert receipts == 2
    revisions = await client.get(f"/api/v1/vaults/{vault_id}/revisions", headers=account)
    assert revisions.status_code == 401


async def test_unsigned_webauthn_challenge_does_not_touch_receipts(client, account, engine):
    vault_id, grant = await _create_v2_vault(client, account)
    priv, pub = await _bootstrap_device(client, account, vault_id, grant)
    op, nonce = uuid.uuid4(), uuid.uuid4().bytes
    headers, raw = _snapshot_request(vault_id, priv, pub, base=0, revision=1, vk=1, op=op, nonce=nonce)
    first = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**account, **headers})
    assert first.status_code == 200, first.text

    challenge = await client.post(
        f"/api/v1/vaults/{vault_id}/webauthn/challenges",
        json={"purpose": "create", "deviceId": DEVICE},
        headers=account,
    )
    assert challenge.status_code == 200, challenge.text
    assert challenge.json()["challenge"]
    async with _AsyncSession(bind=engine) as db:
        receipts = await db.scalar(
            _select(_func.count()).select_from(_Receipt).where(_Receipt.vault_id == _uuid.UUID(vault_id))
        )
        assert receipts == 2


async def test_local_adopt_not_available_for_v2_signed_vault(client, account, engine):
    vault_id, grant = await _create_v2_vault(client, account)
    priv, pub = await _bootstrap_device(client, account, vault_id, grant)
    response = await client.post("/api/v1/local/adopt-local-vault", headers=account)
    assert response.status_code in {400, 403, 404}, response.text
    async with _AsyncSession(bind=engine) as db:
        owner = await db.scalar(_select(_Vault.owner_user_id).where(_Vault.id == _uuid.UUID(vault_id)))
        receipts = await db.scalar(
            _select(_func.count()).select_from(_Receipt).where(_Receipt.vault_id == _uuid.UUID(vault_id))
        )
        assert owner is not None and receipts == 1


@_pytest.mark.skipif(
    "postgres" not in os.environ.get("FOURALLPASS_DATABASE_URL", ""),
    reason="lock-wait barrier runs on the Postgres CI job; SQLite serializes earlier",
)
async def test_local_adopt_race_old_owner_signed_write_and_receipt(client, account, engine):
    from app.api.routes.auth import LOCAL_ACCOUNT_EMAIL

    settings = get_settings()
    previous_profile = settings.profile
    settings.profile = "local"
    try:
        local_session = await client.post(
            "/api/v1/auth/local", headers={"X-Device-Id": DEVICE}
        )
        assert local_session.status_code == 200, local_session.text
        local = {
            "Authorization": f"Bearer {local_session.json()['token']}",
            "X-Device-Id": DEVICE,
        }

        priv = Ed25519PrivateKey.generate()
        pub = priv.public_key().public_bytes_raw()
        async with _AsyncSession(bind=engine) as db:
            async with db.begin():
                local_user = await db.scalar(_select(_User).where(_User.email == LOCAL_ACCOUNT_EMAIL))
                vault = _Vault(owner_user_id=local_user.id, crypto_protocol_version=2)
                db.add(vault)
                await db.flush()
                vault_id = str(vault.id)
                db.add(_Key(vault_id=vault.id, key_version=1, public_key=pub))

        op, nonce = uuid.uuid4(), uuid.uuid4().bytes
        headers, raw = _snapshot_request(vault_id, priv, pub, base=0, revision=1, vk=1, op=op, nonce=nonce)
        first = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**local, **headers})
        assert first.status_code == 200, first.text

        engine2 = _create_engine(os.environ["FOURALLPASS_DATABASE_URL"])
        _, gated_client, entered, release = _two_clients(engine, engine2, True)
        try:
            new_headers, new_raw = _snapshot_request(
                vault_id, priv, pub, base=1, revision=2, vk=1,
                op=uuid.uuid4(), nonce=uuid.uuid4().bytes, manifest_obj=manifest(b"m2", version=2),
            )
            new_headers["X-Test-Barrier"] = "old-writer"
            async with gated_client:
                writer = asyncio.create_task(
                    gated_client.post(
                        f"/api/v1/vaults/{vault_id}/snapshots",
                        content=new_raw, headers={**local, **new_headers},
                    )
                )
                gate = asyncio.create_task(entered.wait())
                done, _ = await asyncio.wait({gate, writer}, return_when=asyncio.FIRST_COMPLETED)
                if writer in done:
                    gate.cancel()
                    early = writer.result()
                    raise AssertionError(
                        f"old-owner request ended before the barrier: {early.status_code} {early.text}"
                    )
                await gate

                adopted = await client.post("/api/v1/local/adopt-local-vault", headers=account)
                assert adopted.status_code == 200, adopted.text

                release.set()
                stale = await writer
                assert stale.status_code == 404, stale.text

            replay = await client.post(
                f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**local, **headers}
            )
            assert replay.status_code == 404

            async with _AsyncSession(bind=engine) as db:
                owner = await db.scalar(_select(_Vault.owner_user_id).where(_Vault.id == _uuid.UUID(vault_id)))
                account_id = await db.scalar(_select(_User.id).where(_User.email == _ACCOUNT_EMAIL))
                assert owner == account_id
                revisions = (
                    await db.execute(
                        _select(_func.count()).select_from(_Snapshot).where(
                            _Snapshot.vault_id == _uuid.UUID(vault_id)
                        )
                    )
                ).scalar()
                receipts = (
                    await db.execute(
                        _select(_func.count()).select_from(_Receipt).where(
                            _Receipt.vault_id == _uuid.UUID(vault_id)
                        )
                    )
                ).scalar()
                assert revisions == 1
                assert receipts == 1
        finally:
            release.set()
            await engine2.dispose()
    finally:
        settings.profile = previous_profile


async def _local_v2_fixture(client, engine):
    from app.api.routes.auth import LOCAL_ACCOUNT_EMAIL

    session = await client.post("/api/v1/auth/local", headers={"X-Device-Id": DEVICE})
    assert session.status_code == 200, session.text
    local = {"Authorization": f"Bearer {session.json()['token']}", "X-Device-Id": DEVICE}
    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key().public_bytes_raw()
    async with _AsyncSession(bind=engine) as db:
        async with db.begin():
            user = await db.scalar(_select(_User).where(_User.email == LOCAL_ACCOUNT_EMAIL))
            vault = _Vault(owner_user_id=user.id, crypto_protocol_version=2)
            db.add(vault)
            await db.flush()
            vault_id = str(vault.id)
            db.add(_Key(vault_id=vault.id, key_version=1, public_key=pub))
    return local, priv, pub, vault_id


async def test_local_adopt_serialized_write_before_and_after(client, account, engine):
    """SQLite: no barrier. Signed write, then adopt, then old owner is 404."""
    settings = get_settings()
    previous = settings.profile
    settings.profile = "local"
    try:
        local, priv, pub, vault_id = await _local_v2_fixture(client, engine)
        op, nonce = uuid.uuid4(), uuid.uuid4().bytes
        headers, raw = _snapshot_request(vault_id, priv, pub, base=0, revision=1, vk=1, op=op, nonce=nonce)
        first = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**local, **headers})
        assert first.status_code == 200, first.text

        adopted = await client.post("/api/v1/local/adopt-local-vault", headers=account)
        assert adopted.status_code == 200, adopted.text

        new_headers, new_raw = _snapshot_request(
            vault_id, priv, pub, base=1, revision=2, vk=1,
            op=uuid.uuid4(), nonce=uuid.uuid4().bytes, manifest_obj=manifest(b"m2", version=2),
        )
        old_write = await client.post(
            f"/api/v1/vaults/{vault_id}/snapshots", content=new_raw, headers={**local, **new_headers}
        )
        assert old_write.status_code == 404
        replay = await client.post(
            f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**local, **headers}
        )
        assert replay.status_code == 404

        async with _AsyncSession(bind=engine) as db:
            owner = await db.scalar(_select(_Vault.owner_user_id).where(_Vault.id == _uuid.UUID(vault_id)))
            account_id = await db.scalar(_select(_User.id).where(_User.email == _ACCOUNT_EMAIL))
            assert owner == account_id
            revisions = (
                await db.execute(_select(_func.count()).select_from(_Snapshot).where(_Snapshot.vault_id == _uuid.UUID(vault_id)))
            ).scalar()
            receipts = (
                await db.execute(_select(_func.count()).select_from(_Receipt).where(_Receipt.vault_id == _uuid.UUID(vault_id)))
            ).scalar()
            assert revisions == 1
            assert receipts == 1
    finally:
        settings.profile = previous


async def _rotation_request(vault_id, priv, pub, next_priv, next_pub, *, base, revision, payload_vk):
    payload = {
        "expectedRevision": base, "revision": revision, "vaultKeyVersion": payload_vk,
        "cryptoProtocolVersion": 2, "envelopes": [envelope()], "entries": [],
        "sealedManifest": manifest(b"rot", version=2),
    }
    raw = body_bytes(payload)
    headers, _ = sign(
        priv=priv, pub=pub, vault_id=vault_id, device_id=DEVICE,
        method="POST", route="/api/v1/vaults/{vaultId}/snapshots",
        resource_type="vault", resource_id="", parent_id="",
        base=base, result=revision, key_version=1, result_key_version=2,
        has_manifest=True, manifest_digest=sealed_manifest_digest(payload["sealedManifest"]),
        payload_digest=write_payload_digest_v2(raw), operation_id=uuid.uuid4(),
        nonce=uuid.uuid4().bytes, has_next=True, next_pub=next_pub, next_priv=next_priv,
    )
    return headers, raw


async def _signed_state(engine, vault_id):
    async with _AsyncSession(bind=engine) as db:
        pointer = await db.scalar(_select(_Vault.active_snapshot_id).where(_Vault.id == _uuid.UUID(vault_id)))
        head = await db.scalar(_select(_Snapshot).where(_Snapshot.id == pointer)) if pointer else None
        keys = (
            await db.execute(_select(_Key).where(_Key.vault_id == _uuid.UUID(vault_id)).order_by(_Key.key_version))
        ).scalars().all()
        receipts = (
            await db.execute(_select(_func.count()).select_from(_Receipt).where(_Receipt.vault_id == _uuid.UUID(vault_id)))
        ).scalar()
        nonces = (
            await db.execute(_select(_func.count()).select_from(_Nonce).where(_Nonce.vault_id == _uuid.UUID(vault_id)))
        ).scalar()
        return {
            "revision": head.revision if head else None,
            "vk": head.vault_key_version if head else None,
            "keys": [(k.key_version, k.retired_at is not None) for k in keys],
            "receipts": receipts,
            "nonces": nonces,
        }


async def test_conflict_rolls_back_prepare_side_effects(client, account, engine):
    vault_id, grant = await _create_v2_vault(client, account)
    priv, pub = await _bootstrap_device(client, account, vault_id, grant)
    first, _, _ = await _commit(
        client, account, vault_id, priv, pub,
        revision=1, base=0, key_version=1, result_key_version=1, manifest_obj=manifest(version=2),
    )
    assert first.status_code == 200, first.text
    before = await _signed_state(engine, vault_id)
    assert before["revision"] == 1 and before["keys"] == [(1, False)]

    new_priv = Ed25519PrivateKey.generate()
    new_pub = new_priv.public_key().public_bytes_raw()

    # Valid signature, stale base (0 while head is 1).
    stale, stale_raw = await _rotation_request(
        vault_id, priv, pub, new_priv, new_pub, base=0, revision=2, payload_vk=2
    )
    stale_resp = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots", content=stale_raw, headers={**account, **stale}
    )
    assert stale_resp.status_code == 409, stale_resp.text
    assert await _signed_state(engine, vault_id) == before

    # Valid signature, skipped result revision (3 instead of 2).
    skipped, skipped_raw = await _rotation_request(
        vault_id, priv, pub, new_priv, new_pub, base=1, revision=3, payload_vk=2
    )
    skipped_resp = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots", content=skipped_raw, headers={**account, **skipped}
    )
    assert skipped_resp.status_code == 409, skipped_resp.text
    assert await _signed_state(engine, vault_id) == before

    # The same key material still works for the correct rotation.
    good, good_raw = await _rotation_request(
        vault_id, priv, pub, new_priv, new_pub, base=1, revision=2, payload_vk=2
    )
    ok = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots", content=good_raw, headers={**account, **good}
    )
    assert ok.status_code == 200, ok.text
    after = await _signed_state(engine, vault_id)
    assert after["revision"] == 2 and after["vk"] == 2
    assert after["keys"] == [(1, True), (2, False)]
