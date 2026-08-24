# Adversarial review reproductions — broker / agent access + Tauri↔PWA↔Backend

Throwaway reproductions for the trust-boundary review of §4 (Broker / Agent
Access) and §8 (Tauri ↔ PWA ↔ Backend). **Not** product tests. Nothing here is
wired into `npm test` or `pytest`; delete the directory once the findings are
either fixed with real tests in the proper suites or explicitly accepted.

Where the real tests belong once a finding is fixed:

| Finding | Real test home |
|---|---|
| Policy: substring provider match, TTL bound, default capabilities | `packages/core/test/access-policy.test.ts` |
| Grant material is the stored secret | `frontend/src/lib/access.test.ts` |
| Relay origin/token/queue behaviour | `backend/tests/test_access_broker.py`, `packages/broker/test/relay.test.mjs` |
| BroadcastChannel transport | `frontend/src/lib/access.test.ts` + a Playwright two-context test |
| Sidecar authentication, Tauri path handling | `src-tauri/src/*.rs` unit tests |

## Run

```sh
node --experimental-strip-types --test review-proofs/policy-proofs.test.mjs
node --test review-proofs/relay-proofs.test.mjs
node --experimental-strip-types --test review-proofs/handoff-proofs.test.ts
node --test review-proofs/channel-proofs.test.mjs
python3 review-proofs/sidecar_hijack.py
rustc -O -o /tmp/pathjoin review-proofs/pathjoin/main.rs && /tmp/pathjoin
```

`sidecar_hijack.py` binds `127.0.0.1:8788`. Stop `npm run app` first.
