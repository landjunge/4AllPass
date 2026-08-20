# Provider & Service Management

**Status:** Concept only. Far later. Protocol v1 is unchanged.  
**Date:** 2026-08-20  
**Not this document:** a schema bump, TOTP generator, API gateway, server-side graph, MCP/n8n injection, or clipboard watcher.

Companion: `development-plan.md`, `security-boundary.md`, `sharing.md`, `.cursor/skills/4allpass/references/improve.md`. Tracker: [#65](https://github.com/landjunge/4AllPass/issues/65).

---

## 1. What this is

Today a vault entry is a flat login: name, URL, username, password, notes.

The long-term product is **structured digital infrastructure and the credentials that belong to it** — still decrypted only on an authorized client.

**Provider** here means a **service / account type**, not an API vendor and not a credential-injection agent. It is a **template/definition**, not the secret.

That is a different product from “API-key management” and from the far-later MCP/n8n Plus shell (`#59`). Those stay separate.

Positioning shift:

> not “a list of my passwords”  
> but “my digital infrastructure and its access”

The crypto architecture does not change to get there. Envelopes, Vault Key, snapshot CAS, and `DELETE /devices = metadata_only` stay as they are. The new shape lives in **ciphertext** after a `schemaVersion` bump.

---

## 2. Three layers (keep them separate)

```text
Provider
   │
   ├── Account A
   │      ├── Password
   │      ├── TOTP
   │      └── API Key
   │
   └── Account B
          ├── Password
          └── Passkey
```

| Layer | What it is | Example |
|---|---|---|
| **Provider** | The service (named profile) or a kind template | Cloudflare, Hetzner, GitHub, “Website”, “SFTP” |
| **Account** | Your access on that service | Daniel @ Cloudflare, Admin @ example.com |
| **Secret** | The actual secret bytes | password, API key, TOTP secret, SSH private key, recovery codes, passkey handle |

A Provider is not an entry. An Account is not a password. A Secret is not a service.

Two levels of Provider:

1. **Kind template** — which fields an entry of this type should have (Website, Email, Domain, …).
2. **Named profile** — a concrete service (Cloudflare) that can cover several kinds (Website, Domain, DNS, API, Email).

Then a concrete account:

```text
Cloudflare
└── Daniel / Personal
    Credentials
    ├── Password
    ├── TOTP
    ├── API Token
    └── Recovery Codes
```

---

## 3. Kind templates

New-entry picker (UI sketch only):

```text
Was möchtest du speichern?

Website · E-Mail · Domain · Hosting · FTP / SFTP
Cloud · API · Git · Datenbank · VPN · Benutzerdefiniert
```

Default field sets (always plus **custom fields** — schemas must not be rigid):

| Kind | Typical fields (plaintext after unlock) |
|---|---|
| Website | name, URL, username, password; flags for TOTP / passkey / recovery codes; notes |
| Email | mailbox provider, address, username, password, IMAP, SMTP, TOTP |
| FTP / SFTP | name, host, protocol, port, username, password, SSH key, remote path, notes |
| Domain | domain, registrar, account, password, 2FA, nameservers |
| Hosting / Cloud / Git / Database / VPN / API | host or console URL, username, the relevant secrets, notes |
| Custom | name + arbitrary fields |

FTP/SFTP is the case that makes the Account/Secret split pay off: one account can hold a password **and** an SSH key **and** an API token without pretending they are three unrelated logins.

---

## 4. Relationships (later UI, same ciphertext)

Optional, client-only links after unlock. Not a server ACL and not wrapping to a foreign Device Key.

```text
example.com
     │
     ├── Registrar: Cloudflare
     ├── DNS: Cloudflare
     ├── Hosting: Hetzner
     ├── Mail: Google
     └── Website: example.com
```

Sketch of an **infrastructure view**:

```text
                 example.com
                      │
          ┌───────────┼───────────┐
          │           │           │
       Domain        DNS        Website
          │           │           │
      Cloudflare   Cloudflare   Hetzner
                                  │
                               SFTP
```

Each node can point at an encrypted Account. Drawing the graph is a PWA concern after decrypt. The FastAPI process never sees kind, provider name, domain, or the edges.

---

## 5. Zero-Knowledge rules (non-negotiable)

If this is ever implemented:

1. **`schemaVersion` bump.** v1 clients must refuse the new objects (`ProtocolError`), not ignore extra fields.
2. **All of Provider / Account / Secret / custom fields / relationships live in the encrypted snapshot.** Same AES-256-GCM path as today’s entries.
3. **The server must not index** provider, kind, hostname, domain, or the graph. No searchable Postgres columns for those. Opaque blob in, opaque blob out.
4. **No API gateway.** 4AllPass does not call Cloudflare / Hetzner / GitHub on the user’s behalf. Templates describe fields; they do not become an integration bus.
5. **Custom fields on every template.** A hoster’s `Account ID` must not require a protocol change.
6. **Autofill stays host-match after decrypt.** Do not add a server-side “this entry is a website for example.com” index to make fill faster.
7. **TOTP / passkeys / SSH keys / certs / recovery codes** are Secret types in this model. Shipping a TOTP generator is a separate **later** item and is not implied by parking this vision.
8. **Do not mix** this with clipboard watch (`#59`) or MCP/n8n credential injection (`#59`). Capture and agent injection are different modules, default off, same envelopes if they ever exist.

`packages/crypto` wrapping (VK, DK, DWK, recovery) does not need a new envelope type for structured entries. This is entry plaintext shape, not a new key path.

---

## 6. Triggers to reopen this file

- Community vote, or a maintainer-defined **Plus shell**, after the security freeze.
- A `schemaVersion` bump that is happening anyway (new entry format) — then this can ride along if the PWA is ready to render it.
- Explicit request to implement **Provider templates** (not “weiter”, not “API keys”, not “MCP”).

Until then the honest line is: **v1 is a login list in ciphertext; structured Provider / Account / Secret is a product vision, not a shipped feature.**

No code in this repository implements these templates, the graph, or a server index of kinds.
