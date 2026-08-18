import os
import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.device import Device
from app.models.device_key_envelope import DeviceKeyEnvelope
from app.models.entry import EncryptedEntry
from app.models.enums import EnvelopeType
from app.models.key_envelope import KeyEnvelope
from app.models.snapshot import VaultSnapshot
from app.models.user import User
from app.models.vault import Vault
from app.models.webauthn_credential import WebAuthnCredential

os.environ.setdefault(
    "FOURALLPASS_DATABASE_URL",
    "postgresql+asyncpg://fourallpass:fourallpass@localhost:5432/fourallpass_test",
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _unique_email() -> str:
    return f"user-{uuid.uuid4().hex[:12]}@example.test"


async def _make_vault_with_snapshot(db_session, *, revision: int = 1, vault_key_version: int = 1) -> tuple[User, Vault, VaultSnapshot]:
    user = User(email=_unique_email())
    db_session.add(user)
    await db_session.flush()

    vault = Vault(owner_user_id=user.id, crypto_protocol_version=1)
    db_session.add(vault)
    await db_session.flush()

    snapshot = VaultSnapshot(
        vault_id=vault.id,
        revision=revision,
        vault_key_version=vault_key_version,
        crypto_protocol_version=1,
    )
    db_session.add(snapshot)
    await db_session.flush()
    return user, vault, snapshot


async def test_create_vault_snapshot_with_master_envelope_and_entry(db_session):
    _, vault, snapshot = await _make_vault_with_snapshot(db_session)

    master = KeyEnvelope(
        snapshot_id=snapshot.id,
        type=EnvelopeType.MASTER,
        kdf_params={
            "algorithm": "argon2id",
            "version": 19,
            "memory": 65536,
            "iterations": 3,
            "parallelism": 4,
            "hashLen": 32,
            "salt": "0011223344556677",
        },
        nonce=b"\x00" * 12,
        ciphertext=b"\x01" * 32,
        tag=b"\x02" * 16,
        crypto_version=1,
    )
    entry = EncryptedEntry(
        snapshot_id=snapshot.id,
        entry_id="entry-1",
        schema_version=1,
        crypto_version=1,
        nonce=b"\x00" * 12,
        ciphertext=b"payload",
        tag=b"\x03" * 16,
    )
    db_session.add_all([master, entry])
    await db_session.flush()

    assert master.id is not None
    assert master.type == EnvelopeType.MASTER
    assert entry.snapshot_id == snapshot.id


async def test_key_envelope_master_requires_kdf_params(db_session):
    _, _vault, snapshot = await _make_vault_with_snapshot(db_session)

    bad = KeyEnvelope(
        snapshot_id=snapshot.id,
        type=EnvelopeType.MASTER,
        kdf_params=None,
        nonce=b"\x00" * 12,
        ciphertext=b"\x01" * 32,
        tag=b"\x02" * 16,
        crypto_version=1,
    )
    db_session.add(bad)
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_key_envelope_device_requires_device_id(db_session):
    _, _vault, snapshot = await _make_vault_with_snapshot(db_session)

    bad = KeyEnvelope(
        snapshot_id=snapshot.id,
        type=EnvelopeType.DEVICE,
        device_id=None,
        nonce=b"\x00" * 12,
        ciphertext=b"\x01" * 32,
        tag=b"\x02" * 16,
        crypto_version=1,
    )
    db_session.add(bad)
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_key_envelope_rejects_second_master_in_same_snapshot(db_session):
    _, _vault, snapshot = await _make_vault_with_snapshot(db_session)

    kdf = {
        "algorithm": "argon2id",
        "version": 19,
        "memory": 65536,
        "iterations": 3,
        "parallelism": 4,
        "hashLen": 32,
        "salt": "00",
    }
    first = KeyEnvelope(
        snapshot_id=snapshot.id,
        type=EnvelopeType.MASTER,
        kdf_params=kdf,
        nonce=b"\x00" * 12,
        ciphertext=b"\x01" * 32,
        tag=b"\x02" * 16,
        crypto_version=1,
    )
    db_session.add(first)
    await db_session.flush()

    second = KeyEnvelope(
        snapshot_id=snapshot.id,
        type=EnvelopeType.MASTER,
        kdf_params=kdf,
        nonce=b"\x00" * 12,
        ciphertext=b"\x01" * 32,
        tag=b"\x02" * 16,
        crypto_version=1,
    )
    db_session.add(second)
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_key_envelope_rejects_duplicate_device_envelope_in_same_snapshot(db_session):
    _, _vault, snapshot = await _make_vault_with_snapshot(db_session)

    first = KeyEnvelope(
        snapshot_id=snapshot.id,
        type=EnvelopeType.DEVICE,
        device_id="device-a",
        nonce=b"\x00" * 12,
        ciphertext=b"\x01" * 32,
        tag=b"\x02" * 16,
        crypto_version=1,
    )
    db_session.add(first)
    await db_session.flush()

    duplicate = KeyEnvelope(
        snapshot_id=snapshot.id,
        type=EnvelopeType.DEVICE,
        device_id="device-a",
        nonce=b"\x00" * 12,
        ciphertext=b"\x99" * 32,
        tag=b"\x02" * 16,
        crypto_version=1,
    )
    db_session.add(duplicate)
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_vault_snapshot_unique_revision_per_vault(db_session):
    _, vault, snapshot = await _make_vault_with_snapshot(db_session)

    dup = VaultSnapshot(
        vault_id=vault.id,
        revision=snapshot.revision,
        vault_key_version=snapshot.vault_key_version,
        crypto_protocol_version=1,
    )
    db_session.add(dup)
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_vault_active_snapshot_pointer(db_session):
    _, vault, snapshot = await _make_vault_with_snapshot(db_session)

    vault.active_snapshot_id = snapshot.id
    await db_session.flush()
    await db_session.refresh(vault)
    assert vault.active_snapshot_id == snapshot.id


async def test_device_and_webauthn_credential_and_device_key_envelope(db_session):
    _, vault, snapshot = await _make_vault_with_snapshot(db_session)

    device = Device(vault_id=vault.id, device_id="laptop-chrome-profile-1", display_name="Work laptop")
    db_session.add(device)
    await db_session.flush()

    credential_id = os.urandom(32)
    credential = WebAuthnCredential(
        device_id=device.id,
        rp_id="pass.example.local",
        credential_id=credential_id,
        public_key=b"\x00" * 64,
        sign_count=0,
        prf_supported=True,
        large_blob_supported=False,
        user_verification="required",
    )
    db_session.add(credential)
    await db_session.flush()

    # Device Envelope (crypto-protocol.md §3): wraps VK under DK, lives in key_envelopes.
    device_envelope = KeyEnvelope(
        snapshot_id=snapshot.id,
        type=EnvelopeType.DEVICE,
        device_id=device.device_id,
        nonce=b"\x00" * 12,
        ciphertext=b"\x11" * 32,
        tag=b"\x22" * 16,
        crypto_version=1,
    )
    db_session.add(device_envelope)

    # Device-Key Envelope mirror (webauthn-prf.md §4): wraps DK under DWK.
    device_key_envelope = DeviceKeyEnvelope(
        vault_id=vault.id,
        device_id=device.id,
        webauthn_credential_id=credential.id,
        credential_id=credential_id,
        nonce=b"\x00" * 12,
        ciphertext=b"\x33" * 32,
        tag=b"\x44" * 16,
        crypto_version=1,
    )
    db_session.add(device_key_envelope)
    await db_session.flush()

    assert device_key_envelope.credential_id == credential.credential_id


async def test_users_email_must_be_stored_lowercase(db_session):
    """The unique index on ``email`` is only case-insensitive because of this."""
    db_session.add(User(email="MixedCase@Example.test"))
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_device_key_envelope_unique_per_vault_device(db_session):
    _, vault, _snapshot = await _make_vault_with_snapshot(db_session)

    device = Device(vault_id=vault.id, device_id="laptop-chrome-profile-1")
    db_session.add(device)
    await db_session.flush()

    credential_id = os.urandom(32)
    credential = WebAuthnCredential(
        device_id=device.id,
        rp_id="pass.example.local",
        credential_id=credential_id,
        public_key=b"\x00" * 64,
        prf_supported=True,
    )
    db_session.add(credential)
    await db_session.flush()

    first = DeviceKeyEnvelope(
        vault_id=vault.id,
        device_id=device.id,
        webauthn_credential_id=credential.id,
        credential_id=credential_id,
        nonce=b"\x00" * 12,
        ciphertext=b"\x33" * 32,
        tag=b"\x44" * 16,
        crypto_version=1,
    )
    db_session.add(first)
    await db_session.flush()

    second = DeviceKeyEnvelope(
        vault_id=vault.id,
        device_id=device.id,
        webauthn_credential_id=credential.id,
        credential_id=credential_id,
        nonce=b"\x00" * 12,
        ciphertext=b"\x55" * 32,
        tag=b"\x66" * 16,
        crypto_version=1,
    )
    db_session.add(second)
    with pytest.raises(IntegrityError):
        await db_session.flush()
