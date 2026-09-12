# Checklisten

**Stand:** 2026-09-10

Zum Abhaken, nicht zum Lesen. Das *Warum* steht in
[`dev-workflow.md`](dev-workflow.md).

⛔ = Abbruch. Nicht weitermachen, nicht „später fixen".

---

## 1. Webseite

Für `site/`, netzwerkpunkt.de, Workshop-Seiten, Produktseiten.

### Vor dem Bauen

- [ ] Wer liest das, und was soll er danach tun?
- [ ] Jede Behauptung belegbar? ⛔ **Nichts behaupten, was der Code nicht tut**
- [ ] Zahlen und Daten geprüft, nicht geschätzt
- [ ] Zielseite existiert? ⛔ **Kein Link auf eine Seite, wo das Beworbene fehlt**

### Vor dem Veröffentlichen

- [ ] Deutsch **und** Englisch
- [ ] Auf dem Handy angesehen, nicht nur schmal gezogen
- [ ] Alle Links geklickt — auch die im Footer
- [ ] Bilder haben Alt-Text
- [ ] Keine privaten Notion-Links, keine internen Pfade, keine Tokens ⛔
- [ ] Rechtliches da, wo es hingehört (Impressum, Datenschutz)
- [ ] Richtiges Ziel? netzwerkpunkt.de ≠ github.io ≠ Subdomain ⛔

### Nach dem Veröffentlichen

- [ ] Seite im echten Browser aufgerufen, nicht nur lokal
- [ ] Vorschaubild beim Teilen geprüft (OG)
- [ ] Was dauerhaft gilt → Notion-Entscheidungslog

---

## 2. App

Für 4AllPass: Web, Desktop, später Mobile.

### Vor der ersten Codezeile

- [ ] Problem in einem Satz, aus Nutzersicht
- [ ] `docs/` gelesen — gibt es schon ein ADR dazu?
- [ ] Berührt es Krypto, CAS, Vertrauensgrenze oder eine neue Abhängigkeit?
      → ⛔ **erst ADR, dann Code**
- [ ] Neue Oberfläche? → ⛔ **erst Nummer in `ui-map.md`**
- [ ] In eine Scheibe geschnitten, die für sich mergebar ist
- [ ] Bestehende Komponenten geprüft — wiederverwenden statt neu bauen

### Beim Bauen

- [ ] Keine neuen Abhängigkeiten (sonst ADR)
- [ ] Texte durch `t({ de, en })` — nie selbst „DE / EN" schreiben
- [ ] Tests prüfen die **Zusicherung**, nicht die Zeilen
- [ ] Bei Sicherheit: ein Test, der rot wird, wenn jemand die Änderung zurückdreht

### Vor dem Commit

- [ ] `npm test` grün (enthält die Prüfskripte)
- [ ] Typecheck grün
- [ ] **Den Weg wirklich gegangen** — echter Browser oder App ⛔
- [ ] Keine Secrets im Diff ⛔
- [ ] Keine Passwörter in Listen, Logs oder Konsole ⛔
- [ ] Ändert sich eine Zusicherung? → `docs/` im **selben** Commit
- [ ] Desktop-App mitgedacht (lädt denselben Code)

### Im PR

- [ ] Ein Thema
- [ ] Titel sagt, was sich ändert
- [ ] Abschnitt „was hier **nicht** drin ist"
- [ ] Abhängigkeit von anderen PRs benannt
- [ ] Sicherheitsgrenze: stimmt der Text mit `security-boundary.md` überein? ⛔

### Vor dem Merge (Daniel)

- [ ] Stimmt die Behauptung mit dem Diff überein? ⛔
- [ ] Ist es eine Scheibe?
- [ ] Was fehlt — und steht das drin?
- [ ] Erst dann den Code lesen
- [ ] Reparaturen vor Funktionen
- [ ] CI grün, einer nach dem anderen
- [ ] Mehr als drei offene PRs? → erst leeren, nichts Neues anfangen

### Nach dem Merge

- [ ] Dauerhafte Entscheidung → Notion-Entscheidungslog
- [ ] Branch gelöscht
