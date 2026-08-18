# 4AllPass Threat Model (v1)

**Companion to:** `docs/crypto-protocol.md`, `docs/vault-revision.md`, `docs/webauthn-prf.md`, `docs/recovery.md`, `docs/adversarial-review.md`  
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
| Attach a false `revision` to a snapshot | Manifest AAD binds `revision` → `AuthFailureError` (`crypto-protocol.md` §8.1) |
| Serve snapshot `N` envelopes with snapshot `M` entries | Manifest digest set mismatch → `IntegrityError`; snapshot refused |
| Drop entries (truncation) or inject extra records | Manifest declares the complete set → `IntegrityError` |
| Re-attach a revoked device's envelope | Not in the manifest of the current snapshot → `IntegrityError` |
| Serve two different snapshots under one revision | Pinned `manifestDigest` → `mismatch` (equivocation) |
| Flip `vault_key_version` or `device_key_version` backwards | `downgrade` / `IntegrityError`; both are in AAD |
| Change `deviceId`, envelope `type`, `vault_id`, crypto version, or the Argon2id parameters on an existing blob | AES-GCM AAD mismatch → `AuthFailureError` |
| Hand a Device-Key Envelope of another vault / device / credential to a client | Expectation check → `IntegrityError` |
| Serve entry X in the slot the client requested for entry Y | Expected `entryId` check → `IntegrityError` |
| Ask the client for weak or absurd Argon2id parameters | Read-path validation → `ProtocolError` (`crypto-protocol.md` §4.1) |
| Truncate or flip bits in ciphertext / tag | `AuthFailureError` (or `ProtocolError` for a truncated tag) |
| Drop a device envelope (unauthorized soft revoke) | That device can no longer unlock via DK; Master Password / Recovery still work |
| Add a *new* device envelope | Cannot: they do not have VK, so they cannot wrap a valid envelope under a key they choose |
| Poison the client's revision pin with an absurd number | `revision` bounded to uint32 → `ProtocolError` |

### Cannot do

- Recover VK, DK, DWK, Master Password, or Recovery Key from stored data alone.
- Forge a new entry, envelope, or manifest that verifies under the real VK.
- Turn an account-password / OAuth compromise into vault plaintext.
- Silently roll a client **back** after that client has pinned a newer revision.
- Make a revision number mean something other than the snapshot it was sealed with.
- Assemble a snapshot from records of two different revisions or two Vault-Key generations.

Confidentiality under a malicious server therefore reduces to: offline attack on Argon2id (Master Password) or theft of the Emergency Kit / an unlocked client.

### First-use caveat

A **new** client has no pinned revision. The first snapshot it accepts is pin-on-first-use. An active server can choose *which* historical snapshot that new client sees first. Manifest verification makes that snapshot internally consistent — it cannot be a mixture — but it cannot make it *fresh*. After the first successful unlock, further rollback is detected.

### Backend duty

Client-side checks detect an inconsistent snapshot; they do not prevent one. Atomic publication (write the full snapshot including its manifest, then compare-and-swap `active_revision`, one snapshot per `(vault_id, revision)`) is a requirement on the storage layer, specified in `vault-revision.md` §4.1.

Account auth and vault ownership are a separate boundary
(`docs/backend-security-boundary.md`): they stop *other users* (and anonymous
callers) from reading or writing a vault's ciphertext. They do not stop a
malicious operator who already has the database. Session cookies authenticate
the account only; they never carry VK / DK / DWK / PRF output.

---

## 4. Security Goals

- Full server compromise or a malicious operator → only offline dictionary / brute-force against Argon2id (Master Password) or the Recovery Key remain.
- Account compromise alone never grants vault decryption.
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
| Non-atomic backend publication    | Detectable, not preventable client-side           | Backend requirements in `vault-revision.md` §4.1 |
| No browser / WebAuthn end-to-end test | Open | `packages/crypto` never talks to an authenticator; virtual-authenticator test belongs to the app layer |
| UV-gated local store (no PRF)     | Weaker than PRF                                   | Documented in `webauthn-prf.md`; Master Password remains |
| Side-channel attacks on Argon2id  | Partially mitigated by parameters                 | Not a primary target for v1 |
| Quantum attacks on AES            | Out of scope for v1                               | Future protocol version |

---

## 6. Assumptions

- Users choose reasonably strong Master Passwords / passphrases.
- TLS is correctly configured end-to-end.
- The crypto library implements the invariants (nonce uniqueness, AAD, explicit versions, revision checks).
- Platform authenticators behave according to WebAuthn; PRF absence triggers the documented fallback, not a homemade KDF.
- The Emergency Kit is stored offline and is not accessible to the attacker.
- Clients persist `lastSeen` revision **off** the server.

---

**This threat model is living documentation and should be updated whenever the crypto protocol changes.**
