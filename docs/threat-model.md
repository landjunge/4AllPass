# 4AllPass Threat Model (v1)

**Companion to:** `docs/crypto-protocol.md`  
**Date:** 2026-08-17

---

## 1. Assets

| Asset                    | Sensitivity | Location              |
|--------------------------|-------------|-----------------------|
| Master Password          | Critical    | Client only (ephemeral) |
| Vault Key (VK)           | Critical    | Client (unlocked) + wrapped on server |
| Recovery Key             | Critical    | Offline Emergency Kit |
| Plaintext vault entries  | Critical    | Client only (unlocked) |
| Device Key Material      | High        | Platform-protected    |
| Account credentials      | Medium      | Server (hashed)       |
| Encrypted vault data     | Medium      | Server                |

---

## 2. Threat Actors

1. **Full Server Compromise**  
   Attacker obtains complete database dump (all KeyEnvelopes, encrypted entries, salts, device metadata).

2. **Network Attacker (MITM)**  
   Can observe or modify traffic between client and server (mitigated by TLS + authenticated encryption).

3. **Malicious / Compromised Client**  
   Malicious browser extension, XSS, or malware on the user’s device while the vault is unlocked.

4. **Lost / Stolen Device**  
   Physical possession of a previously unlocked or enrolled device.

5. **Insider / Self-hosted Admin**  
   Person with administrative access to the self-hosted instance.

6. **Remote Attacker with Account Access**  
   Compromised account password or OAuth token (but no Master Password).

---

## 3. Security Goals

- Full server compromise → only offline dictionary / brute-force attacks against Argon2id (Master Password) or the Recovery Key remain possible. No plaintext or usable Vault Key is exposed.
- Account compromise alone never grants vault decryption.
- Device revocation of a non-compromised device can be soft.
- Device revocation of a potentially compromised device requires hard Vault Key Rotation.
- Recovery is possible only with the Recovery Key (or later Shamir shares); never via e-mail or server-side reset.

---

## 4. Residual Risks & Explicit Limitations

| Risk                              | Status in v1                                      | Mitigation / Acceptance |
|-----------------------------------|---------------------------------------------------|-------------------------|
| Offline brute-force on Master PW  | Accepted (fundamental)                            | Strong Argon2id params + user education |
| Memory scraping while unlocked    | Accepted (JS/WASM platform limit)                 | Auto-Lock, short-lived secrets, zeroization best-effort |
| Compromised device already holds VK | Requires hard rotation                            | Documented rotation procedure |
| Side-channel attacks on Argon2id  | Partially mitigated by parameters                 | Not a primary target for v1 |
| Quantum attacks on AES / ECDH     | Out of scope for v1                               | Future protocol version |

---

## 5. Assumptions

- Users choose reasonably strong Master Passwords / passphrases.
- TLS is correctly configured end-to-end.
- The crypto library correctly implements the invariants (nonce uniqueness, AAD, zeroization attempts).
- Platform authenticators (WebAuthn) behave according to their specifications.
- The Emergency Kit is stored offline and is not accessible to the attacker.

---

**This threat model is living documentation and should be updated whenever the crypto protocol changes.**
