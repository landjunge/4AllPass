# Trust boundaries

**Status:** Architecture map. Running enforcement is [`../security-boundary.md`](../security-boundary.md).  
**Date:** 2026-08-26

Four standing rules:

1. The server stores the vault. The client owns the vault.
2. Agents receive capabilities, not the vault.
3. Identity is shared. Authorization stays local.
4. Small core, strict guarantees, optional extensions.

Wire: [`../vault-protocol.md`](../vault-protocol.md). Placement: [`../vault-storage.md`](../vault-storage.md). Agents: [`agent-identity.md`](agent-identity.md). Access: [`agent-access.md`](agent-access.md). Siblings: [`../capability-interface.md`](../capability-interface.md).

---

## Who may see what

| Component | Plaintext secrets? | Vault Key? | Own policy? |
|---|---|---|---|
| Desktop client | yes (after unlock) | yes (after unlock) | yes |
| Mobile client (later) | yes (after unlock) | yes (after unlock) | yes |
| Browser extension | limited (unlocked fill cache) | local only, not the server | limited (host match) |
| Vault server | no | no | storage auth only |
| Hosting provider | no | no | no (placement only) |
| Agent | normally no | no | no (identity ≠ allow) |
| Tollgate | no | no | action / cost / tool-loop only |
| Gnom-Hub | no | no | orchestration / delegation only |
| MCP / tools host | no | no | tool permissions only |
| Credential provider (GitHub, …) | their own tokens, not the vault | no | their IAM |

Human: owns master password, recovery kit, Allow/Deny.  
Device: cryptographic envelope, not a display name.  
Credential provider: rotating a leaked PAT is *their* revoke; 4AllPass TTL does not un-know a copy.

---

## Must never happen

- Hosting operator in the KDF or wrapping path.
- Gnom-Hub choosing 4AllPass secrets.
- FastAPI minting vault unwrap or GitHub PATs.
- `application: "n8n"` as cryptographic identity.
- Agent `vault.read_all`.
- Trusting “localhost” or “from Gnom-Hub” as identity.
