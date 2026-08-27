## 5. Device Model & WebAuthn

WebAuthn / Passkeys are a **platform-protected unlock trigger** and the preferred source of the Device Wrapping Key.  
They are **not** an encryption oracle for the Vault Key.

The byte-level construction (PRF input, HKDF salt/info, Device-Key Envelope, fallback ranking) lives in **[docs/webauthn-prf.md](../webauthn-prf.md)**. That document is authoritative. A short summary:

1. After Master-Password unlock, generate a random 256-bit **Device Key (DK)**.
2. Derive **DWK = HKDF-SHA-256(PRF output, …)** — never use raw PRF output as a key.
3. Wrap DK under DWK (Device-Key Envelope, local).
4. Wrap VK under DK (Device Envelope, server).
5. On biometric unlock: assertion → PRF → DWK → DK → VK.

Fallback to Master Password must always remain possible.  
Do not implement a custom “WebAuthn → Device Key” shortcut.

### Key generations on the device path

Two independent counters exist, and confusing them is a rollback vector:

| Counter | Increments when | Lives on |
|---|---|---|
| `vault_key_version` | the Vault Key is rotated (hard revocation) | snapshot, every envelope, every entry, manifest |
| `device_key_version` | this device's Device Key is rotated (new DK, e.g. re-enrolment or credential replacement) | Device-Key Envelope (local) and the matching Device Envelope |

Both are authenticated (§3.1). A Device Envelope wrapped under `device_key_version 1`
can therefore not be replayed to a device that has already rotated to 2, and a
Device-Key Envelope from an earlier generation is refused rather than silently
opened.

---
