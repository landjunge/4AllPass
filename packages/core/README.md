# `@4allpass/core`

Runtime-neutral access policy, grant **metadata**, and audit.

- No React, DOM, FastAPI, Tauri, or BroadcastChannel.
- `evaluatePolicy` may return `allow` meaning **eligible for a human Allow**, not auto-handoff.
- `AccessGrant` has no secret. The PWA/desktop UI still attaches `material` after Allow.
- Wire `AccessRequest.application` stays a string (`n8n`) so the loopback broker does not change.
