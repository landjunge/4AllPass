# UI-Test-Suite — Design-Protokoll

Stand: 2026-09-05. Zusatz für Grok Build. **Nur wenn Daniel ihn explizit dazugibt.** Kein Dauerbetrieb, kein CI, kein Scheduler.

Auslöser: „UI-Test-Suite“, „Design-Protokoll“, oder dieser Prompt im Chat.

## 1. Zweck

Jede sichtbare Fläche der **laufenden** App wie ein Mensch: Maus, Tastatur, normale Geschwindigkeit, Fenster sichtbar.

Nicht: Crypto anfassen. Nicht: Daniels 400er-Tresor. Isoliertes Data-Dir, nicht Port 8788.

## 2. Was schon festliegt (nicht neu entscheiden)

| Thema | Stand |
|---|---|
| Desk-Richtung | Gnom-Hub **Desk**: `#121316`, graue Chrome, Silber `#6b7280`, Buttons `3px`, Schrift system-ui ~12px |
| Site-Grün | Marketing only, kein App-Primary |
| Laufende App | Magpie in `tokens.css` — Retoken nur nach Freigabe, eigenes UI-PR |
| Logo | 4AllPass (Elster + Schlüssel) |
| Erster Tab | Tresor |
| Listen | kein Passwort in der Zeile |
| Allow v1 | kopiert Roh-Secret — nicht „bleibt im Tresor“ |
| Eve / Taste S | Nachzügler, opt-in, **nicht** in diesem Lauf |

Mockup der Richtung: `gnom-hub-v1/docs/4allpass-desk-direction.html`.

## 3. Ablauf

1. Headed Playwright, `slowMo`, Maus + `pressSequentially`. Befehl: `cd frontend && npm run test:e2e:user-watch`.
2. Reihenfolge der Flächen: `docs/ui-map.md` V0 → V8. Eine Fläche nach der anderen.
3. Pro Element die Checkliste in §5.
4. **Mangel, der unter Missverständnis / Technik fällt:** selbst korrigieren, denselben Schritt nochmal fahren, erst dann weiter.
5. **Geschmack:** stoppen, Screenshot, ein Satz, warten. Nicht raten.

## 4. Persona

Jemand, der Passwörter nicht mehr im Kopf und nicht in einer Notiz will. Kein Crypto-Vokabular ohne `?` oder einen Satz daneben.

## 5. Checkliste pro Element

| Prüfen | Auto-Fix | Pause (Daniel) |
|---|---|---|
| Info fehlt für den Durchschnitt | ja, `?` oder ein Satz | — |
| Fachwort ohne Erklärung | ja | — |
| Widerspruch zu `ui-map` / Allow-Ehrlichkeit / zwei Passwörter | ja | — |
| Scrollbar tot, Overflow ohne Ellipsis, Klick tot, Tab-Reihenfolge | ja | — |
| „Sieht komisch aus“, Dichte, Iconfarbe, wie viel Text genug ist | — | Screenshot |
| APIs/Provider in Registrierkarten teilen | — | nur nach Freigabe |
| Magpie → Gnom-Grau umfärben | — | nur nach Freigabe |

## 6. Missverständnis (kurz, damit nicht jedes Feld fragt)

Gilt als Missverständnis — **korrigieren, nicht fragen** — wenn ein Durchschnittsmensch glauben würde:

1. Konto-Passwort und Tresor-Passwort seien dasselbe.
2. Nach **Allow** bleibe das Secret im Tresor (v1 kopiert roh).
3. Ruhemodus, Bildschirmsperre oder Browser-Wechsel sperre den Tresor (tut nur **Sperren**).
4. Der Server könne Einträge lesen.
5. Deinstallieren lösche den Tresor.
6. Das Passwort stehe in der Liste.
7. `revision` / CAS / Vault-Key auf dem Desk sei Alltag.
8. Die Produktseite `4allpass.netzwerkpunkt.de` sei der Tresor.
9. Port 8788 mit `app.local` sei die Desk-App.

Alles andere zu Ton, Menge, Farbe, Radius, Icons: **Pause**.

## 7. Layout (auto, solange messbar)

- Karten gleiche Breite in einer Reihe.
- Zeilenlänge gleichmäßig; lange Namen `ellipsis` + `title` mit Vollname.
- Kästchen so klein wie der Inhalt plus Padding der Nachbarn — nicht aufblasen.
- Unter 820px stapeln die Spalten.

## 8. Nachzügler — Eve (nicht bauen, bis Daniel „Eve an“ sagt)

- Icon ganz rechts im Header, 1px Rahmen, leichte Puls-Rahmenfarbe.
- An: Maus über Feld, Taste **S** → gesprochene Erklärung.
- Erstes An: kurze Bedien-Erklärung.
- Aus: keine Wirkung, kein Hover-Effekt.

## 9. Beweis

Pro Fläche: headed Lauf oder Video unter `frontend/test-results/`. Screenshot allein zählt nicht. Nach Auto-Fix denselben Weg noch einmal.

## 10. Nicht

CI, Cron, Magpie still umfärben, Eve ohne Opt-in, Provider-Karten ohne Freigabe, echten Tresor, GitHub-Demo wenn der Auftrag „kein GitHub“ sagt.
