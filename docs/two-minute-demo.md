# Two-minute demo — agent credential access

**Week 7** of [`eight-week-agent-access.md`](eight-week-agent-access.md). Tracker: [#76](https://github.com/landjunge/4AllPass/issues/76).

A stranger with an unlocked vault can try this without a lecture:

> Allow n8n GitHub read → works → `repository.delete` DENY → TTL expire → unknown app DENY.

**Not this document:** a real n8n node, a FastAPI token API, week-8 launch copy, Tollgate, MCP as a security boundary.

---

## What you are proving

| Beat | What happens | Why it matters |
|---|---|---|
| Allow | n8n asks `repository.read` for 15s. You click Allow. | Agents get a time-boxed handoff, not the long-lived secret parked in the workflow. |
| Works | The Access tab shows a redacted token and remaining TTL. | The grant lives in the unlocked page only. |
| Delete DENY | n8n asks `repository.delete`. Policy denies it. | Scope is not “GitHub, whatever.” |
| TTL expire | The grant dies. Future handoffs stop. | Expiry is not un-knowing a copy already given. Rotate the upstream secret to revoke a leak. |
| Unknown DENY | `malicious-agent` asks GitHub. DENY. | Process name is not identity. Unknown application = DENY. |

The FastAPI process never sees the request, the secret, or the grant. Same-origin `BroadcastChannel` `4allpass-access-v1` is the local `POST /v1/access/request`.

---

## Walkthrough (PWA)

1. Unlock a vault (new is fine).
2. Open the **Access** tab.
3. If there is no GitHub API entry with `repository.read` only, click **Add demo GitHub credential**. That stores a dummy `ghp_demo-…` token encrypted on this device. It is not a live GitHub PAT. You can instead add your own on Entries — keep capabilities at `repository.read` so delete stays DENY.
4. **Scene 1.** `n8n asks GitHub repository.read (15s)` → Allow. You should see `ACCESS GRANTED` and a redacted handoff with a countdown.
5. **Scene 2.** Next → `n8n asks repository.delete`. Immediate DENY (`scope_not_permitted`).
6. **Scene 3.** Next → **Expire now** (or wait 15s). Future handoffs stop.
7. **Scene 4.** Next → `unknown app asks GitHub`. DENY (`application_not_allowed`).
8. Audit lists APPROVED / DENIED / EXPIRED / DENIED. No secret in those rows.

Optional: open `/agent-request.html` in another tab of the **same origin** while the vault stays unlocked. Those three buttons hit the same policy over BroadcastChannel. Allow still happens in the vault tab.

---

## Honest limits

- Application identity is a string (`n8n`). Anyone who can post on the channel can claim that name. OS identity is later (`secret-access-layer.md`).
- The dummy token never talks to GitHub. “Works” means the local broker issued a time-boxed copy of whatever is in the entry.
- A copy already given is not un-known. TTL and Deny only stop *future* handoffs.
- There is no n8n credential type, no localhost HTTP broker, no FastAPI `/v1/access/request`.
- Do not put week-8 launch claims on the README until someone has actually clicked this.

---

## Tests

`frontend/src/lib/access-demo.test.ts` encodes the five beats without a browser. Policy cases stay in `access.test.ts`.

Headed Chrome, real mouse (API on `:8010`, PWA on `:5173`):

```sh
cd ~/4AllPass
LIVE_SLOWMO=500 npm run test:e2e:live -w @4allpass/frontend -- e2e/live/two-minute-demo.spec.ts
```
