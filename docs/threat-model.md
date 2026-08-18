# 4AllPass Threat Model (v1)

**Companion to:** `docs/crypto-protocol.md`, `docs/vault-revision.md`, `docs/webauthn-prf.md`  
**Date:** 2026-08-17

---

## 1. Assets

| Asset                    | Sensitivity | Location              |
|--------------------------|-------------|-----------------------|
| Master Password          | Critical    | Client only (ephemeral) |
| Vault Key (VK)           | Critical    | Client (unlocked) + wrapped on server |
| Recovery Key             | Critical    | Offline Emergency Kit |
| Plaintext vault entries  | Critical    | Client only (unlocked) |
| Device Key (DK)          | High        | Client; wrapped under DWK |
| Device Wrapping Key      | High        | Derived from WebAuthn PRF, ephemeral |
| Account credentials      | Medium      | Server (hashed)       |
| Encrypted vault snapshots| Medium      | Server                |

---

## 2. Threat Actors

1. **Full Server Compromise**  
   Attacker obtains a complete database dump (snapshots, envelopes, entries, salts, device metadata).

2. **Malicious / Active Server** *(self-hosting default)*  
   The operator *is* the server. They can serve any historically valid ciphertext, withhold data, reorder snapshots, rewrite metadata, and attempt protocol downgrades. They do **not** have the Master Password, VK, DK, or Recovery Key.

3. **Network Attacker (MITM)**  
   Can observe or modify traffic between client and server (TLS + authenticated encryption).

4. **Malicious / Compromised Client**  
   Malicious browser extension, XSS, or malware while the vault is unlocked.

5. **Lost / Stolen Device**  
   Physical possession of a previously enrolled device.

6. **Insider / Self-hosted Admin**  
   Same powers as (2) plus OS access to the host. Collapses into Malicious Server for vault confidentiality.

7. **Remote Attacker with Account Access**  
   Compromised account password or OAuth token (but no Master Password).

---

## 3. Malicious server — what they can and cannot do

### Can do (availability / integrity-of-history)

| Action | Client detection |
|---|---|
| Refuse reads or writes | User-visible sync error |
| Serve an older authentic snapshot | `evaluateRevision` → `RollbackError` once a newer revision was pinned |
| Serve snapshot `N` envelopes with snapshot `M` entries | Decrypt of some/all entries fails → `IntegrityError`; snapshot refused |
| Flip `vault_key_version` backwards | `downgrade` / `mismatch` |
| Change `deviceId`, envelope `type`, `vault_id`, or crypto version on an existing blob | AES-GCM AAD mismatch → `AuthFailureError` |
| Truncate or flip bits in ciphertext / tag | `AuthFailureError` |
| Drop a device envelope (unauthorized soft revoke) | That device can no longer unlock via DK; Master Password / Recovery still work |
| Add a *new* device envelope | Cannot: they do not have VK, so they cannot wrap a valid envelope under a key they choose |

### Cannot do

- Recover VK, DK, DWK, Master Password, or Recovery Key from stored data alone.
- Forge a new entry or envelope that decrypts under the real VK.
- Turn an account-password / OAuth compromise into vault plaintext.
- Silently roll a client **back** after that client has pinned a newer revision.

Confidentiality under a malicious server therefore reduces to: offline attack on Argon2id (Master Password) or theft of the Emergency Kit / an unlocked client.

### First-use caveat

A **new** client has no pinned revision. The first snapshot it accepts is pin-on-first-use. An active server can choose *which* historical snapshot that new client sees first. After the first successful unlock, further rollback is detected.

---

## 3.1 Account access — what a stolen account or token gets

Actor 7 above ("Remote Attacker with Account Access") is now a concrete boundary
rather than an aspiration; it is implemented in `backend/app/api/deps.py` and
`backend/app/core/security.py`, and described in `backend/README.md`.

An attacker holding a valid access token, or the account password itself, can:

| Action | Result |
|---|---|
| Read device **metadata** for vaults that account owns | Yes: device id, display name, last seen, revocation status, whether a Device-Key Envelope is on file |
| Read another account's vault | No. Ownership is re-checked per request; a vault they do not own is indistinguishable from one that does not exist |
| Read entries, envelopes or key material | No. Those endpoints do not exist yet, and when they do they will return the same ciphertext a malicious server already has (§3) |
| Decrypt anything | **No.** The Vault Key never reaches the server. Account authentication is not an input to any vault key derivation (crypto-protocol.md, Hard Invariant #5) |
| Stay in after the user logs out | No. Logout revokes the refresh-token family and deny-lists the access token's `jti` for its remaining lifetime |
| Keep a stolen refresh token alive by rotating it | Not silently: single-use rotation means the legitimate client's next refresh is detected as reuse, which revokes the whole family and forces both parties to re-authenticate |

So a compromised account collapses into "a malicious server that also knows some
metadata" — which is §3, and §3 does not yield plaintext. The account layer is a
boundary around *availability and metadata*, never around confidentiality of the
vault. That asymmetry is deliberate: it is what lets the server be run by someone
the user does not fully trust.

What it does **not** cover yet: there is no rate limiting on `/auth/login`, so an
online guessing attack against a weak account password is bounded only by
Argon2id's cost per attempt (~35 ms). That is tracked as follow-up work, and it is
an account-availability problem, not a vault-confidentiality one.

---

## 4. Security Goals

- Full server compromise or a malicious operator → only offline dictionary / brute-force against Argon2id (Master Password) or the Recovery Key remain.
- Account compromise alone never grants vault decryption (§3.1).
- A vault is reachable only by the account that owns it, checked per request rather than carried in a token (§3.1).
- Replayed older snapshots are rejected after a newer revision has been pinned.
- Partial / mixed rotations cannot be applied.
- Soft revoke for a device that is not believed compromised; hard rotation if it may already know VK.
- Recovery only with the Recovery Key (or later Shamir shares); never via e-mail or server-side reset.

---

## 5. Residual Risks & Explicit Limitations

| Risk                              | Status in v1                                      | Mitigation / Acceptance |
|-----------------------------------|---------------------------------------------------|-------------------------|
| Offline brute-force on Master PW  | Accepted (fundamental)                            | Strong Argon2id params + user education |
| Memory scraping while unlocked    | Accepted (JS/WASM platform limit)                 | Auto-Lock, short-lived secrets, zeroization best-effort |
| Compromised device already holds VK | Requires hard rotation                            | Atomic snapshot + `vault_key_version` |
| Malicious server first-use snapshot choice | Accepted | Pin-on-first-use; warn on first unlock |
| Malicious server availability     | Accepted | Client keeps last good snapshot locally |
| UV-gated local store (no PRF)     | Weaker than PRF                                   | Documented in `webauthn-prf.md`; Master Password remains |
| Side-channel attacks on Argon2id  | Partially mitigated by parameters                 | Not a primary target for v1 |
| Online guessing of a weak **account** password | Open: no rate limiting on `/auth/login` yet | Bounded by Argon2id cost per attempt; affects account access only, never vault plaintext (§3.1) |
| Stolen JWT signing key            | Accepted: account impersonation                   | Rotating the key logs everyone out; no vault is at risk (§3.1) |
| Quantum attacks on AES            | Out of scope for v1                               | Future protocol version |

---

## 6. Assumptions

- Users choose reasonably strong Master Passwords / passphrases.
- TLS is correctly configured end-to-end.
- The crypto library implements the invariants (nonce uniqueness, AAD, explicit versions, revision checks).
- Platform authenticators behave according to WebAuthn; PRF absence triggers the documented fallback, not a homemade KDF.
- The Emergency Kit is stored offline and is not accessible to the attacker.
- Clients persist `lastSeen` revision **off** the server.
- The account-token signing key is configured, not generated per process, in any deployment with more than one instance or an expectation that sessions survive a restart (`backend/app/core/security.py` enforces this in production).

---

**This threat model is living documentation and should be updated whenever the crypto protocol changes.**
