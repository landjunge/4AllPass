# AP284 correction evidence — 12 November 2026

Scope: PR284, existing worktree `team-p0-20261112`, branch
`feat/family-design-ap-20261112`, starting commit
`e937de5057eb17fdf44fc02dda7662b65dbce79a`. Existing dirty shared-module
updates and the partial Rust receipt fix were preserved and completed.

## Implemented

- `family_switch` is async. Process spawn, polling and receipt reads run on
  Tauri's blocking pool. One 30-second deadline covers process exit and stdout
  EOF; stdout is capped at 64 KiB and stderr is discarded. Only the spawned
  child is signalled on timeout; reaping stays off the response path.
- A process-wide gate serializes switches. Timeout, malformed/oversized output,
  read/wait failures and explicit unknown outcomes block further switches for
  this process. Late stdout cannot clear that state. This is not durable
  cross-process reconciliation or proof that killing the child undoes effects.
- Success requires exit zero, actual JSON boolean `true`, matching
  `active_product`, integer `visible_family_windows: 1`, finite numeric x/y and
  finite positive width/height. Negative desktop origins are valid. An unknown
  outcome flag or non-null `error` contradicts and overrides success. Nonzero
  exit is a known failure only with
  actual boolean `success: false` and `execution_outcome_unknown: false`.
- Lost IPC responses map to `uncertain`; an adapter-level latch also blocks
  redispatch after the shared renderer is destroyed and mounted again. This
  latch lasts for the webview module lifetime; the native unknown-outcome gate
  lasts for the app process. Neither is durable across an app restart.
- Local stable `LOCKED`/`UNLOCKED` observations use the shared `confirmed`
  vocabulary; transitions use `unknown`. The existing `readSelf` contract does
  not carry scoped vault proof: vault metadata stays unknown, no unlock pulse
  is asserted, and the actual vault UI retains the lock state.
- Shared module 1.2.2: all 13 files plus the SHA manifest were checked byte for
  byte against the supplied ThreadDesk static directory. Manifest SHA-256:
  `689bf4c25bdcff41c095791c6f63128b46dc69785adef52b6ffc8c78fd82081e`.
  Original icons and shared 44px targets/32px artwork were preserved.

ACL/main-window grant, vault operations, panic, secret handling and sessions
were not changed. DeepSeek session `ses_e329aa8ecffeLV72oacGFHcyya` was neither
resumed nor modified. No productive app start, installation or release.

## Verification checkpoint

- Frontend typecheck: passed.
- Host observations through the actual pinned normalizer: passed.
- Normal frontend tests: 330 passed, zero failed/skipped.
- The subsequent adapter-only remount latch was checked with the host test,
  typecheck and browser regression; unchanged Rust selections were not repeated.
- `node scripts/test-family-header.mjs`: passed in headless installed Chrome;
  real AP wrapper and shared renderer, stable/transition self states, no false
  vault pulse, 44px targets/32px artwork, known completions permitting the next
  explicit switch, lost-IPC retry block across header remount, DE/EN, cleanup.
- `cargo test --locked --lib family_switch::tests -- --nocapture`: 7 passed;
  strict negative receipts, actual process exit, timeout/runtime responsiveness,
  oversized stdout, inherited stdout pipe and unknown/inflight retry block.
  The first attempt failed at the build prerequisite (missing packaged sidecar),
  then only this targeted selection was rerun after packaging completed.
- Main/prompt own-command permission contract: passed (1 targeted Rust test).
- Frontend lint: passed with existing warnings outside these changes; module
  boundaries, original-icon check and source license check: passed.
- Frontend build, extension build, `npm run sidecar`, and third-party notice
  collection: passed. Python packaging dependencies are local to this worktree's
  `backend/.venv`; no global dependency installation.
- Native Intel `.app` packaging follows this source checkpoint, using
  `npm run tauri -- build --bundles app -- --locked`. Candidate path:
  `src-tauri/target/release/bundle/macos/4AllPass.app`. Subsequent source/signature
  evidence is kept with local artifacts at `dist/ap284-intel/verification.json`;
  this checkpoint does not claim that not-yet-built candidate passed.
- Independent parent review accepted the implementation and the narrow parser
  correction. CI and final candidate receipts are recorded for the resulting
  committed head in the local artifact evidence above.

## Parent review follow-up

The parent requested rejection of non-null errors on an otherwise valid success
receipt. The narrow Rust parser regression passed locally:
`cargo test --locked --lib family_switch::tests::rejects_success_with_non_null_error -- --exact --nocapture`
(1 passed, 0 failed). It covers object/string/boolean/number/array errors,
and confirms that absent/null errors still allow otherwise valid success.
The parent independently read the three-file correction and accepted the fix
and real parser test. The broader `e937` to `b303` review found no further P1/P2.
The operator then authorized committing/pushing this accepted delta to PR284
and one final Intel app build from the clean final commit. No further review
permission is required for that scoped work. Its exact commit, CI, embedded
source and signature receipts are retained with the local candidate evidence.
The earlier completed app build is preserved at
`dist/ap284-intel/previous-416bfe3.app`, with an explicit previous/intermediate
receipt at `dist/ap284-intel/previous-416bfe3.json`. It is not the final source
candidate. No build was interrupted and no unreviewed final rebuild was started.

Open UI requirement: the current AP self projection is `confirmed` without a
vault pulse. This honestly avoids asserting a false unlock, but final user-facing
vault-state presentation remains open. No canonical shared-module fork or
unapproved vault-proof contract was introduced.

## ThreadDesk synchronization history and current uncertainty

Destination remains AP board `7dd7ab68ab80`, not the Big Plan. On resumption,
the API index and entry read independently confirmed latest entry
`9f2c411baad2`, ordinal 33, following historical `439d0f1753d6` / 32.
One progress append was then attempted with that observed predecessor and stable
external key `ap284-native-corrections-20261112-v1`. It returned empty text,
`isError: true`, `structuredContent: {"error_code":"INVALID_ARGUMENT"}`.
The subsequent independent board read returned the same empty error envelope.
The write outcome is unknown, not saved/failed by assumption. Never repeat this
append blindly; reconcile by this external key when transport permits.

Read attempt through `mcp__kirabridge__whiteboard_read` returned exactly:

```text
MCP tool `kirabridge/whiteboard_read` is not available to the model
```

The connected Apps read then returned `peer_disconnected`, operation
`mcp.connect`, phase `connection.closed`, diagnostic
`b2b18175a9f64dc1bdfc5ca264fb87da`, connection
`ac65fc52cd004b0d80107d57639a6150`, task ID null. Accepted/started/completed and
execution runtime were all `unknown`; automatic retry was `false`.
Those initial transport failures preceded the successful resumption reads and
the single uncertain append above. No write retry, connection/config change,
or direct store access was performed. This file is a technical evidence
checkpoint, not a plan copy.
