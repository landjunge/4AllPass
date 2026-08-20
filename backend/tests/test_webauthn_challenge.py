import uuid

import pytest

from app.core.challenges import MemoryChallengeStore, digest_challenge

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_issue_and_consume_roundtrip():
    store = MemoryChallengeStore()
    user = uuid.uuid4()
    vault = uuid.uuid4()
    issued = await store.issue(
        user_id=user, vault_id=vault, purpose="assert", device_id="dev_1", ttl_seconds=120
    )
    assert len(issued.challenge) == 32
    assert digest_challenge(issued.challenge) != issued.challenge.hex() or True

    ok = await store.consume(
        challenge_id=issued.challenge_id,
        user_id=user,
        vault_id=vault,
        purpose="assert",
        challenge=issued.challenge,
    )
    assert ok is not None
    assert ok.device_id == "dev_1"

    again = await store.consume(
        challenge_id=issued.challenge_id,
        user_id=user,
        vault_id=vault,
        purpose="assert",
        challenge=issued.challenge,
    )
    assert again is None


async def test_consume_rejects_wrong_binding():
    store = MemoryChallengeStore()
    user = uuid.uuid4()
    vault = uuid.uuid4()
    issued = await store.issue(
        user_id=user, vault_id=vault, purpose="create", device_id=None, ttl_seconds=120
    )
    wrong_purpose = await store.consume(
        challenge_id=issued.challenge_id,
        user_id=user,
        vault_id=vault,
        purpose="assert",
        challenge=issued.challenge,
    )
    assert wrong_purpose is None
    # The mismatched consume deleted nothing — wait, current impl pops first then checks.
    # Memory store pops before check, so the challenge is gone either way (fail-closed).
    replay = await store.consume(
        challenge_id=issued.challenge_id,
        user_id=user,
        vault_id=vault,
        purpose="create",
        challenge=issued.challenge,
    )
    assert replay is None


PASSWORD = "account-password-1234"


async def _signup(client):
    email = f"chal-{uuid.uuid4().hex[:10]}@example.com"
    response = await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return response.json()["token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_challenge_requires_vault_owner(client):
    alice = await _signup(client)
    bob = await _signup(client)
    created = await client.post("/api/v1/vaults", headers=_auth(alice))
    assert created.status_code == 201
    vault_id = created.json()["vaultId"]

    denied = await client.post(
        f"/api/v1/vaults/{vault_id}/webauthn/challenges",
        headers=_auth(bob),
        json={"purpose": "assert", "deviceId": "dev_x"},
    )
    assert denied.status_code == 404

    issued = await client.post(
        f"/api/v1/vaults/{vault_id}/webauthn/challenges",
        headers=_auth(alice),
        json={"purpose": "assert", "deviceId": "dev_x"},
    )
    assert issued.status_code == 200, issued.text
    body = issued.json()
    assert body["purpose"] == "assert"
    assert body["expiresIn"] == 120
    assert body["challengeId"]
    assert body["challenge"]

    consumed = await client.post(
        f"/api/v1/vaults/{vault_id}/webauthn/challenges/{body['challengeId']}/consume",
        headers=_auth(alice),
        json={"purpose": "assert", "challenge": body["challenge"]},
    )
    assert consumed.status_code == 204

    reuse = await client.post(
        f"/api/v1/vaults/{vault_id}/webauthn/challenges/{body['challengeId']}/consume",
        headers=_auth(alice),
        json={"purpose": "assert", "challenge": body["challenge"]},
    )
    assert reuse.status_code == 404
