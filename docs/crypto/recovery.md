## 6. Recovery

### Primary Recovery Mechanism (v1)
**Recovery Key** (recommended and required for production vaults)

- Generated once at vault creation (cryptographically random, 256 bit).
- Encoded for humans as **Crockford Base32 of `key || checksum`** in groups of five — see **[docs/recovery.md](../recovery.md)** for the exact encoding and the Recovery Wrapping Key derivation.
- The printed key is **never** used directly as an AES key: `RWK = HKDF-SHA-256(recovery key, vault-bound salt/info)` wraps the Recovery Envelope.
- Creates a **Recovery Envelope** (type = `"recovery"`).
- Presented to the user as an **Emergency Kit** (printable + QR):
  - Vault ID
  - Recovery words / code
  - Clear warning that this is the **only** recovery path
  - Instruction to store offline and securely

### Explicit Non-Goals for v1
- No e-mail / “forgot password” reset that restores vault access.
- No social-login-based recovery.
- No server-side recovery of the Vault Key.

### Recovery Flow
1. User provides the Recovery Key; the client normalizes it and verifies the checksum (a typo is reported as a typo, not as “wrong key”).
2. Client derives `RWK` and unwraps the Recovery Envelope → obtains Vault Key.
3. User can then create a new Master Envelope and/or new Device Envelopes.

Later versions may add Shamir Secret Sharing as an optional advanced recovery method.

---
