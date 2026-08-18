"""The database refuses malformed crypto material even if the API layer does not.

These insert straight into PostgreSQL, bypassing pydantic, so what is being
tested here is the CHECK and UNIQUE constraints of the migration.
"""

import secrets
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

INSERT_ENVELOPE = text(
    "INSERT INTO key_envelopes (id, snapshot_id, type, device_id, vault_key_version, "
    "device_key_version, crypto_version, nonce, ciphertext, "
    "tag, kdf_algorithm, kdf_version, kdf_memory_kib, kdf_iterations, kdf_parallelism, kdf_hash_len, "
    "kdf_salt) VALUES (:id, :snapshot_id, :type, :device_id, :vault_key_version, "
    ":device_key_version, :crypto_version, :nonce, :ciphertext, "
    ":tag, :kdf_algorithm, :kdf_version, :kdf_memory_kib, :kdf_iterations, :kdf_parallelism, "
    ":kdf_hash_len, :kdf_salt)"
)


async def seed_snapshot(session: AsyncSession) -> uuid.UUID:
    account_id = uuid.uuid4()
    vault_id = f"vault_{secrets.token_hex(8)}"
    snapshot_id = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO accounts (id, email, password_hash, is_active) VALUES (:id, :email, 'x', true)"
        ),
        {"id": account_id, "email": f"{account_id}@example.com"},
    )
    await session.execute(
        text(
            "INSERT INTO vaults (id, account_id, crypto_protocol_version) "
            "VALUES (:vault_id, :account_id, 1)"
        ),
        {"vault_id": vault_id, "account_id": account_id},
    )
    await session.execute(
        text(
            "INSERT INTO vault_snapshots (id, vault_id, revision, vault_key_version, "
            "crypto_protocol_version, status) VALUES (:id, :vault_id, 1, 1, 1, 'pending')"
        ),
        {"id": snapshot_id, "vault_id": vault_id},
    )
    await session.commit()
    return snapshot_id


def envelope_values(snapshot_id: uuid.UUID, **overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "snapshot_id": snapshot_id,
        "type": "device",
        "device_id": "dev_1",
        "vault_key_version": 1,
        "device_key_version": 1,
        "crypto_version": 1,
        "nonce": secrets.token_bytes(12),
        "ciphertext": secrets.token_bytes(32),
        "tag": secrets.token_bytes(16),
        "kdf_algorithm": None,
        "kdf_version": None,
        "kdf_memory_kib": None,
        "kdf_iterations": None,
        "kdf_parallelism": None,
        "kdf_hash_len": None,
        "kdf_salt": None,
    }
    values.update(overrides)
    return values


async def expect_violation(session: AsyncSession, **overrides: object) -> None:
    snapshot_id = await seed_snapshot(session)
    with pytest.raises(IntegrityError):
        await session.execute(INSERT_ENVELOPE, envelope_values(snapshot_id, **overrides))
        await session.commit()
    await session.rollback()


async def test_envelope_nonce_must_be_twelve_bytes(db_session: AsyncSession) -> None:
    await expect_violation(db_session, nonce=secrets.token_bytes(11))


async def test_envelope_tag_must_be_sixteen_bytes(db_session: AsyncSession) -> None:
    await expect_violation(db_session, tag=secrets.token_bytes(15))


async def test_envelope_ciphertext_must_be_a_wrapped_key(db_session: AsyncSession) -> None:
    await expect_violation(db_session, ciphertext=secrets.token_bytes(31))


async def test_crypto_version_must_be_one(db_session: AsyncSession) -> None:
    await expect_violation(db_session, crypto_version=2)


async def test_device_envelope_must_have_a_device_id(db_session: AsyncSession) -> None:
    await expect_violation(db_session, device_id=None)


async def test_device_envelope_must_have_a_device_key_version(db_session: AsyncSession) -> None:
    await expect_violation(db_session, device_key_version=None)


async def test_device_key_version_must_be_positive(db_session: AsyncSession) -> None:
    await expect_violation(db_session, device_key_version=0)


async def test_envelope_vault_key_version_must_be_positive(db_session: AsyncSession) -> None:
    await expect_violation(db_session, vault_key_version=0)


async def test_master_envelope_must_not_have_a_device_id(db_session: AsyncSession) -> None:
    await expect_violation(
        db_session,
        type="master",
        device_id="dev_1",
        device_key_version=None,
        kdf_algorithm="argon2id",
        kdf_version=19,
        kdf_memory_kib=65536,
        kdf_iterations=3,
        kdf_parallelism=4,
        kdf_hash_len=32,
        kdf_salt=secrets.token_bytes(16),
    )


async def test_device_envelope_must_not_carry_kdf_parameters(db_session: AsyncSession) -> None:
    await expect_violation(
        db_session,
        kdf_algorithm="argon2id",
        kdf_version=19,
        kdf_memory_kib=65536,
        kdf_iterations=3,
        kdf_parallelism=4,
        kdf_hash_len=32,
        kdf_salt=secrets.token_bytes(16),
    )


async def test_master_envelope_requires_kdf_parameters(db_session: AsyncSession) -> None:
    await expect_violation(db_session, type="master", device_id=None, device_key_version=None)


async def test_master_kdf_must_use_argon2id_v19_with_a_valid_salt(db_session: AsyncSession) -> None:
    base = {
        "type": "master",
        "device_id": None,
        "device_key_version": None,
        "kdf_algorithm": "argon2id",
        "kdf_version": 19,
        "kdf_memory_kib": 65536,
        "kdf_iterations": 3,
        "kdf_parallelism": 4,
        "kdf_hash_len": 32,
        "kdf_salt": secrets.token_bytes(16),
    }
    await expect_violation(db_session, **{**base, "kdf_version": 16})
    await expect_violation(db_session, **{**base, "kdf_hash_len": 64})
    await expect_violation(db_session, **{**base, "kdf_iterations": 0})
    await expect_violation(db_session, **{**base, "kdf_salt": secrets.token_bytes(8)})


async def test_one_envelope_per_snapshot_type_and_device(db_session: AsyncSession) -> None:
    snapshot_id = await seed_snapshot(db_session)
    await db_session.execute(INSERT_ENVELOPE, envelope_values(snapshot_id))
    await db_session.commit()
    with pytest.raises(IntegrityError):
        await db_session.execute(INSERT_ENVELOPE, envelope_values(snapshot_id))
        await db_session.commit()
    await db_session.rollback()


async def test_two_master_envelopes_in_one_snapshot_are_rejected(db_session: AsyncSession) -> None:
    snapshot_id = await seed_snapshot(db_session)
    master = envelope_values(
        snapshot_id,
        type="master",
        device_id=None,
        device_key_version=None,
        kdf_algorithm="argon2id",
        kdf_version=19,
        kdf_memory_kib=65536,
        kdf_iterations=3,
        kdf_parallelism=4,
        kdf_hash_len=32,
        kdf_salt=secrets.token_bytes(16),
    )
    await db_session.execute(INSERT_ENVELOPE, master)
    await db_session.commit()
    with pytest.raises(IntegrityError):
        await db_session.execute(INSERT_ENVELOPE, {**master, "id": uuid.uuid4()})
        await db_session.commit()
    await db_session.rollback()


async def test_snapshot_revision_must_be_positive(db_session: AsyncSession) -> None:
    snapshot_id = await seed_snapshot(db_session)
    with pytest.raises(IntegrityError):
        await db_session.execute(
            text("UPDATE vault_snapshots SET revision = 0 WHERE id = :id"), {"id": snapshot_id}
        )
        await db_session.commit()
    await db_session.rollback()


async def test_committed_snapshot_needs_a_commit_timestamp(db_session: AsyncSession) -> None:
    snapshot_id = await seed_snapshot(db_session)
    with pytest.raises(IntegrityError):
        await db_session.execute(
            text("UPDATE vault_snapshots SET status = 'committed' WHERE id = :id"),
            {"id": snapshot_id},
        )
        await db_session.commit()
    await db_session.rollback()


async def test_credential_must_require_user_verification(db_session: AsyncSession) -> None:
    snapshot_id = await seed_snapshot(db_session)
    vault_id = await db_session.scalar(
        text("SELECT vault_id FROM vault_snapshots WHERE id = :id"), {"id": snapshot_id}
    )
    device_pk = uuid.uuid4()
    await db_session.execute(
        text(
            "INSERT INTO devices (id, vault_id, device_id, label) VALUES (:id, :vault_id, 'dev_1', 'x')"
        ),
        {"id": device_pk, "vault_id": vault_id},
    )
    await db_session.commit()
    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                "INSERT INTO webauthn_credentials (id, device_pk, credential_id, rp_id, mechanism, "
                "user_verification_required, prf_supported, large_blob_supported) VALUES "
                "(gen_random_uuid(), :device_pk, :credential_id, 'pass.example.local', 'prf', "
                "false, true, false)"
            ),
            {"device_pk": device_pk, "credential_id": secrets.token_bytes(16)},
        )
        await db_session.commit()
    await db_session.rollback()
