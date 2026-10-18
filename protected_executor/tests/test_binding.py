"""Bounded metadata/host checks only; no vault, credential or paid endpoint."""

from __future__ import annotations

import json
import math
import time
from dataclasses import asdict, replace

import pytest

from protected_executor.capability import SYNTHETIC_SECRET, SyntheticHostCapability
from protected_executor.contracts import (
    MAX_GRANT_TTL_SECONDS,
    ProtectedGrant,
    Rejected,
    validate_grant,
    validate_request,
)
from protected_executor.core import ExecutorCore, ProviderReply
from protected_executor.tests.test_core import LocalDummyGate, grant, request


def rehash(req):
    return replace(req, binding=replace(req.binding, request_hash=req.content_hash()))


@pytest.mark.parametrize(
    "changes",
    [
        {"consumer_id": "other"},
        {"origin_ref": "other"},
        {"principal_ref": "other"},
        {"request_hash": "b" * 64},
        {"grant_version": 2},
        {"attempt_id": "other"},
        {"target_id": "another-target"},
        {"operation": "raw_secret"},
    ],
)
def test_exact_grant_request_binding_denies_changes_before_transport(changes):
    calls = []
    host = SyntheticHostCapability.for_test(replace(grant(), **changes))
    with pytest.raises(Rejected):
        ExecutorCore(
            transport=lambda _: calls.append(1), gate=LocalDummyGate(), host=host
        ).execute(request())
    assert not calls


@pytest.mark.parametrize("field", ["origin_ref", "principal_ref", "grant_version"])
def test_missing_configured_binding_never_falls_back_to_caller_claims(field):
    req = rehash(replace(request(), **{field: None}))
    with pytest.raises(Rejected):
        validate_request(req)


@pytest.mark.parametrize(
    "field", ["origin_ref", "principal_ref", "grant_version", "target_id", "operation"]
)
def test_content_hash_covers_exact_use_scope_and_version(field):
    value = 2 if field == "grant_version" else "other"
    assert (
        replace(request(), **{field: value}).content_hash() != request().content_hash()
    )


@pytest.mark.parametrize("value", [True, False, 0, -1, 1.0, "1", None, 2**31])
def test_version_strict_integer_in_request_and_grant(value):
    with pytest.raises(Rejected):
        validate_request(rehash(replace(request(), grant_version=value)))
    with pytest.raises(Rejected):
        validate_grant(request(), replace(grant(), grant_version=value), time.time())


@pytest.mark.parametrize(
    "value", [True, False, "1000", None, math.nan, math.inf, -math.inf, -1, 10**400]
)
@pytest.mark.parametrize("field", ["issued_at", "expires_at"])
def test_nonfinite_bool_or_other_timestamp_types_rejected_before_comparison(
    field, value
):
    with pytest.raises(Rejected, match="invalid_grant_time"):
        validate_grant(request(), replace(grant(), **{field: value}), time.time())


@pytest.mark.parametrize("value", [True, "1", None, math.nan, math.inf, 10**400])
def test_unknown_clock_cannot_authorize_a_grant(value):
    with pytest.raises(Rejected, match="invalid_grant_time"):
        validate_grant(request(), grant(), value)


def test_expiry_future_issue_lifetime_cap_and_lifecycle_fail_closed():
    now = time.time()
    base = grant()
    for changes in [
        {"expires_at": now - 1},
        {"issued_at": now + 1},
        {"expires_at": base.issued_at + MAX_GRANT_TTL_SECONDS + 1},
        {"lifecycle": "revoked"},
        {"lifecycle": "expired"},
        {"lifecycle": True},
        {"lifecycle": "approved_by_caller"},
        {"consent_ref": ""},
        {"schema_version": "future"},
    ]:
        with pytest.raises(Rejected):
            validate_grant(request(), replace(base, **changes), now)


@pytest.mark.parametrize(
    "host", [None, True, False, {}, {"trusted": True, "os_isolated": True}, object()]
)
def test_dto_boolean_or_missing_host_never_invokes_lookup_or_transport(host):
    calls = []

    def forbidden(*_):
        calls.append(1)
        raise AssertionError("must not run")

    with pytest.raises(Rejected, match="protected_host_unavailable"):
        ExecutorCore(forbidden, forbidden, LocalDummyGate(), host=host).execute(
            request()
        )
    assert not calls


def test_even_known_test_capability_cannot_enable_arbitrary_material_callback():
    calls = []
    with pytest.raises(Rejected, match="protected_host_unavailable"):
        ExecutorCore(
            lambda _: calls.append(1),
            lambda _: calls.append(1),
            LocalDummyGate(),
            host=SyntheticHostCapability.for_test(grant()),
        ).execute(request())
    assert not calls
    with pytest.raises(TypeError):
        ProtectedGrant(
            **{**asdict(grant()), "secret": "not-an-accepted-material-input"}
        )
    with pytest.raises(Rejected):
        SyntheticHostCapability(grant())


@pytest.mark.parametrize(
    "changes",
    [
        {"consumer_id": "other"},
        {"origin_ref": "other"},
        {"principal_ref": "other"},
        {"request_hash": "b" * 64},
        {"grant_version": 2},
        {"lifecycle": "revoked"},
        {"expires_at": math.nan},
        {"issued_at": True},
        {"expires_at": 0},
    ],
)
def test_every_required_binding_and_lifetime_is_checked_again_inside_dispatch(changes):
    host = SyntheticHostCapability.for_test(grant())
    calls = []

    class ChangeAtDispatch:
        def dispatch(self, req, send):
            host.replace_metadata_for_test(replace(grant(), **changes))
            return send()

    with pytest.raises(Rejected, match="dispatch_outcome_unverified"):
        ExecutorCore(
            transport=lambda _: calls.append(1), gate=ChangeAtDispatch(), host=host
        ).execute(request())
    assert not calls


def test_send_uses_current_time_not_pre_dispatch_time(monkeypatch):
    host = SyntheticHostCapability.for_test(
        replace(grant(), issued_at=1000, expires_at=1060)
    )
    monkeypatch.setattr("protected_executor.core.time.time", lambda: 1001)
    calls = []

    class ExpireAtDispatch:
        def dispatch(self, req, send):
            monkeypatch.setattr("protected_executor.core.time.time", lambda: 1060)
            return send()

    with pytest.raises(Rejected, match="dispatch_outcome_unverified"):
        ExecutorCore(
            transport=lambda _: calls.append(1), gate=ExpireAtDispatch(), host=host
        ).execute(request())
    assert not calls


def test_duplicate_gate_callback_cannot_send_twice():
    calls = []

    class Twice:
        def dispatch(self, req, send):
            send()
            send()

    def transport(material):
        assert material == SYNTHETIC_SECRET
        calls.append(1)
        return ProviderReply(200, b'{"remaining":3,"window":"day"}')

    with pytest.raises(Rejected, match="dispatch_outcome_unverified"):
        ExecutorCore(
            transport=transport,
            gate=Twice(),
            host=SyntheticHostCapability.for_test(grant()),
        ).execute(request())
    assert calls == [1]


def test_public_metadata_has_no_material_and_positive_result_is_explicitly_test_only():
    record = asdict(grant())
    assert not {"secret", "material", "access_token"}.intersection(record)
    assert SYNTHETIC_SECRET not in repr(grant())
    host = SyntheticHostCapability.for_test(grant())
    value = ExecutorCore(
        transport=lambda _: ProviderReply(200, b'{"remaining":3,"window":"day"}'),
        gate=LocalDummyGate(),
        host=host,
    ).execute(request())
    assert value["execution_scope"] == "synthetic_test_only"
    assert (
        not value["production_host_available"]
        and not value["project_completion_verified"]
    )
    assert SYNTHETIC_SECRET not in json.dumps(value)
