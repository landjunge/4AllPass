# UI-Map — digitales Papier-Wireframe

**Status:** Flächenkarte für Grok Build. Keine Spec.  
**Shape:** [`architecture.md`](architecture.md). **Was läuft:** [`security-boundary.md`](security-boundary.md).

Eine View = ein Kasten. Zahl = Fläche. Ein Satz daneben. HTML-Wireframe öffnen (Gnom-Hub-V1-Grau, nummeriert): [screenshots/index.html](screenshots/index.html).

---

## V0 App-Chrome (jede Seite)

```
┌──────────────────────────┐
│ 1 Logo        2 Lock/Mail│
│ 3 Banner (nur bei Fehler)│
│ 4 main                   │
└──────────────────────────┘
```

| # | Tut |
|---|---|
| 1 | 4AllPass mit freigegebenem AP4-Rastermotiv (brand/README.md). |
| 2 | Tresor offen/gesperrt; Sperren; Abmelden nur mit Account. |
| 3 | `error` / `notice`. Schließen räumt die Meldung. Nach bestätigtem Hard-Revoke-Commit bleibt der DE/EN-Teilabschluss mit „Geräteentzug prüfen“ auch gesperrt sichtbar; prüft nur ausstehendes DELETE/GET, nie eine zweite Rotation. Dieser Abgleich endet beim Abmelden/Neuladen. Offener Tresor + Einträge noch auf `local@`: Passwort einmal, Merge hierher. Nicht abmelden, nicht sperren. |
| 4 | Eine der Views V1–V8. |

> Wireframe: [v0-chrome.html](screenshots/v0-chrome.html)

---

## V1 Auth

```
┌──────────────────────────┐
│ 1 Titel Konto / Anmelden │
│ 2 E-Mail                 │
│ 3 Konto-Passwort         │
│ 4 Submit  5 Wechsel      │
└──────────────────────────┘
```

| # | Tut |
|---|---|
| 1 | Eine Frage: Konto anlegen oder anmelden. Öffnet den Tresor nicht. |
| 2–3 | Account, nicht Master-Passwort. Neue Registrierung:15–256 Unicode-Zeichen, offline bekannte/erwartete Gesamtwerte verweigern; feste DE/EN-Fehler. Bestehende Anmeldung behält ihre bisherige Passwortprüfung. |
| 4 | `auth-submit`. 409 → Anmelden. |
| 5 | Wechselt den Modus. |

> Wireframe: [v1-auth.html](screenshots/v1-auth.html)

---

## V2 Tresor anlegen / wiederherstellen

```
┌──────────────────────────┐
│ 1 Titel                  │
│ 2 Master + Wiederholen   │
│ 3 Anlegen | Ich hab einen│
└──────────────────────────┘
```

| # | Tut |
|---|---|
| 1 | Eine Frage: Tresor-Passwort wählen. |
| 2 | Bleibt auf dem Gerät. Mismatch blockt Submit. |
| 3 | Anlegen → Recovery-Kit. Link → Restore-Datei + Share-Key. |

> Wireframe: [v2-create.html](screenshots/v2-create.html)

---

## V3 Unlock

```
┌──────────────────────────┐
│ 1 Gerät öffnen (optional)│
│ 2 Master oder Recovery   │
│ 3 Unlock                 │
└──────────────────────────┘
```

| # | Tut |
|---|---|
| 1 | WebAuthn auf diesem Gerät. Rang 3 ist nur Policy, kein PRF. |
| 2 | Master oder Recovery-Key. Nie an den Server. |
| 3 | Entschlüsselt Snapshot → VaultPage. |

> Wireframe: [v3-unlock.html](screenshots/v3-unlock.html)

---

## V4 Tresor-Desk (Hauptfläche)

```
┌──────────────────────────────┐
│ 1 Tabs: Tresor Browser Zugriff│
│     Einstellungen            │
│ ┌────────────┬─────────────┐ │
│ │2 Hero+Score│             │ │
│ │3 Suche+Chip│ 6 Detail    │ │
│ │4 Favoriten │    oder     │ │
│ │5 Aufmerksamkeit│ Empty   │ │
│ │  Zuletzt geänd.│         │ │
│ └────────────┴─────────────┘ │
└──────────────────────────────┘
```

| # | Tut |
|---|---|
| 1 | Eine Hierarchie: Tresor / Browser / Zugriff / Einstellungen. |
| 2 | „Welchen Zugang suche ich?“ Count. Score ab 5 Einträgen (lokal, kein Server). |
| 3 | Sticky Suche, live. Filter Alle / Logins / API / Server / Kurz. Plus + Import. |
| 4 | Sterne gold. Stern-Tap toggelt `favorite`. Rest der Row öffnet Detail. |
| 5 | Geleakt / doppelt / schwach, dann alle anderen nach `updatedAt`. Icon + Titel + User/Host + Badge. |
| 6 | Formular in Fragen (Art → Name → Zugang). Kopieren am Feld. Oder Empty mit Login/API/Server. |

**V4.6 Verwendungsübersicht (#279 Punkt 6).** Eine Frage: *Was hängt an diesem
Schlüssel, bevor ich ihn widerrufe oder lösche?* Optionales Freitextfeld
„Verwendet von“ unter den weiteren Feldern im Formular (ein Werkzeug/Projekt
pro Zeile) — rein manuell eingetragen, **keine** automatische Erkennung:
4AllPass hat keinen Einblick in fremde Prozesse oder Dateien außerhalb des
Tresors. Ist die Liste nicht leer, zeigt das Formular direkt über
Löschen/Abbrechen einen Hinweis mit den eingetragenen Namen. Der Hinweis
blockiert nichts — Löschen verschiebt wie immer nur in den Papierkorb
(V7.3-Mechanik), bewusst keine zusätzliche Zwangsbestätigung, weil der
Papierkorb bereits das Sicherheitsnetz ist.

**V4.7 Schlüsselrotation (#279 Punkt 5).** Eine Frage: *Wie tausche ich diesen
Schlüssel beim Anbieter aus, ohne einen zweiten Eintrag anzulegen?* Bewusst
klein gehalten, wie das Issue es scoped: **keine** automatisierte
Rotations-API, **kein** Netzwerkaufruf zu einem Anbieter — nur Begleitung der
manuellen Erneuerung. Erscheint im Formular (Box 6) nur beim Bearbeiten eines
**bestehenden** API-Eintrags (nie beim Neuanlegen — das bleibt die eigene
„Neuen Schlüssel erstellen“-Fläche). Für GitHub, OpenAI oder Stripe: dieselbe
offizielle Anbieter-Seite öffnen und dieselbe bewusste, auf 90 Sekunden
begrenzte Zwischenablage-Erfassung wie bei „Neuen Schlüssel erstellen“ —
derselbe Hook, nur ohne Anbieter-Auswahl (fest auf den Anbieter des
geöffneten Eintrags). Der erfasste Wert fließt in **dasselbe** offene
Formular zurück, legt **nie** einen zweiten Eintrag an; erst der vorhandene
Speichern-Button übernimmt ihn. Weil jedes Speichern ohnehin einen neuen
Tresor-Stand schreibt, bleibt der alte Schlüssel danach unter „Frühere
Stände“ (V7.3) abrufbar — keine eigene Historie nötig. Zwei ehrliche
Hinweise statt stiller Übernahme: ein erfasster Wert, der **identisch** mit
dem bisherigen ist, oder einer, der schon bei einem **anderen** Eintrag
gespeichert ist. Für andere Anbieter zeigt die Fläche nur eine
Text-Anleitung (beim Anbieter anmelden, neuen Schlüssel erzeugen, hier
einfügen) ohne Automatik. `vaultKeyVersion` (Vault-Schlüssel-Generation aus
der Recovery-Rotation) bleibt davon unberührt — das ist ein anderer, größerer
Zähler für das gesamte Tresor-Verschlüsselungsmaterial, nicht für einen
einzelnen Provider-Key.

Handy: Spalten unter 820 px untereinander.

> Wireframe: [v4-desk.html](screenshots/v4-desk.html) · [v4-desk-empty.html](screenshots/v4-desk-empty.html) · [v4-desk-phone.html](screenshots/v4-desk-phone.html)  
> Foto optional: `docs/screenshots/v4-desk.png`

---

## V5 Browser

```
┌──────────────────────────┐
│ 1 Karten je Browser      │
│ 2 Profile anhaken        │
│ 3 Passwörter holen       │
└──────────────────────────┘
```

| # | Tut |
|---|---|
| 1 | Welcher Browser auf diesem Mac. |
| 2 | Welche Profile. Kein Autofill-Grant. |
| 3 | Import-Review: Host + User, **kein** Passwort in der Liste. |

> Wireframe: [v5-browser.html](screenshots/v5-browser.html)

---

## V6 Zugriff

Die bestehende Zugriff-Fläche erklärt die Sperre für Maschinenzugriff, weil kein
geschützter produktiver Nutzungsweg verbunden ist. Kein Allow-Knopf, keine
Rohmaterial-Demo und kein Secret-Verbindungsrezept. Normale Tresor-/Browser-/
Einstellungs-Tabs bleiben erhalten. DE/EN, kompakte Card, semantischer Status.

Der getrennt vorhandene optionale `LocalBrokerConnect`-Baustein zeigt vor der
ersten akzeptierten Poll-Antwort „verbindet“ und bei Transportfehlern verständliche
DE/EN-Hinweise. Das ist keine neue Freigabe oder Wiedereinführung in die gesperrte
Zugriff-Fläche und kein authentisierter Verbund-/Tresorstatus.

Historische Wireframes unter screenshots/v6-access.html zeigen den alten
Raw-Secret-Entwurf und sind keine Zusage des aktuellen Quellstands.

---

## V7 Einstellungen

```
┌──────────────────────────┐
│ 1 Allgemein | Geräte |   │
│   Sicherheit             │
│ 2 Pane                   │
└──────────────────────────┘
```

| # | Tut |
|---|---|
| 1 | Untertabs. Geräte = Biometrie + Revoke (DELETE = metadata_only). |
| 2 | Sicherheit = Revision nur zur Kontrolle, nicht Alltag. |
| 3 | Sicherheit → **Frühere Stände**: Liste älterer Stände (Datum · Anzahl Einträge). Lesen ist kein Zurückdrehen. |

**V7.3 Frühere Stände.** Eine Frage: *Was war vorher drin?* Pro Zeile Datum und
Anzahl Einträge, aktueller Stand markiert. Stände von vor einem
Schlüsselwechsel sind nicht lesbar und werden als solche benannt, nicht
versteckt. Öffnen zeigt Titel/Host/Benutzer dieses Standes — **nie Passwörter**.
Ein einzelner, im aktuellen Tresor fehlender Eintrag lässt sich einzeln
wiederherstellen (immer als neuer Stand, nie zurückgedreht; eine bereits
vorhandene ID wird abgewiesen). Wiederherstellen legt einen **neuen** Stand an;
nichts wird zurückgedreht und nichts gelöscht. Gehört hierher, nicht auf den
Desk: Stände sind Kontrolle, kein Alltag.

**V7.4 Aufräumen-Vorschau und kontrollierte Übernahme.** Eine Frage: *Was
sieht ähnlich aus, was ist alt, und was mache ich damit?* Nach explizitem
Klick zeigt eine rein clientseitige Analyse Ähnlichkeitskandidaten (gleiche
Dienstgrenze + gleicher Benutzer) und lange unveränderte Einträge mit ihrem
Alter; Passwörter werden nie gezeigt. Jeder Fund hat eine eigene, vorbelegte
Checkbox — eine Teilauswahl ist möglich. Ein zweiter, expliziter
Übernehmen-Knopf wendet nur die ausgewählten Funde an: Bei einer
Ähnlichkeitsgruppe bleibt die vollständigere, bei Gleichstand die neuere
Version aktiv (Vergleich nur über vorhandene Felder, nie über Geheimwerte);
jede andere Seite — wie jeder ausgewählte alte Eintrag — wandert in den
Papierkorb (V7.3-Mechanik), **nie** ein Hart-Löschen. Die Anzeige, welcher
Eintrag „bleibt“, folgt derselben Regel wie die Übernahme selbst, nicht der
reinen Anzeigereihenfolge. Hat sich der Tresorinhalt seit der Vorschau
geändert, verweigert die Übernahme sich und verlangt eine neue Vorschau,
statt gegen einen veralteten Stand zu schreiben. Gehört wie V7.3 unter
Einstellungen → Sicherheit: Kontrolle, kein Alltag.

**V7.5 Sicherung.** Eine Frage: *Wie behalte ich eine verschlüsselte Kopie,
und wie hole ich daraus gezielt etwas zurück?* Erstellt eine verschlüsselte
Gesamtsicherung als Datei — nur Chiffretext, verschlüsselte Envelopes und
Metadaten, **nie** Passwörter oder Schlüssel. Beim Einlesen einer
Sicherungsdatei prüft das Parsen zuerst Integrität, Dateigrenzen, Version und
Tresor-Identität, danach zeigt eine Liste Titel und Host jedes enthaltenen
Eintrags — **nie** Passwörter — zur Wahl zwischen zwei Wegen: die ganze
Sicherung wiederherstellen (wie bisher) oder gezielt genau einen Eintrag
übernehmen. Beide Wege legen den Inhalt als **neuen** Stand an
(Forward-Commit, nie zurückgedreht, nie automatisch überschrieben); der
Einzel-Weg weist eine im aktuellen Tresor bereits vorhandene ID ab statt sie
zu überschreiben (dieselbe Regel wie bei V7.3). Zum Wiederherstellen auf einem
anderen Gerät braucht es Master-Passwort oder Recovery-Kit — keine portable
Freigabe. Der Erfolgstext nennt den tatsächlichen Ausgang (Download gestartet
≠ gespeichert).

**V7.6 Sicherheitsprüfung (#279 Punkt 8).** Eine Frage: *Was ist konkret zu
tun?* Statt verstreuter Einzelsignale sammelt eine Karte unter Einstellungen →
Sicherheit alle lokal erkennbaren Funde an einem Ort und bietet pro Fund
„Jetzt bearbeiten" (wechselt auf den Tresor-Tab und öffnet genau diesen
Eintrag). **Doppelverwendung:** exakte Passwort-Gleichheit über
unterschiedliche Dienste hinweg (neue Gruppierung, strenger als der
„reused"-Signal des Health-Scores, das auf Ähnlichkeit per
Levenshtein-Distanz beruht) — gruppiert Einträge, deren Passwort-Wert
byte-identisch ist; der Wert selbst erscheint nie, nur Titel/Host. **Mögliche
Offenlegung:** übernimmt die bereits vorhandenen „leaked"-Treffer aus dem
Health-Score (derselbe k-anonyme HIBP-Bereichsabgleich, keine zusätzliche
Netzwerkabfrage). **Unnötige Rechte:** bewusst **keine** vorgetäuschte
Bewertung — 4AllPass kann ohne echte Scope-Introspektion beim Anbieter nicht
wissen, welche Rechte ein Key tatsächlich braucht; die Karte verweist
stattdessen ehrlich auf den bereits bestehenden, rein informativen
Scope-Hinweis in „API-Schlüssel prüfen" (GitHubs `X-OAuth-Scopes`-Header,
unbewertet angezeigt). Keine neuen Netzwerkaufrufe über das bereits
bestehende HIBP- und Key-Check-Verfahren hinaus.

**V7.7 Kosten/Limits (#279 Punkt 9).** Eine Frage: *Wo sehe ich, was ein
API-Key kostet oder noch an Kontingent hat?* Nicht hier. Die Karte erklärt
knapp, dass Anbieter-Kontingente und Kosten für API-Key-Einträge das
separate, eigenständige Werkzeug TollGate verwaltet (lokaler Prozess,
eigene HTTP-API auf `127.0.0.1:8787`), **nicht** 4AllPass. Ein Button „
TollGate-Dashboard öffnen" ruft `open_tollgate_dashboard` auf — **kein
Netzwerkzugriff aus dem Frontend, nur ein OS-Open-Befehl** (`open`/`start`/
`xdg-open`, identisch zu `open_provider_key_page` aus #278): die feste URL
`http://127.0.0.1:8787` wird im externen Standardbrowser geöffnet, nie im
4AllPass-Fenster, nie per `fetch` aus der Webview. 4AllPass liest TollGates
Limits nicht, zeigt hier keine Live-Daten und sendet nie einen
Tresorschlüssel oder ein Passwort an TollGate. Die
`connect-src`-Beschränkung aus `docs/desktop-network-boundary.md` bleibt
unverändert — dieser Weg braucht keine neue CSP-Erlaubnis, weil er keine
Verbindung aus dem 4AllPass-Prozess oder der Webview herstellt.

> Wireframe: [v7-settings.html](screenshots/v7-settings.html)

---

## V8 Overlays

Import-Review · Share-Datei · Share öffnen · Recovery-Kit.

Jeweils: Titel, Warnung, eine primäre Aktion, Abbrechen. Server sieht keinen Klartext.  
Import-Review zeigt Art (Login / API-Key / Server) · Host oder Provider · User — **kein** Secret.

> Wireframe: [v8-import.html](screenshots/v8-import.html)

---

Neue Fläche? Erst hier eine Nummer, dann Code. Tokens: [`architecture.md`](architecture.md) §3.

## Gemeinsame Bedienbasis / shared foundation (FP-D01)

`frontend/src/networkpunkt.css` is the unchanged portable foundation from PR216,
Git blob `673f4e265c8c46618ba86d9e98f8da09fd0bf107`; `tokens.css` adapts its roles.
4AllPass keeps AP4, existing narrow-window stacking below 820px and 44px touch
controls. The old PR216 blanket 1180px minimum/hidden scrollbars/removal of touch
rules is not adopted. New blocked machine access states remain truthful in DE/EN.
