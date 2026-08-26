# 4AllPass — Positionierung

**Zielgruppe:** Technisch versierte Einzelpersonen und kleine Teams, die volle Datenkontrolle wollen — Self-Hoster, die Bitwarden/Vaultwarden nutzen aber UI oder Autofill leid sind, oder die 1Password/Proton Pass mögen, aber nicht von einem Cloud-Anbieter und dessen Preispolitik abhängen wollen.

**Öffentlich (2026-08-23):**

> A local-first password vault that lets you securely share limited access with AI agents.

DE: Lokaler Passwort-Tresor. Begrenzt Zugang für KI-Agenten, wenn du das willst.

Einstieg: Browser → Tresor → Autofill ([`browser-sync.md`](browser-sync.md)). Agent Access bleibt **Advanced** (Access-Tab), nicht der erste Bildschirm. Nicht „besserer Bitwarden“.

**Heute (Vault, ehrlich):**

> Deine Geräte besitzen den Vault — kryptografisch, nicht nur organisatorisch. Local-first. Sync optional. Server deiner Wahl. Kein verpflichtender Cloud-Dienst. Desktop = Client. Self-host = Ablage. Zero-Knowledge, offenes Protokoll.

Die Chance ist beides: Device-Centric (PRF → DWK → DK → VK) **und** scoped/TTL access ohne dauerhaften Key beim Agenten. Der Server bleibt ein Blob-Store. 4AllPass hängt nicht an Tollgate.

**Nicht gegen 1Password Unified Access / EAM antreten.** Die haben Cloud, verifizierte Machine-Identities, JIT, Attribution, Mobile, Audit. Unser Feld: **lokal, ZK, kein Account bei uns, FastAPI mintet keine Tokens.** Agent-Zugang ist die Haltung „ohne uns zu vertrauen“, nicht Feature-Parität. Identität ist heute ein String + Pairing-Token — ehrlich, nicht OS-Binding.

---

## Was Nutzer an etablierten Anbietern stört

Auswertung von Nutzerfeedback (Trustpilot, Capterra, G2, Reddit-Zusammenfassungen) und Fachvergleichen, Stand August 2026.

| Anbieter | Geschätzt | Stört |
|---|---|---|
| **Bitwarden** | Preis-Leistung, Open Source, Self-Hosting | UI gilt als klobig; Preiserhöhung 2026; kein Recovery bei vergessenem Master-Passwort; Extension teils langsam; Login-Zuordnung nur nach Domain |
| **1Password** | UX-Goldstandard, starke Team-Funktionen | Teuer für Einzelpersonen/kleine Teams; Enterprise-Gewicht für Privatnutzer |
| **Proton Pass** | Privacy-first, Gratis-Tarif, moderne Optik | Autofill unzuverlässig; schwache Favicons; Emergency Access fehlt bzw. nur in höheren Tarifen |
| **Self-Hosting** (Vaultwarden & Co.) | Volle Kontrolle | Sicherheit hängt am eigenen Server; Single Point of Failure ohne Backup-Konzept |

Gemeinsamer Nenner:

1. Autofill, das zuverlässig funktioniert
2. Moderne Oberfläche trotz Sicherheitsfokus
3. Faire, transparente Preise
4. Bei technikaffinen Nutzern: echte Datenkontrolle, ohne Zuverlässigkeit zu opfern

---

## Der Einwand, den 4AllPass entkräften muss

„Self-Hosting ist unsicherer/unzuverlässiger als ein gehosteter Dienst.“

Antwort, die **im Produkt sichtbar** sein muss, nicht nur im Marketing:

- Recovery Key beim Vault-Setup, kein Server-Reset, kein E-Mail-Recovery (`docs/recovery.md`).
- Docker-Compose für Postgres + Redis + Backend.
- Öffentliches Threat Model, Adversarial Review, Testvektoren.
- Ehrliche Security Boundary: was die laufende Software wirklich erzwingt (`docs/security-boundary.md`).

---

## Was wir heute behaupten dürfen

- Local-first ist der Kern: kein verpflichtender Cloud-Dienst. Self-Hosting ist möglich, nicht Pflicht. Hosted später dasselbe Protokoll ([`vault-storage.md`](vault-storage.md)).
- Der Server speichert nur undurchsichtige Envelopes. Account-Passwort entschlüsselt den Vault nicht.
- Argon2id, AES-256-GCM, zufälliger Vault Key, Recovery Envelope, WebAuthn-PRF-Unlock sind im Client implementiert.
- Specs und KATs liegen öffentlich im Repo.

## Was wir heute nicht behaupten dürfen

- Autofill-Zuverlässigkeit in allen Browsern (Chromium, Firefox, macOS Safari existieren; iOS/Android native nicht).
- Live item-sharing to another person’s device key (v1 is an encrypted file plus share key only).
- Unabhängiges Drittaudit.
- „DELETE Gerät löscht den Schlüssel“ — Soft-Revoke ist `metadata_only`; Hard-Revoke rotiert den Vault Key in der PWA.
- Production n8n node, OS application identity, FastAPI token minting, “we posted this everywhere.” The Access tab **does** have a local two-minute demo (`docs/two-minute-demo.md`) and a launch article (`docs/your-ai-agent-doesnt-need-your-api-keys.md`). Same-origin `BroadcastChannel` `4allpass-access-v1`, not FastAPI. FastAPI gibt keine Tokens aus. Post-Entwürfe: `docs/launch-posts.md` — nicht automatisch veröffentlicht.

Vergleichstabelle: [`comparison.md`](comparison.md).

**Far later (keine Ist-Claims):** Zielkategorie *personal secret access control* (Mensch + Anwendung + Agent, ohne den Vault preiszugeben) steht in [`positioning-target.md`](positioning-target.md). Die dortigen 9/10-Zahlen gelten nur, wenn Provider-Templates und der Secret Access Layer fertig, getestet und auditiert sind. Nicht auf README/Website kopieren.
