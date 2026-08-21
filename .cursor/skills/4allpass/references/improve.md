# What to improve (priority)

Product north star: devices own the vault **cryptographically**. The **wedge** is agent credential access (`docs/eight-week-agent-access.md`) — not “a nicer Bitwarden.” FastAPI still never sees secrets.

`docs/roadmap.md` phases 2–3 are largely done (backend + PWA exist). Do not restart scaffolding.

## Done on main (do not reimplement)

Hard revoke in the PWA (`hardRevokeDevice`), soft revoke that drops the envelope, DK-mirror CAS, server-issued WebAuthn challenges, COSE registration/assertion verification (ceremony integrity, not PRF), envelope property tests (`fast-check`), reproducible PWA/extension tree hashes, offline wire-snapshot cache (pin still applies), recovery-kit copy, Chromium MV3 autofill, Bitwarden/1Password/KeePass/CSV plaintext import.

## Now

1. **Desktop + agent access are on main** (`src-tauri/`, local SQLite core, loopback broker in-process). Dev leftover: `npm run broker`. Do not auto-publish. Do not grow a FastAPI token API. Do not open an unauthenticated localhost grant endpoint. Tollgate is a later *client*. A marketplace n8n node is still not shipped.
2. Safari.app fill / real Touch ID still unproven. Do not block the wedge on it.
3. Do not start TOTP, iOS Autofill, Plus, public-key wrapping, or a Tollgate merge.

Hard-revoke two Playwright profiles and live Chrome+Brave are on main. Item-share files are on main (`docs/sharing.md`).

## Later (do not start)

- Organizations / teams
- Social login as a crypto factor
- Native apps as a second product (Tauri desktop is on main; do not start Electron / iOS / Android)
- Passkey store as a separate vault product
- Shamir, TOTP
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
