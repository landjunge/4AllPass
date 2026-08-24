# What to improve (priority)

Product north star: devices own the vault **cryptographically**. **v3 focus** (`docs/product-maturity.md`): authentication effortless for humans, controlled for machines. Autofill is the product, not a side feature. Agent access is advanced. One credential engine for both. Not “a nicer Bitwarden.” FastAPI still never sees secrets.

`docs/roadmap.md` phases 2–3 are largely done (backend + PWA exist). Do not restart scaffolding.

## Done on main (do not reimplement)

Hard revoke in the PWA (`hardRevokeDevice`), soft revoke that drops the envelope, DK-mirror CAS, server-issued WebAuthn challenges, COSE registration/assertion verification (ceremony integrity, not PRF), envelope property tests (`fast-check`), reproducible PWA/extension tree hashes, offline wire-snapshot cache (pin still applies), recovery-kit copy, Chromium MV3 autofill, Bitwarden/1Password/KeePass/CSV plaintext import.

## Now

Reliability before expansion. Do not rewrite crypto, Tauri, or FastAPI. Do not delete the Access tab; do not put it on the first screen.

1. **Autofill V1 + P1b Assist + P2 Why + P3 TOTP + `install.sh`** are on `main`. Intel Mac one-liner → window proven 2026-08-24 (rolling tag `desktop`, SHA-256). Passkey store still later (real platform APIs only). Next feel-able proof: Fill on GitHub (two pages, two clicks). Do not reimplement the engine. Do not start a multi-step engine in this slice.
2. Browser cards, Chrome/Firefox import + review, provider resolver: **on main**. Do not reimplement.
3. **Phase A — double-click, paused.** Apple ~99 USD/year not affordable. No `v0.1.2`. Terminal install is the pause: `docs/install-terminal.md`.
4. Do not start Safari import, write-back into Chrome `Login Data`, Access simulator, 500 providers, second Tauri, FastAPI token API, Tollgate merge, n8n marketplace, or a passkey store.

Hard-revoke two Playwright profiles and live Chrome+Brave are on main. Item-share files are on main (`docs/sharing.md`).

## Later (do not start)

- Organizations / teams — specified in `docs/team-mode.md` + `docs/team-roadmap.md`. **Do not implement** until the maintainer accepts the review. Must not become PAM.
- Social login as a crypto factor
- Native apps as a second product (Tauri desktop is on main; do not start Electron / iOS / Android)
- Passkey store as a separate vault product
- Shamir. TOTP on vault entries is on `main` (RFC 6238). Passkey store still later.
- Wrapping a Vault Key or item key to a **foreign** Device Key (needs public-key wrapping)
- Post-quantum hybrid-KEM: concept is `docs/post-quantum-roadmap.md`. Do not implement ML-KEM until public-key wrapping exists.

## Far later (community or Plus — not core)

Parked on purpose (2026-08-20). Do not build on “weiter” / “improve”. Revisit only if a community vote asks or the maintainer defines a **Plus shell** (same envelopes, same server never sees plaintext, default **off**).

- Clipboard capture / watcher (never in the PWA as a fake background watch; never default on) — *ingest*, `#59`
- **Provider & service management** (vault *shape*, not an API gateway): `docs/provider-service-vision.md`, `#65`
- **Secret Access Layer** (vault *egress*): `docs/secret-access-layer.md`, `#67`. Auto-detection + click-to-approve fill + optional local broker + application identity + capabilities. Unifies “API-key management”, MCP/n8n/IDE agent, and auto-suggest. **Not** “apps get passwords automatically.” Unknown app = DENY. FastAPI is not the broker. Default off. Target *category* if that ships: `docs/positioning-target.md` — do not put those scores on the README.
- **Capability interface** (4AllPass × Tollgate × Gnom-Hub): `docs/capability-interface.md` + contract `docs/capability-contract-v1.md` (4AP-CAP-1), `#70`. Issue/Verify/Inspect/Revoke only. Not a super-protocol. MCP is not the security boundary. 4AllPass knows no Tollgate policies; Tollgate knows no vault contents; Gnom-Hub knows no secrets.
- Auto-categorize hosting / Plesk / mail / IP from clipboard (ingest helper; still `#59`)
- A paid or “Plus” edition that is extra modules, not a second protocol

If Plus ever exists: `packages/crypto` stays unchanged; broker, agent, and capture are optional processes. Who does not install them has today’s ZK.

## How to pick a task

If the user says “improve 4AllPass” without a target, propose **one** item from “Now”, say why, and implement that. Do not open a new architecture debate. The architecture is frozen enough; the gap is product you can feel, not more scaffolding.
