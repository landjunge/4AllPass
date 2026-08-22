# Produktreife — 4AllPass

Stand: 2026-08-22. Kein zweites Tauri, kein Tollgate, keine 20 Provider.
**Produkt:** Desktop-App. Agent fragt → Mensch Allow/Deny → zeitlich begrenzter Zugang.
FastAPI gibt **keine** Tokens aus. Launch-Posts nicht auto-publishen.

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
| Apple-Notarisierung / Windows-Signatur | CI vorbereitet (Branch `feat/distribution-signing`), **Secrets fehlen** |
| GitHub-Sterne / Reichweite | ~0 |
| Unabhängiges Audit | nicht beauftragt |

Der Produkt-Loop existiert. **Fremde scheitern an Gatekeeper/SmartScreen**, nicht am Vault.

---

## Phasen

Zeiten sind Kalender, nicht Coding-Stunden. Blocker mit **du** sind nicht delegierbar.

### Phase A — Doppelklick (Pflicht für „Fremde“)

**Dauer:** 3–10 Tage, sobald Apple durch ist.  
**Wer:** du kaufst; CI macht den Rest.

1. Apple Developer Program (~99 USD/Jahr) + Developer ID Application.
2. GitHub-Secrets laut [`distribution.md`](distribution.md).
3. Branch `feat/distribution-signing` pushen + mergen (liegt lokal, Push war auth-fail).
4. Tag `v0.1.2` → CI notarisiert DMG, signiert Windows wenn Zertifikat da.
5. Auf einem **fremden** Mac ohne Dev-Tools: DMG öffnen, **Doppelklick**, Tresor anlegen, Access-Demo.

**Fertig wenn:** ein Mensch ohne Terminal die App öffnet und den Tresor sieht.

Windows-SmartScreen kann danach noch Wochen warnen (Reputation). EV-Zertifikat kürzt das; nicht versprechen „Tag 1 ohne Warnung“.

### Phase B — Vertrauen in der App (1–3 Tage Code)

Nur Texte und Kanten, kein neues Protokoll.

1. Beim **Teilen** klar: eine ausgegebene Kopie ist nicht zurückholbar.
2. Welcome / README: Unlock = Tresor-Passwort; WebAuthn-PRF in der Webview **unbewiesen**.
3. Recovery-Kit: ohne Kit kein Zurück — Satz steht, einmal im First-Run hart zeigen.
4. Release-Notes DE+EN auf dem Tag, Logo + Wordmark, kein „besserer Bitwarden“.

**Fertig wenn:** niemand nach Install eine Sicherheits-Lüge liest, die `security-boundary.md` nicht hält.

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
    → B  ehrliche First-Run-Texte
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

- [ ] Fremder Mac: Doppelklick, kein Terminal.
- [ ] Fremder Windows-Rechner: Setup.exe, Warnung erklärt oder Signatur da.
- [ ] First Run: Tresor + Recovery-Kit, kein E-Mail-Konto nötig.
- [ ] Access-Demo: n8n read Allow, delete DENY, unknown DENY.
- [ ] README und Release sagen die Wahrheit zu Notarisierung, PRF, Share-Kopien.
- [ ] FastAPI mintet weiterhin keine Tokens.

---

## Nächster Schritt (genau einer)

**Du:** Apple Developer anmelden.  
**Dann:** `feat/distribution-signing` pushen, mergen, Secrets, `v0.1.2`.
