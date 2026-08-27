## 2. Key Hierarchy

```
                    Random 256-bit Vault Key (VK)
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
  Master Envelope       Device Envelopes       Recovery Envelope
  (Argon2id → MK)       (Device Key Material)  (Recovery Key)
        │                     │                     │
        └─────────────────────┴─────────────────────┘
                              │
                              ▼
                     AES-256-GCM + AAD
                     (Vault Entries)
```

### Key Definitions

| Key                    | Type                  | Lifetime / Scope                  | Purpose                                      |
|------------------------|-----------------------|-----------------------------------|----------------------------------------------|
| **Vault Key (VK)**     | Random 256-bit        | Per vault, until rotation         | Encrypts all vault entries                   |
| **Master Key (MK)**    | Argon2id output       | Ephemeral (derived on unlock)     | Unwraps the Master Envelope                  |
| **Device Key Material**| Platform-protected    | Per registered device             | Unwraps the corresponding Device Envelope    |
| **Recovery Key**       | Random high-entropy   | Long-term offline (Emergency Kit) | Unwraps the Recovery Envelope                |

The Vault Key is generated once when the vault is created.  
It is **never** derived from any password.

---
