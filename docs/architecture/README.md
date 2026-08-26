# Architecture docs

**Status:** Vision and ADRs. Not a license to implement.  
**Code sequence remains:** [`../product-maturity.md`](../product-maturity.md) v3.

| File | What it is |
|---|---|
| [`future-architecture.md`](future-architecture.md) | Long-term vision, honest vs code, architecture phases |
| [`trust-boundaries.md`](trust-boundaries.md) | Who may see plaintext / VK / set policy |
| [`agent-identity.md`](agent-identity.md) | Shared identity, local authorization |
| [`agent-access.md`](agent-access.md) | 4AllPass credential use; capabilities not vault |
| [`../specs/maip-v0.1.md`](../specs/maip-v0.1.md) | Experimental agent identity profile |
| [`../vault-protocol.md`](../vault-protocol.md) | Client–server storage contract |
| [`../vault-storage.md`](../vault-storage.md) | Local / self-host / managed placement |
| [`future-compatibility-check.md`](future-compatibility-check.md) | PASS / WARNING / BLOCK for later agents |
| [`adr/`](adr/) | Decisions. Status `accepted` only where the **running** code already holds |

Authoritative **now** specs stay where they are: [`../crypto-protocol.md`](../crypto-protocol.md), [`../security-boundary.md`](../security-boundary.md), [`../vault-revision.md`](../vault-revision.md), [`../team-mode.md`](../team-mode.md) (review only), [`../post-quantum-roadmap.md`](../post-quantum-roadmap.md).

If this folder and `packages/crypto` disagree, the library and its tests win.
