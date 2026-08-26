# Security freeze #2

**Stand:** 2026-08-26. Review target was `main` @ `01ba6b5` (#123–#125).  
Crypto core was **not** rewritten.

External static review. Not a third-party pentest. Findings were around the
kernel: desktop trust, lock wipe, agent handoff honesty, extension origin,
server size limits, CSP, CI.

## Done in this freeze

1. **Tauri port trust.** Occupied `127.0.0.1:8788` before spawn is a hard
   error. The webview stays on bundled `frontendDist`. Capability
   `remote.urls` for `:8788` is gone. Access prompt uses `WebviewUrl::App`.
2. **`lock()`** calls `wipeVaultEntry()` — password, notes, **totpSecret**.
3. **Agent grant** is typed `handoff: "raw_secret"`. TTL does not recall a
   copy. UI copy says so. No capability proxy in this freeze.
4. **`TRUSTED_APPLICATIONS`** remains a display-name list. Not enrollment.
5. **Extension API origin:** HTTP only on loopback; otherwise HTTPS.
6. **Snapshot schemas** share crypto ceilings. Request body 32 MiB cap.
7. **Nginx CSP** on the PWA image. Local profile rejects non-loopback `Host`.
8. **CI:** `npm audit --audit-level=high` and `pip-audit` no longer
   `continue-on-error`. Dependabot watches Cargo.
9. **Installer** prints that SHA-256 is not GitHub-account security and that
   `xattr -cr` is the tester path.

## Not built (on purpose)

- Cryptographic agent identity / pairing ceremony (key pairs).
- Capability proxy (OAuth / short-lived provider tokens).
- Persistent AEAD seal counter (F-25).
- Apple notarization / independent release signing.
- Pinning every GitHub Action to a commit SHA (Dependabot for actions stays).
- Public Suffix List for autofill (exact+known shared parents remain).

## Tests

- `wipeVaultEntry` / `lock()` totp wipe
- `normalizeApiOrigin` rejects `http://` remote
- `issueGrant().handoff === "raw_secret"`
- snapshot oversized ciphertext → 422
- local `Host: evil.example` → 400
- `core_bind.rs`: occupied port is foreign
