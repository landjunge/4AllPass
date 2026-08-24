# `@4allpass/broker`

**Dev relay**, not the product broker.

| How you run | Process | Port |
|---|---|---|
| `npm run app` / `4AllPass.app` | Sidecar `backend/app/broker.py` | `:8788` (same origin) |
| `npm run broker` (Vite-only) | this package | `:8787` |

Never decrypts envelopes. Never mints GitHub/Stripe tokens. Pairing token required. Browser `Origin` on grant is rejected. Policy stays in `@4allpass/core` inside the unlocked UI.

Do not import `@4allpass/core` here — that would skip the human Allow.
