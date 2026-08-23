# Produktreife — 4AllPass

Stand: 2026-08-23. Kein zweites Tauri, kein Tollgate, keine 20 Provider.
**Produkt:** Desktop-App. Agent fragt → Mensch Allow/Deny → zeitlich begrenzter Zugang.
FastAPI gibt **keine** Tokens aus. Launch-Posts nicht auto-publishen.

> **Status Phase A — in Arbeit / pausiert.**  
> Signing-CI liegt auf `main` (`#111`). Blocker ist **kein Code**, sondern Geld: Apple Developer Program ~99 USD/Jahr, aktuell **nicht leistbar**. Notarisierung gibt es **nicht kostenlos**. Releases bleiben **ad-hoc** (Mac: Rechtsklick → Öffnen).  
> In der Pause: **kein** Core-Rewrite, **kein** zweites Tauri, **kein** Launch-Post, **kein** Tag `v0.1.2`. Tracking: [#112](https://github.com/landjunge/4AllPass/issues/112).  
> Code-Weg ohne Apple: ein Terminal-Befehl statt Rechtsklick — [`install-terminal.md`](install-terminal.md).

Dieser Plan **ersetzt** die alte Reihenfolge Core-Refactor → Broker-Refactor → Tauri → Notifications → Installer → Provider → n8n. Die Teile davon, die gebraucht wurden, liegen auf `main`. Was fehlt, ist nicht mehr Architektur.

---

## Projektregel

Kein Core-Rewrite, kein zweites Tauri, keine Provider-Liste dazwischen.

Gute Ideen (Touch ID, MCP, 50 Provider, Mobile, Orgs, OS-Identität statt `"n8n"`) warten, bis **echte Nutzer** an eine Grenze stoßen. Alpha-Reife ist nicht „mehr bauen“.

---

## Zielbild „reif genug für Fremde“

Ein Mensch, der uns nicht kennt:

1. Findet die Download-Seite.
2. Installiert **ohne** Rechtsklick-Zauber (Mac) und **ohne** „unbekannter Herausgeber“ als Dauerzustand (Windows).
3. Legt in **unter 5 Minuten** einen Tresor an (Passwort + Recovery-Kit).
4. Versteht: der Agent bekommt **nicht** den Dauer-Schlüssel.
5. Kann n8n (oder ein anderes lokales Tool) anbinden und Allow/Deny klicken.

Was **nicht** dazugehört: App Store, Microsoft Store, Touch ID in der Webview, MCP als Sicherheit, Orgs, Plus.

---

## Wo wir heute stehen

| Baustein | Stand |
|---|---|
| Tresor, Crypto, Hard-Revoke, CAS | auf `main` |
| Desktop (Tauri), Tray, Sleep-Lock, Notifications | auf `main` |
| Access-Policy `@4allpass/core`, Sidecar-Broker | auf `main` |
| Installer Mac/Win/Linux an GitHub Releases | `v0.1.1`, **ad-hoc** |
| Apple-Notarisierung / Windows-Signatur | CI auf `main` (`#111`). **Pausiert:** Apple ~99 USD/Jahr aktuell nicht leistbar. Secrets fehlen |
| GitHub-Sterne / Reichweite | ~0 |
| Unabhängiges Audit | nicht beauftragt |

Der Produkt-Loop existiert. **Fremde scheitern an Gatekeeper/SmartScreen**, nicht am Vault.

---

## Phasen

Zeiten sind Kalender, nicht Coding-Stunden. Blocker mit **du** sind nicht delegierbar.

```text
A = Installation     (Doppelklick, Signing, Notarisierung)
B = Vertrauen        (First Run, ehrliche Texte, Uninstall/Reset)
C = Sichtbarkeit     (ein Post, eine Demo — nicht vorher)
D = später           (nur wenn echte Nutzer an Grenzen stoßen)
```

### Phase A — Doppelklick (Pflicht für „Fremde“)

**Status:** in Arbeit / **pausiert** (2026-08-23).  
**Dauer:** 3–10 Tage, sobald Apple durch ist.  
**Wer:** du kaufst; CI macht den Rest.  
**Info:** Mitgliedschaft ist der einzige Weg zu Gatekeeper-frei. Kein Workaround. Wieder aufnehmen, sobald das Jahresabo geht.

1. Apple Developer Program (~99 USD/Jahr) + Developer ID Application.
2. GitHub-Secrets laut [`distribution.md`](distribution.md).
3. ~~Branch `feat/distribution-signing` mergen~~ — erledigt (`#111`).
4. Tag `v0.1.2` → CI notarisiert DMG, signiert Windows wenn Zertifikat da.
5. Auf einem **fremden** Mac ohne Dev-Tools: DMG öffnen, **Doppelklick**, Tresor anlegen, Access-Demo.

**Fertig wenn:** ein Mensch ohne Terminal und **ohne Anleitung** die App öffnet und den Tresor sieht.

Windows-SmartScreen kann danach noch Wochen warnen (Reputation). EV-Zertifikat kürzt das; nicht versprechen „Tag 1 ohne Warnung“.

### Phase B — Vertrauen in der App (1–3 Tage Code)

Nur Texte und Kanten, kein neues Protokoll.

1. Beim **Teilen** klar: eine ausgegebene Kopie ist nicht zurückholbar.
2. Welcome / README: Unlock = Tresor-Passwort; WebAuthn-PRF in der Webview **unbewiesen**.
3. Recovery-Kit: ohne Kit kein Zurück — Satz steht, einmal im First-Run hart zeigen.
4. Release-Notes DE+EN auf dem Tag, Logo + Wordmark, kein „besserer Bitwarden“.
5. **Uninstall / Reset:** Deinstallieren entfernt die App, **nicht** stillschweigend den verschlüsselten Vault (`~/Library/Application Support/4AllPass/`, `%APPDATA%\4AllPass\`, `~/.local/share/4allpass/`). Der Mensch kann den lokalen Vault **bewusst** exportieren, zurücksetzen oder löschen. Nicht automatisch löschen.

**Fertig wenn:** niemand nach Install eine Sicherheits-Lüge liest, die `security-boundary.md` nicht hält — und niemand nach Deinstall merkt, dass der Tresor spurlos weg ist.

### Phase C — Findbar (optional, 1 Nachmittag)

Nur wenn du Sichtbarkeit willst. **Nicht** auto-publishen.

1. GitHub About + Topics (credential access, agents, zero-knowledge, self-hosted).
2. Ein Post aus [`launch-posts.md`](launch-posts.md) **von dir** in **eine** Community, die die Demo klicken kann.
3. Release-Link oben in README (schon installer-first).

Ohne Phase A bringt C nur Leute an eine Warnung.

### Phase D — Hart, später (nicht Alpha)

Nicht starten, um „reif“ zu wirken:

| Thema | Warum später |
|---|---|
| App als OS-Identität (nicht String `"n8n"`) | 1–2 Wochen, echtes Binding |
| Touch ID / PRF in WKWebView | Plattform; heute unproven |
| Unabhängiges Audit | Wochen + Geld; Scope: [`audit-scope.md`](audit-scope.md) |
| n8n Marketplace-Node | nicht geplant |
| Tollgate-Merge | nie als ein Produkt |
| iOS/Android, Orgs, 50 Provider | Far later / Plus |

---

## Reihenfolge (gesperrt)

```text
A  Apple + Secrets + v0.1.2 notariert
    → B  ehrliche First-Run-Texte + Uninstall/Reset
        → C  ein Post, wenn du willst
            → D  nur nach Bedarf
```

Kein Core-Rewrite, kein zweites Tauri, keine Provider-Liste dazwischen.

---

## Budget (grob)

| Posten | Größe |
|---|---|
| Apple Developer | ~99 USD / Jahr |
| Windows OV-Zertifikat | ~200–400 EUR / Jahr |
| Windows EV (optional) | deutlich teurer |
| Audit | extra, nicht in Alpha |

---

## Definition of Done (Produktreife v1 für Fremde)

Sicherheit (unverhandelbar):

- [ ] FastAPI mintet weiterhin keine Tokens.
- [ ] README und Release sagen die Wahrheit zu Notarisierung, PRF, Share-Kopien.

Installation:

- [ ] Fremder Mac: Doppelklick, kein Terminal.
- [ ] Fremder Windows-Rechner: Setup.exe, Warnung erklärt oder Signatur da.
- [ ] Ein technisch unerfahrener Nutzer kann 4AllPass **ohne Anleitung** installieren.

First Run / Access:

- [ ] First Run: Tresor + Recovery-Kit, kein E-Mail-Konto nötig.
- [ ] Ein Nutzer versteht innerhalb von **30 Sekunden**, was Allow und Deny bedeuten.
- [ ] Ein Nutzer kann nach der Installation die Access-Demo **ohne Dokumentation** durchführen (n8n read Allow, delete DENY, unknown DENY).

Uninstall / Reset:

- [ ] Uninstall entfernt die Anwendung, ohne den verschlüsselten Vault stillschweigend zu löschen.
- [ ] Der Nutzer kann den lokalen Vault bewusst löschen, exportieren oder zurücksetzen.

---

## Nächster Schritt (genau einer)

**Geld:** nichts kaufen. Phase A bleibt offen, bis Apple leistbar ist.  
**Code:** Browser-Sync ist die Basics — [`browser-sync.md`](browser-sync.md). Terminal-Install bleibt [`install-terminal.md`](install-terminal.md). Agent ist nicht der Einstieg.  
**Später Apple:** Secrets laut [`distribution.md`](distribution.md) → Tag `v0.1.2` → Test auf einem **fremden** Mac.
