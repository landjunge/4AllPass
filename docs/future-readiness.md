# Future Readiness Checklist

> Status: offen. Diese Punkte gehören in die Docs, *bevor* der erste Nutzer echte Passwörter reinschiebt. Nicht weil es schick ist – sondern weil du sonst der Lock-in wirst, den du bei OpenAI kritisiert hast.
>
> Gesamtstatus: `ROADMAP.md` §3. Keine parallelen Plan-Dateien.

---

## 1. Exit-Strategie (Migrationspfad)

**Frage:** Was passiert mit den Passwörtern deiner Nutzer, wenn du aufhörst?

- [ ] Offenes Export-Format dokumentiert (z. B. JSON mit Feldern: URL, Username, Password, Notes, TOTP-Secret)
- [ ] Ein-Klick-Export in der App (Desktop + Mobile)
- [ ] Import-Anleitung für die großen Player (Bitwarden, 1Password, KeePass) – nicht nur "du kannst exportieren", sondern "so importierst du woanders"
- [ ] Klare Aussage im README: *"Dein Tresor gehört dir. Hier ist, wie du ihn mitnimmst."*
- [ ] Test: Export → Import in Bitwarden funktioniert, ohne Datenverlust

**Warum das zählt:** Jeder Nutzer, der dir vertraut, vertraut dir mit *allem*. Wenn du verschwindest und nichts exportierbar ist, bist du der neue Vendor-Lock-in. Das ist kein Feature-Wunsch – das ist die Mindestvoraussetzung für Vertrauen.

---

## 2. Schlüssel-Rotation ohne Datenverlust (Crypto-Agility)

Du hast Hard-Revoke (rotiert den Vault-Key bei Geräteverlust). Gut. Aber was, wenn der *Algorithmus* selbst alt wird?

- [ ] Migrationspfad für Key-Derivation: Argon2id → Nachfolger (z. B. Argon2id mit höheren Parametern oder ein neuer KDF). Alte Vaults müssen ohne Passwort-Neingabe migriert werden können.
- [ ] Migrationspfad für Verschlüsselung: AES-256-GCM → Post-Quantum-sicherer Algorithmus (dein `post-quantum-roadmap.md` existiert schon – jetzt brauchst du den konkreten Migrations-Code).
- [ ] Versionierung im Vault-Format: Jeder Snapshot trägt eine Versionsnummer, und alte Versionen können gelesen und in neue umgewandelt werden.
- [ ] Test-Vektoren für die Migration (du hast schon `test-vectors/`, erweitere sie um Migrations-Szenarien).
- [ ] Dokumentiert: *"So migrierst du deinen Tresor auf einen neuen Algorithmus, ohne etwas zu verlieren."*

**Warum das zählt:** Krypto altert. Wer 2026 AES-256-GCM nutzt, ist 2032 möglicherweise veraltet. Die Frage ist nicht *ob*, sondern *wann* du migrierst – und ob deine Nutzer dabei ihre Daten behalten.

---

## 3. Rechtliches (Deutschland / EU)

Sobald ein Mensch außer dir seine Passwörter reinschiebt, bist du kein Hobby-Projekt mehr. Du bist ein Dienstleister mit Verantwortung.

- [ ] **Impressum** live (hast du schon als `impressum.html` – gut, aber prüfen ob aktuell)
- [ ] **Datenschutzerklärung** live (hast du als `datenschutz.html` – prüfen)
- [ ] Klare Antwort auf die DSGVO-Frage: *"Wo liegen die Daten?"* – Antwort: *"Nur auf deinem Gerät. Der Server sieht nur Ciphertext."* Das muss in der Datenschutzerklärung stehen, nicht nur im Threat-Model.
- [ ] Klare Antwort auf: *"Wer hat Zugriff?"* – Antwort: *"Nur du. Kein Admin, kein Support, niemand."*
- [ ] AGB oder Nutzungsbedingungen (auch wenn kostenlos – definiert, was der Nutzer darf und was nicht)
- [ ] Support-Kanal definiert (E-Mail-Adresse, die du liest – Apple will das für den App Store)
- [ ] Cookie-Banner? Nein – du hast keine Cookies, also auch keins. Aber prüfen, ob die Website Tracking hat.

**Warum das zählt:** In Deutschland reicht ein Impressum. Aber die DSGVO-Frage "wo liegen die Daten, wer hat Zugriff" willst du beantwortet haben, *bevor* der erste Nutzer fragt. Sonst bist du im Stress, wenn's brennt.

---

## Reihenfolge (empfohlen)

1. **Exit-Strategie** – schnell, kostet nichts, schützt das Vertrauen sofort.
2. **Rechtliches** – Impressum/Datenschutz prüfen, DSGVO-Antworten in die Docs schreiben.
3. **Crypto-Agility** – länger, aber du hast schon den Roadmap. Fang mit der Versionierung im Vault-Format an.

---

## Status-Tracking

| Punkt | Status | Notiz |
|-------|--------|-------|
| Exit-Strategie / Export-Format | ☐ offen | |
| Exit-Strategie / Import-Anleitung | ☐ offen | |
| Crypto-Agility / KDF-Migration | ☐ offen | Roadmap existiert |
| Crypto-Agility / AEAD-Migration | ☐ offen | Post-Quantum-Roadmap existiert |
| Crypto-Agility / Vault-Versionierung | ☐ offen | |
| Rechtliches / Impressum | ☐ prüfen | `impressum.html` existiert |
| Rechtliches / Datenschutz | ☐ prüfen | `datenschutz.html` existiert |
| Rechtliches / DSGVO-Antworten | ☐ offen | In Datenschutzerklärung aufnehmen |
| Rechtliches / AGB | ☐ offen | |
| Rechtliches / Support-Kanal | ☐ offen | |

Siehe auch `ROADMAP.md` §3.

---

*Zuletzt aktualisiert: 2026-08-28*
