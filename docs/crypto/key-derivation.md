## 4. Master Password Flow

1. User enters Master Password.
2. Client loads the Master Envelope (contains salt + Argon2 parameters).
3. Client derives `MK = Argon2id(MasterPassword, salt, memory, iterations, parallelism)`.
4. Client attempts to decrypt the Master Envelope with MK + correct AAD.
5. On success → Vault Key is obtained → vault is unlocked.
6. Master Password and intermediate key material are zeroized as soon as practical.

**Recommended default Argon2id parameters (v1):**
- Memory: 64 MiB (65536 KiB)
- Iterations: 3
- Parallelism: 4
- Hash length: **32 bytes**
- Version: **0x13** (19)
- Secret (K) and associated data (X): **empty**
- Password encoding: Unicode **NFC**, then UTF-8

| Profile | Memory | t | p | Production |
|---------|-------:|--:|--:|------------|
| `ci` | 32 KiB | 3 | 4 | **No** — tests only |
| `mobile_safe` | 32 MiB | 3 | 1 | Yes |
| `balanced` | 32 MiB | 6 | 4 | Yes |
| **`standard`** (default) | **64 MiB** | **3** | **4** | Yes |
| `high` | 128 MiB | 4 | 4 | Yes |

`standard` is RFC 9106 SECOND RECOMMENDED memory. `ci` MUST NOT be persisted on a production vault.  
Chosen parameters **must** be stored inside the Master Envelope so that later re-keying is possible without data loss.

### 4.1 Validating parameters that came back from the server

The `kdf` block is untrusted input on the unlock path: it is stored by the server
and it instructs the client to allocate memory. Every read **must** be validated
before it reaches Argon2id:

| Check | Bound | Attack prevented |
|---|---|---|
| `algorithm` | exactly `argon2id` | variant substitution (argon2i / argon2d) |
| `version` | exactly `0x13` | derivation under an older, weaker Argon2 |
| `hashLen` | exactly 32 | short Master Key |
| `memory` | ≥ 32 MiB (production floor) and ≤ 1 GiB | KDF downgrade / client memory exhaustion |
| `iterations` | 1…16 | KDF downgrade / CPU exhaustion |
| `parallelism` | 1…16 | KDF downgrade / resource exhaustion |
| `salt` | exactly 16 or 32 bytes | ambiguous or degenerate salt |

The `ci` profile is below the production floor and is only accepted when the caller
explicitly opts in (`allowTestProfile: true`), which production code never does.
Because the parameter digest is in the envelope AAD (§3.1), a rewritten parameter
set additionally fails the GCM tag.

Known-answer tests: **[docs/test-vectors-argon2id.md](../test-vectors-argon2id.md)**.

---
