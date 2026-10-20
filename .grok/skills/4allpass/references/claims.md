# Claims vs reality

Over-claims are defects. `docs/security-boundary.md` is what the running
software enforces. Do not make README, overlay, or ROADMAP stronger than that.

## Access / agents

- Changed source denies machine credential handoffs, including raw_secret and
  old Allow responses. No protected production executor is connected.
- Historical v0.1.2-rc.2 downloads returned actual material as access_token. They
  are not silently updated or relabeled by this source change.
- Pairing token and application strings are not authenticated model identity.
- TTL never recalls previous credential copies or provider sessions.
- A metadata-only grant or caller trust flag is not a host. Normal protected-core
  calls without a production host fail before lookup; only fixed-secret synthetic
  fixtures can run tests. No real host/secret transfer is implemented.
- The synthetic API core/TollGate tests do not prove OS isolation, protected
  browser login, third-party audit or a deployed product integration.
- The package startup guard now requires actual machine-handoff denials plus
  token/origin negatives from the candidate. Old health-only evidence cannot
  satisfy its new marker. Adding this guard or passing its local handler tests
  does not build/release a candidate or update historical downloads.

## Desktop / Tauri

| Easy to write | What is true |
|---|---|
| Webview navigates to `http://127.0.0.1:8788` with Tauri IPC | UI is bundled `frontendDist`. Sidecar `:8788` is API-only. Remote localhost has **no** Tauri IPC. Occupied 8788 before spawn refuses. After spawn, a listener that is not our child (or a descendant) is the same refuse. TCP connect is not trust. |
| All app windows may invoke import/sidecar | Own commands use AppManifest: main has eight; access-prompt only access_decide; other local windows deny. This is not unlock/device/OS isolation or package approval. See docs/desktop-command-boundary.md. |
| Hide to tray locks the vault | It does not. Only the Lock button does. Sleep / App Nap / Chrome in front do not. |
| PRF / Touch ID unlock in the desktop webview | Unproven. Master password and recovery kit are the supported paths. |
| Account compromise never decrypts the vault | Only if account password ≠ vault password. Login still sends the account password. Hosted PWA: the code host can read the vault password. Bundled desktop is the active-server claim. |
| Extension unlocks with vault password only | Only when this Mac has no e-mail account. If `hasOtherAccounts`, same e-mail + account password as the app. Empty fields must not POST `/auth/local`. |

## Revoke / WebAuthn

| Easy to write | What is true |
|---|---|
| `DELETE /devices` erases the key | `revocation: "metadata_only"`. Hard revoke = client `hardRevokeDevice` (VK++). |
| Server verified the passkey / PRF | `cose_verified` is ceremony integrity (`fmt=none`). Server never sees PRF. |

## Account registration

New central account passwords:15–256 code points and a pinned offline whole-value
blocklist; safe fixed errors in DE/EN. Existing account login/local bootstrap and
vault passwords are unchanged. No runtime third-party lookup, composition rule,
periodic reset or general NIST-conformity claim. See docs/account-password-policy.md.

## HTTP / ownership

Foreign vault or device id → **404**, never 403.

## Local persistence

The PWA commits its freshness pin only after entry integrity, plaintext decoding
and sorting succeed. Failed content opens leave the old pin intact. This does
not authenticate manifestless legacy revision numbers or add atomic cross-tab
pin updates.

IndexedDB request success is not transaction completion. Snapshot-cache and
device-record operations wait for completion and reject aborts/errors. This
does not guarantee storage against eviction, disk loss or power failure;
online snapshot-cache writes remain best-effort. It adds no device-possession
proof and does not change the existing unlock mechanism's security rank.

## User-facing copy

Prefer “Zugriffe müssen lokal bestätigt werden” over “zeitlich begrenzte Freigaben” unless the TTL limit is also stated honestly.

## Optional connection status

The frontend broker helper waits for an accepted poll before reporting live,
rejects failed/malformed responses and suppresses stopped-session deliveries.
This only describes last observed transport availability. It provides no fresh
suite-peer or user/vault-bound unlock proof and must not drive the shared
connection ring or pulse. The current blocked machine-access page stays blocked.

## Device assertion selectors

Explicit challenge/consume device selectors must match the signed credential's
stored device; mismatch returns 404 before usage stamps. An unbound legacy or
unsigned hygiene 204 is still no AP04 team-device admission, current person
binding, hardware/PRF proof or authorization for sensitive team operations.
