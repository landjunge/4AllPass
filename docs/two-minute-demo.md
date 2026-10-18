# Maschinenzugriff prüfen / Check machine-access denial

## Aktueller Prüfweg — 19.10.2026 / Current check

**DE.** Seit dem Quell-Hardening aus PR #222/#224 (`a983814` als integrierte Basis)
ist die alte Allow-/Rohgeheimnis-Demo nicht mehr verfügbar. Öffentliche Pakete
`v0.1.2-rc.2` aus `60eef0a` enthalten noch den historischen Weg; sie sind durch
diese Quelldokumentation nicht aktualisiert. Keine eigenen API-Schlüssel für
die Demo anlegen, in einen Chat kopieren oder in einen alten Allow-Weg geben.

1. Nur in einer **isolierten eigenen Testinstallation des aktuellen Quellstands**
   einen synthetischen Tresor verwenden. Keine persönlichen Browserprofile importieren.
2. Access öffnen: Der Status erklärt den gesperrten Maschinenzugriff. Kein
   Allow- und kein „Übungs-Eintrag anlegen“-Button soll angeboten werden.
3. DE/EN umschalten: Beide Sprachen beschreiben denselben gesperrten Zustand.
   Menschliches Öffnen, Importreview, Autofill und Recovery sind eigene Wege;
   diese kleine Prüfung nimmt sie nicht erneut ab.
4. Kein geschützter Produktionshost vorhanden heißt **nicht verfügbar**. Die
   synthetische API-Core-Probe ist keine echte Anmeldung und keine OS-Isolation.

**EN.** Current source denies machine credential requests before queueing, also
after an old Allow. In an isolated synthetic current-source installation, open
Access and check the blocked status in DE/EN with no Allow or demo-seed control.
Do not use personal vaults, browser profiles, real keys or provider accounts.
Human vault/import/autofill/recovery remain separate. Historical downloads have
not been updated; synthetic tests are not protected production login.

### Paketprüfer / Package maintainers

Für einen **bereits vorhandenen, bewusst gebauten Kandidaten** im passenden
Quellcheckout (kein Build-/Download-/Veröffentlichungsbefehl):

```sh
python scripts/check-release-license.py --sidecar
```

The existing package check starts only that candidate with a temporary data
directory/cwd, minimal process environment and fixed synthetic pairing token.
It checks database/UI/favicon plus eight bounded requests: omitted, raw_secret,
mediated → exact `denied/handoff_unavailable`; missing/wrong token →401;
foreign/null/local browser Origin →403. No redirects, generic response fields,
secret output or inherited user pairing token. An old candidate with the raw
handoff must fail, not receive a new passing label. Missing binary/build tooling
is a prerequisite failure; this command does not build or release anything.

Evidence is written by the existing checker under `dist/release-checks/`, pinned
to source/binary/LICENSE. A new `packaged_machine_handoff_deny_v1` marker and the
eight exact named checks are required before prior identical-binary startup
evidence can be reused. Local handler/harness tests do not claim a fresh binary
check. See [security boundary](security-boundary.md#7-machine-access-fail-closed)
and [FP-V01 evidence](evidence/package-machine-deny-20261019/STATUS.md).

---

## Historischer Ablauf — nicht für den aktuellen Quellstand

**DE.** Der nachstehende ursprüngliche Text bleibt als historische Beschreibung
des früheren Rohmaterialwegs erhalten. Buttons, Allow und n8n-Anleitung sind
keine aktuellen Bedienanweisungen und keine Geheimnisfreiheitszusage.
**EN.** Original pre-hardening instructions below are historical only, not a
current supported workflow or a promise that agents never received secrets.

Each Allow/Deny shows a **Why** (policy reason, DE+EN, no secrets). Security status is on the Access tab. FastAPI still mints nothing.

**Week 7** of [`eight-week-agent-access.md`](eight-week-agent-access.md). Tracker: [#76](https://github.com/landjunge/4AllPass/issues/76).

A stranger with an unlocked vault can try this without a lecture:

> Allow n8n GitHub read → works → `repository.delete` DENY → TTL expire → unknown app DENY.

**Not this document:** a real n8n node, a FastAPI token API, Tollgate, MCP as a security boundary. Launch copy lives in [`your-ai-agent-doesnt-need-your-api-keys.md`](your-ai-agent-doesnt-need-your-api-keys.md).

---

## What you are proving

| Beat | What happens | Why it matters |
|---|---|---|
| Allow | n8n asks `repository.read` for 15s. You click Allow. | Agents get a time-boxed handoff, not the long-lived secret parked in the workflow. |
| Works | The Access tab shows who got access and remaining TTL — not the secret. | The grant lives in the unlocked page only. |
| Delete DENY | n8n asks `repository.delete`. Policy denies it. | Scope is not “GitHub, whatever.” |
| TTL expire | The grant dies. Future handoffs stop. | Expiry is not un-knowing a copy already given. Rotate the upstream secret to revoke a leak. |
| Unknown DENY | `malicious-agent` asks GitHub. DENY. | Process name is not identity. Unknown application = DENY. |

The FastAPI process never sees the request, the secret, or the grant. Same-origin `BroadcastChannel` `4allpass-access-v1` is the local `POST /v1/access/request`.

---

## Walkthrough (PWA)

1. Unlock a vault (new is fine).
2. Open the **Access** tab.
3. If there is no GitHub API entry with `repository.read` only, click **Add demo GitHub credential**. That stores a dummy `ghp_demo-…` token encrypted on this device. It is not a live GitHub PAT. You can instead add your own on Entries — keep capabilities at `repository.read` so delete stays DENY.
4. **Scene 1.** `n8n asks GitHub repository.read (15s)` → Allow. You should see `ACCESS GRANTED` and a countdown for n8n. The secret is not shown.
5. **Scene 2.** Next → `n8n asks repository.delete`. Immediate DENY (`scope_not_permitted`).
6. **Scene 3.** Next → **Expire now** (or wait 15s). Future handoffs stop.
7. **Scene 4.** Next → `unknown app asks GitHub`. DENY (`application_not_allowed`).
8. Audit lists APPROVED / DENIED / EXPIRED / DENIED. No secret in those rows.

Optional: open `/agent-request.html` in another tab of the **same origin** while the vault stays unlocked. Those three buttons hit the same policy over BroadcastChannel. Allow still happens in the vault tab.

Optional (real n8n, not the in-tab demo): Access tab → **n8n HTTP Request** → copy JSON into an n8n HTTP Request node. Unlock 4AllPass, Allow when it asks. n8n in Docker needs `host.docker.internal`. This is not a marketplace node.

---

## Honest limits

- Application identity is a string (`n8n`). Anyone who can post on the channel can claim that name. OS identity is later (`secret-access-layer.md`).
- The dummy token never talks to GitHub. “Works” means the local broker issued a time-boxed copy of whatever is in the entry.
- A copy already given is not un-known. TTL and Deny only stop *future* handoffs.
- There is no n8n marketplace node and no FastAPI token route. The local app has a loopback relay (`@4allpass/access`).
- Launch posts must not claim a production n8n node or FastAPI tokens.

---

## Tests

`frontend/src/lib/access-demo.test.ts` encodes the five beats without a browser. Policy cases stay in `access.test.ts`.

Headed Chrome, real mouse (API on `:8010`, PWA on `:5173`):

```sh
cd ~/4AllPass
LIVE_SLOWMO=500 npm run test:e2e:live -w @4allpass/frontend -- e2e/live/two-minute-demo.spec.ts
```
