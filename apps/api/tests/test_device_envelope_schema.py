import uuid

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.models import (
    Account,
    Device,
    SnapshotEnvelope,
    Vault,
    VaultSnapshot,
    WebAuthnCredential,
    envelope_slot,
)
from app.schemas import DeviceKeyEnvelopeWire, KeyEnvelopeWire
from app.zk import FORBIDDEN_COLUMN_NAMES, FORBIDDEN_WIRE_KEYS
from app.db import Base


DEVICE_ENVELOPE = {
    "version": 1,
    "type": "device",
    "deviceId": "dev_macbook_chrome_profile_1",
    "encryption": "AES-256-GCM",
    "nonce": "AQIDBAUGBwgJCgsM",
    "ciphertext": "lR-lqoV560wym-7AMZKY_dYDKHu57e7ZuxOkpqGJD_g",
    "tag": "S2sSBwA78VkJDZwVShL7vQ",
}

DEVICE_KEY_ENVELOPE = {
    "version": 1,
    "vaultId": "vault_01HZX4ALLPASS000000000001",
    "deviceId": "dev_macbook_chrome_profile_1",
    "credentialId": "yv66vsr-uu7K_rruyv667g",
    "encryption": "AES-256-GCM",
    "nonce": "AQIDBAUGBwgJCgsM",
    "ciphertext": "lR-lqoV560wym-7AMZKY_dYDKHu57e7ZuxOkpqGJD_g",
    "tag": "S2sSBwA78VkJDZwVShL7vQ",
}


def _seed(session, *, vault_id: str = "vault_01HZX4ALLPASS000000000001"):
    account = Account(id=uuid.uuid4(), email="owner@example.test")
    vault = Vault(id=vault_id, account_id=account.id, crypto_protocol_version=1, active_revision=None)
    session.add_all([account, vault])
    session.flush()
    return account, vault


def test_no_table_exposes_key_material_columns() -> None:
    names = {column.name for table in Base.metadata.tables.values() for column in table.columns}
    leaked = names & FORBIDDEN_COLUMN_NAMES
    assert not leaked


def test_device_envelope_persists_as_opaque_json(session) -> None:
    account, vault = _seed(session)
    device_id = DEVICE_ENVELOPE["deviceId"]
    session.add(
        VaultSnapshot(
            vault_id=vault.id,
            revision=1,
            vault_key_version=1,
            crypto_protocol_version=1,
        )
    )
    session.add(
        SnapshotEnvelope(
            vault_id=vault.id,
            revision=1,
            envelope_slot=envelope_slot("device", device_id),
            envelope_type="device",
            device_id=device_id,
            envelope=DEVICE_ENVELOPE,
        )
    )
    vault.active_revision = 1
    session.commit()

    stored = session.get(SnapshotEnvelope, (vault.id, 1, f"device:{device_id}"))
    assert stored is not None
    assert stored.envelope["type"] == "device"
    assert stored.envelope["deviceId"] == device_id
    assert FORBIDDEN_WIRE_KEYS.isdisjoint(stored.envelope)


def test_device_envelope_requires_device_id(session) -> None:
    _, vault = _seed(session)
    session.add(VaultSnapshot(vault_id=vault.id, revision=1, vault_key_version=1, crypto_protocol_version=1))
    session.add(
        SnapshotEnvelope(
            vault_id=vault.id,
            revision=1,
            envelope_slot="device:missing",
            envelope_type="device",
            device_id=None,
            envelope=DEVICE_ENVELOPE,
        )
    )
    with pytest.raises(IntegrityError):
        session.commit()


def test_webauthn_mirrors_opaque_device_key_envelope(session) -> None:
    account, vault = _seed(session)
    device_id = DEVICE_KEY_ENVELOPE["deviceId"]
    session.add(
        Device(
            vault_id=vault.id,
            id=device_id,
            account_id=account.id,
            user_agent_summary="Chrome macOS",
        )
    )
    session.add(
        WebAuthnCredential(
            credential_id=b"\xca\xfe\xba\xbe" * 4,
            vault_id=vault.id,
            device_id=device_id,
            rp_id="pass.example.local",
            unlock_mechanism="prf",
            user_verification="required",
            device_key_envelope=DEVICE_KEY_ENVELOPE,
        )
    )
    session.commit()

    cred = session.get(WebAuthnCredential, b"\xca\xfe\xba\xbe" * 4)
    assert cred is not None
    assert cred.unlock_mechanism == "prf"
    assert cred.user_verification == "required"
    assert cred.device_key_envelope["vaultId"] == vault.id
    assert FORBIDDEN_WIRE_KEYS.isdisjoint(cred.device_key_envelope)


def test_active_revision_cas(session) -> None:
    _, vault = _seed(session)
    session.add(VaultSnapshot(vault_id=vault.id, revision=1, vault_key_version=1, crypto_protocol_version=1))
    vault.active_revision = 1
    session.commit()

    updated = (
        session.query(Vault)
        .filter(Vault.id == vault.id, Vault.active_revision == 1)
        .update({"active_revision": 2})
    )
    assert updated == 1
    stale = (
        session.query(Vault)
        .filter(Vault.id == vault.id, Vault.active_revision == 1)
        .update({"active_revision": 3})
    )
    assert stale == 0


def test_wire_schema_rejects_plaintext_keys() -> None:
    with pytest.raises(ValidationError):
        KeyEnvelopeWire.model_validate({**DEVICE_ENVELOPE, "vaultKey": "nope"})
    with pytest.raises(ValidationError):
        DeviceKeyEnvelopeWire.model_validate({**DEVICE_KEY_ENVELOPE, "prfOutput": "nope"})


def test_wire_schema_accepts_device_envelope() -> None:
    parsed = KeyEnvelopeWire.model_validate(DEVICE_ENVELOPE)
    assert parsed.type == "device"
    assert parsed.deviceId == DEVICE_ENVELOPE["deviceId"]
