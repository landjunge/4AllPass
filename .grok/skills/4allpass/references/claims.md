# Claims vs reality

Over-claims are defects. `docs/security-boundary.md` is what the running
software enforces. Do not make README, overlay, or ROADMAP stronger than that.

## Access / agents

- Changed source denies machine credential handoffs, including raw_secret and
  old Allow responses. No protected production executor is connected.
- Historical v0.1.2-rc.2 downloads returned actual material as access_token. They
  are not silently updated or relabeled by this source change.
- Pairing token and application strings are not authenticated model identity.
- TTL never recalls previous credential copies or provider sessions.
- The synthetic API core/TollGate tests do not prove OS isolation, protected
  browser login, third-party audit or a deployed product integration.

## Desktop / Tauri

| Easy to write | What is true |
|---|---|
| Webview navigates to `http://127.0.0.1:8788` with Tauri IPC | UI is bundled `frontendDist`. Sidecar `:8788` is API-only. Remote localhost has **no** Tauri IPC. Occupied 8788 before spawn refuses. After spawn, a listener that is not our child (or a descendant) is the same refuse. TCP connect is not trust. |
| Hide to tray locks the vault | It does not. Only the Lock button does. Sleep / App Nap / Chrome in front do not. |
| PRF / Touch ID unlock in the desktop webview | Unproven. Master password and recovery kit are the supported paths. |
| Account compromise never decrypts the vault | Only if account password ≠ vault password. Login still sends the account password. Hosted PWA: the code host can read the vault password. Bundled desktop is the active-server claim. |
| Extension unlocks with vault password only | Only when this Mac has no e-mail account. If `hasOtherAccounts`, same e-mail + account password as the app. Empty fields must not POST `/auth/local`. |

## Revoke / WebAuthn

| Easy to write | What is true |
|---|---|
| `DELETE /devices` erases the key | `revocation: "metadata_only"`. Hard revoke = client `hardRevokeDevice` (VK++). |
| Server verified the passkey / PRF | `cose_verified` is ceremony integrity (`fmt=none`). Server never sees PRF. |

## HTTP / ownership

Foreign vault or device id → **404**, never 403.

## User-facing copy

Prefer “Zugriffe müssen lokal bestätigt werden” over “zeitlich begrenzte Freigaben” unless the TTL limit is also stated honestly.
