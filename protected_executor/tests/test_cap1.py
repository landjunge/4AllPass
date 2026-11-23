"""Synthetic CAP-1 tests with ephemeral Ed25519 keys and a temporary nonce store."""

import json
import sqlite3
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from dataclasses import replace
from threading import Barrier

import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from protected_executor.cap1 import (
    CapabilityClaims,
    LocalCapabilityVerifier,
    SignedCapability,
)
from protected_executor.capability import SyntheticHostCapability
from protected_executor.contracts import Rejected
from protected_executor.core import ExecutorCore, ProviderReply
from protected_executor.tests.test_core import LocalDummyGate, grant, request

AUDIENCE = "tollgate-test"
NONCE = "ab" * 16


class TestNonceStore:
    __test__ = False

    def __init__(self, path):
        self.path = path
        with closing(sqlite3.connect(path)) as db, db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS consumed (digest TEXT PRIMARY KEY, expiry INTEGER)"
            )

    def consume(self, digest, expiry):
        with closing(sqlite3.connect(self.path)) as db, db:
            result = db.execute(
                "INSERT INTO consumed VALUES (?, ?) ON CONFLICT(digest) DO NOTHING",
                (digest, expiry),
            )
            return result.rowcount == 1


def evidence(private_key, use, **changes):
    now = int(time.time())
    claims = replace(
        CapabilityClaims(
            "test-cap",
            use.grant_ref,
            use.principal_ref,
            use.binding.request_hash,
            AUDIENCE,
            NONCE,
            now - 1,
            now + 30,
        ),
        **changes,
    )
    return SignedCapability(claims, private_key.sign(claims.signing_bytes()))


def verifier(public_key, consume):
    def verify(message, signature):
        try:
            public_key.verify(signature, message)
        except InvalidSignature:
            return False
        return True

    return LocalCapabilityVerifier(AUDIENCE, "synthetic-issuer", verify, consume)


def execution(verify, metadata=None, gate=None):
    effects = []

    def transport(_):
        effects.append("send")
        return ProviderReply(200, b'{"remaining":7,"window":"day"}')

    class CountGate:
        def dispatch(self, use, send):
            effects.append("dispatch")
            return (gate or LocalDummyGate()).dispatch(use, send)

    executor = ExecutorCore(
        transport=transport,
        gate=CountGate(),
        host=SyntheticHostCapability.for_test(metadata or grant()),
        capability_verifier=verify,
    )
    return executor, effects


@pytest.fixture
def signed_fixture(tmp_path):
    private_key = Ed25519PrivateKey.generate()
    store = TestNonceStore(tmp_path / "nonces.sqlite3")
    use = request()
    return private_key, store, use


@pytest.mark.parametrize(
    ("changes", "reason"),
    [
        ({"aud": None}, "capability_audience_mismatch"),
        ({"aud": 3}, "capability_audience_mismatch"),
        ({"aud": "TollGate-test"}, "capability_audience_mismatch"),
        ({"aud": AUDIENCE + " "}, "capability_audience_mismatch"),
        ({"grant_ref": "another-grant"}, "capability_binding_mismatch"),
        ({"principal": "another-principal"}, "capability_binding_mismatch"),
        ({"request_hash": "b" * 64}, "capability_binding_mismatch"),
        ({"nonce": "wrong"}, "invalid_capability_nonce"),
        ({"iat": True}, "invalid_capability_time"),
        ({"iat": 1, "expires_at": 61}, "capability_time_unavailable"),
    ],
)
def test_signed_invalid_claims_denied_before_dispatch_and_nonce_claim(
    signed_fixture, changes, reason
):
    private_key, store, use = signed_fixture
    executor, effects = execution(verifier(private_key.public_key(), store.consume))
    with pytest.raises(Rejected, match=f"^{reason}$"):
        executor.execute(use, proof=evidence(private_key, use, **changes))
    assert effects == []
    assert (
        executor.execute(use, proof=evidence(private_key, use))["result"]["remaining"]
        == 7
    )
    assert effects == ["dispatch", "send"]


def test_signature_from_other_key_and_tampered_claims_do_not_consume_nonce(
    signed_fixture, capsys
):
    private_key, store, use = signed_fixture
    executor, effects = execution(verifier(private_key.public_key(), store.consume))
    proof = evidence(private_key, use)
    tampered = replace(proof, claims=replace(proof.claims, capability_id="other-cap"))
    foreign = evidence(Ed25519PrivateKey.generate(), use)
    for invalid in (tampered, foreign):
        with pytest.raises(Rejected, match="^capability_signature_invalid$"):
            executor.execute(use, proof=invalid)
    assert not effects
    result = executor.execute(use, proof=proof)
    assert result["execution_scope"] == "synthetic_test_only"
    assert result["production_host_available"] is False
    diagnostics = json.dumps(result) + repr(proof) + repr(proof.claims)
    captured = capsys.readouterr()
    diagnostics += captured.out + captured.err
    for value in (NONCE, use.binding.request_hash, proof.signature.hex()):
        assert value not in diagnostics
        assert value.encode() not in store.path.read_bytes()
    assert effects == ["dispatch", "send"]


def test_missing_proof_and_unavailable_verifier_or_store_are_not_fallbacks(
    signed_fixture,
):
    private_key, store, use = signed_fixture
    proof = evidence(private_key, use)
    executor, effects = execution(verifier(private_key.public_key(), store.consume))
    with pytest.raises(Rejected, match="^capability_required$"):
        executor.execute(use)
    assert not effects
    executor, effects = execution(None)
    with pytest.raises(Rejected, match="^capability_verifier_unavailable$"):
        executor.execute(use, proof=proof)
    assert not effects

    def inaccessible(*_):
        raise OSError("PRIVATE_TEST_PATH")

    executor, effects = execution(verifier(private_key.public_key(), inaccessible))
    with pytest.raises(Rejected, match="^capability_nonce_store_unavailable$") as error:
        executor.execute(use, proof=proof)
    assert error.value.__suppress_context__
    assert not effects


@pytest.mark.parametrize("lifecycle", ["revoked", "expired"])
def test_grant_lifecycle_remains_an_independent_check(signed_fixture, lifecycle):
    private_key, store, use = signed_fixture
    verified = verifier(private_key.public_key(), store.consume)
    blocked, effects = execution(verified, replace(grant(), lifecycle=lifecycle))
    proof = evidence(private_key, use)
    with pytest.raises(Rejected, match="^grant_unavailable$"):
        blocked.execute(use, proof=proof)
    assert not effects
    accepted, effects = execution(verified)
    assert accepted.execute(use, proof=proof)["status"] == "delivered_unverified"
    assert effects == ["dispatch", "send"]


def test_signed_expiry_rechecked_at_dispatch(signed_fixture, monkeypatch):
    private_key, store, use = signed_fixture
    proof = evidence(private_key, use)
    metadata = grant()
    now = proof.claims.iat + 1
    monkeypatch.setattr("protected_executor.core.time.time", lambda: now)

    class DelayedGate:
        def dispatch(self, _use, send):
            nonlocal now
            now = proof.claims.expires_at
            return send()

    executor, effects = execution(
        verifier(private_key.public_key(), store.consume), metadata, DelayedGate()
    )
    with pytest.raises(Rejected, match="^dispatch_outcome_unverified$"):
        executor.execute(use, proof=proof)
    assert effects == ["dispatch"]


def test_concurrent_nonce_claim_has_one_dispatch(signed_fixture):
    private_key, store, use = signed_fixture
    proof = evidence(private_key, use)
    start = Barrier(2, timeout=5)

    def consume(digest, expiry):
        start.wait()
        return store.consume(digest, expiry)

    def execute():
        executor, effects = execution(verifier(private_key.public_key(), consume))
        try:
            executor.execute(use, proof=proof)
        except Rejected as error:
            return str(error), effects
        return "accepted", effects

    with ThreadPoolExecutor(max_workers=2) as threads:
        both = [threads.submit(execute) for _ in range(2)]
        assert sorted(future.result(timeout=8) for future in both) == [
            ("accepted", ["dispatch", "send"]),
            ("capability_nonce_used", []),
        ]


def test_nonce_survives_process_restart_with_same_or_new_attempt(tmp_path):
    key = Ed25519PrivateKey.generate()
    path = tmp_path / "restart-nonces.sqlite3"
    use = request()
    original = evidence(key, use)
    new_use = replace(use, binding=replace(use.binding, attempt_id="second-attempt"))
    new_use = replace(
        new_use, binding=replace(new_use.binding, request_hash=new_use.content_hash())
    )
    changed = evidence(key, new_use)

    def process(attempt, proof):
        packet = {
            "key": key.public_key().public_bytes_raw().hex(),
            "proof": vars(proof.claims),
            "signature": proof.signature.hex(),
        }
        run = subprocess.run(
            [
                sys.executable,
                "-B",
                "-m",
                "protected_executor.tests.test_cap1",
                str(path),
                attempt,
            ],
            input=json.dumps(packet),
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        return json.loads(run.stdout)

    assert process(use.binding.attempt_id, original) == [
        "accepted",
        ["dispatch", "send"],
    ]
    assert process(use.binding.attempt_id, original) == ["capability_nonce_used", []]
    assert process(new_use.binding.attempt_id, changed) == ["capability_nonce_used", []]


if __name__ == "__main__":
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    _, database, attempt = sys.argv
    values = json.load(sys.stdin)
    key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(values["key"]))
    signed = SignedCapability(
        CapabilityClaims(**values["proof"]), bytes.fromhex(values["signature"])
    )
    use = request()
    use = replace(use, binding=replace(use.binding, attempt_id=attempt))
    use = replace(use, binding=replace(use.binding, request_hash=use.content_hash()))
    metadata = replace(
        grant(), attempt_id=attempt, request_hash=use.binding.request_hash
    )
    executor, effects = execution(
        verifier(key, TestNonceStore(database).consume), metadata
    )
    try:
        executor.execute(use, proof=signed)
    except Rejected as error:
        print(json.dumps([str(error), effects]))
    else:
        print(json.dumps(["accepted", effects]))
