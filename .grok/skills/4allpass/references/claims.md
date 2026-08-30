# Claims vs reality

Over-claims are defects. `docs/security-boundary.md` is what the running
software enforces. Do not make README, overlay, or ROADMAP stronger than that.

## Access / agents

| Easy to write | What is true |
|---|---|
| Agents never need the password | **Goal.** v1 after human Allow copies a **raw secret** (`handoff: "raw_secret"`). |
| Zeitlich begrenzte Freigabe widerruft den Key | TTL stops *later 4AllPass handoffs*. A GitHub PAT already copied stays valid until GitHub says otherwise. The loopback grant is **one-shot** (second `decide` → 404); TTL is not a re-poll window. |
| `application: "n8n"` is identity | String + pairing token. Pairing token ≠ agent identity. Unknown app = DENY. |
| `handoff: "mediated"` | Typed. **Denied** in v1 (`handoff_unavailable`). No silent fallback to raw_secret. |
| FastAPI mints provider tokens | It does not. Broker is loopback; Origin 403 on the grant path. |

## Desktop / Tauri

| Easy to write | What is true |
|---|---|
| Webview navigates to `http://127.0.0.1:8788` with Tauri IPC | UI is bundled `frontendDist`. Sidecar `:8788` is API-only. Remote localhost has **no** Tauri IPC. Occupied 8788 refuses to start. |
| Hide to tray locks the vault | It does not. Sleep / manual Lock does. |
| PRF / Touch ID unlock in the desktop webview | Unproven. Master password and recovery kit are the supported paths. |

## Revoke / WebAuthn

| Easy to write | What is true |
|---|---|
| `DELETE /devices` erases the key | `revocation: "metadata_only"`. Hard revoke = client `hardRevokeDevice` (VK++). |
| Server verified the passkey / PRF | `cose_verified` is ceremony integrity (`fmt=none`). Server never sees PRF. |

## HTTP / ownership

Foreign vault or device id → **404**, never 403.

## User-facing copy

Prefer “Zugriffe müssen lokal bestätigt werden” over “zeitlich begrenzte Freigaben” unless the TTL limit is also stated honestly.
