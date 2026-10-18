# FP protected-binding core – actual scoped result

18 October 2026. Separate authorized follow-up to PR222/223, based on
`fd5473203abc8fdc3fab4fff2e2331882d5f2dde`. Original source/PRs and canonical
foreign worktree remain unchanged. New branch/worktree:
`feat/seven-tools-protected-binding-20261018` /
`.worktrees/seven-tools-protected-binding-20261018`.

## Concrete cause / konkrete Ursache

The prototype Grant bound project/workflow/task/actor/target but omitted consumer,
configured origin/principal, exact request hash and grant version/consent/lifecycle.
An arbitrary lookup callback could supply material; there was no implemented
ProtectedHost/OS-secret boundary. Its bare expiry comparison also let a NaN expiry
remain unexpired. Normal public machine routes were already denied by PR222;
these gaps affected the unconnected experimental core, not a live vault route.

## Implemented correction / umgesetzte Korrektur

- Metadata-only versioned ProtectedGrant/UseRequest include all required separate
  binding/version/hash/lifecycle/consent fields. No public DTO material/secret.
- Normal calls without a supported host fail `protected_host_unavailable` before
  any lookup. Boolean/dict/duck typing and old material callbacks do not enable
  execution. No production host capability is implemented or issued.
- Explicit test-only SyntheticHostCapability supplies one fixed public dummy
  value, no vault/material/environment/file input. Its nominal Python seal is
  deliberately not called a SameUID/OS or authenticated-identity boundary.
- Strict version and finite time/type checks precede expiry comparisons. Binding,
  requesthash, version, lifecycle, current time and unchanged grant are checked
  again inside actual TollGate dispatch. Duplicate callback invokes no second send.
- The same existing TollGate persistent workflow reservation/dispatch/stop and
  unknown/no-replay state remain in use. No additional queue, grant ledger,
  consent authority, key store, protocol driver or production transfer is created.
- DE/EN contract in `protected_executor/README.md`, source boundary and existing
  ADR/claims updated. Existing CI protected-core line includes the new binding
  tests; no new jobs or build/release workflow was added.

## Actual targeted checks / tatsächlich geprüft

- Existing affected core + actual compatible TollGate adapter: **20 passed**
  in 0.86s, including real loopback dummy GET, restart/no duplicate send,
  durable stop and unknown outcome retained without transport exception leak.
  Updated synthetic grant metadata is explicitly rebound for a new attempt;
  no old consent hash silently reused.
- New binding/host-negative suite: **68 passed** in 0.11s. Consumer/origin/principal,
  exact target/operation/hash/attempt/version mismatch; missing bindings; strict
  bool/float/string/version limits; NaN/±inf/oversized/non-numeric time values;
  future/expired/excessive TTL and revoked/expired/invalid lifecycle; missing or
  caller-forged host; arbitrary material callback refused; actual-dispatch
  revalidation, expiry during gate wait and duplicate callback only once.
- Positive outcome explicitly reports `synthetic_test_only`, production host
  unavailable and project acceptance false. Public metadata has no material
  fields; output/exception/representation checks use only a known public dummy.
- Ruff/format on changed contract/core/negative tests passed. Bandit on changed
  non-test core has no findings; the fixed public synthetic value is explicitly
  marked as a noncredential fixture. `git diff --check` passed.
- No broad unchanged Node/frontend/backend/crypto suite, new browser proof or
  desktop build was run. PR222/223 green existing CI and screenshots remain
  their own historical scope, not fresh acceptance for this slice. New binding
  CI runs when the new PR is created.
- Actual compatible TollGate pin/module hash and tested source file fingerprints
  in `test-summary.json`. Hashes locate content, not identity/authority.

## Preserved / erhalten

`git diff fd54732 -- frontend backend packages src-tauri brand LICENSE` is empty.
Human vault, import/autofill/recovery, ciphertext, cryptography, API/UI, current
LICENSE and approved AP4 originals unchanged. Original AP4 hashes remain
`e34a5925bee7a35434145646c8fca497edc26eef015b3e88a40411e006bbb094`
and `d253dfba15a8eea31c958debf5b3b1fdb068c96dd8e7a77192681e3e655866b4`.
No download, old release/tag/signature/hash, version, runtime, credential or
personal vault mutation. No account/sudo/provider action or external service.

## Open prerequisites / echte offene Voraussetzungen

FP-C02/FP-C03 remain **productively open**. Production still requires a genuinely
agent-inaccessible OS/file/shell/debug/descendant secret boundary, trusted vault
transfer, configured authenticated host/consent origin/principal source, and its
existing durable monotonic grant-version/revocation history. No such source
exists here; no new secondary authorization store fabricates it. Missing
production host always denies; matching DTO fields/hash never prove one.
Browser/DOM/cookie/session protection is still not implemented. No claim that a
SameUID unrestricted shell can be isolated by Python wrappers or mode0600.

The synthetic helper intentionally preserves only one current metadata fixture;
it is not a live grant issuance/revocation service or persistent history. A future
host must supply trustworthy current version/lifecycle before connecting real
material; it must not infer consent from an agent-provided status boolean.

## Integration and rollback

Depends on PR222 then PR223. Coordinator owns their review, rebasing/integration
and skill-conditioned merge. This worker opens only the dependent follow-up PR,
never merges/deploys. Revert only this follow-up commit to restore the earlier
unconnected prototype (not recommended as a security posture); no migration or
user-data cleanup needed. No historical evidence overwritten.
