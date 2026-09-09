# 4AllPass — Wie eine Änderung entsteht

**Stand:** 2026-09-10
**Für:** Daniel + Agents
**Ergänzt:** [`git-workflow.md`](git-workflow.md) (Branches, Commits, Releases)

`git-workflow.md` beschreibt, **wie** ein PR aussieht. Dieses Dokument
beschreibt, **wie die Arbeit dorthin kommt** — und was Daniel beim Mergen tut.

Zum Abhaken beim Arbeiten: [`checklists.md`](checklists.md). Dieses Dokument ist
das Handbuch, das ist die Checkliste.

---

## Teil A — Der Weg einer Änderung

So geht ein Team an eine Funktion. Der Unterschied zum Solo-Drauflosbauen liegt
fast vollständig in den Schritten **vor** der ersten Codezeile.

### 1. Die Frage klären, nicht die Aufgabe annehmen

Welches Problem, für wen, und woran merkt man, dass es weg ist? „Wiederherstellen
bauen" ist keine Frage. „Ein Nutzer löscht aus Versehen einen Eintrag und kommt
nicht mehr ran" ist eine.

### 2. Nachsehen, was schon entschieden ist

`docs/`, besonders `architecture/adr/` und `security-boundary.md`. Sehr oft ist
die Frage schon beantwortet.

> Beispiel 2026-09-09: „Brauchen wir Mobile?" — ADR-009 stand längst da,
> inklusive der eigentlichen Erkenntnis (*die Lücke ist OS-Autofill, nicht ein
> neuer Envelope*). Zwei Minuten Lesen statt einer Stunde Diskussion.

### 3. Schneiden

Die kleinste Scheibe, die **für sich** Sinn ergibt und **für sich** mergebar
ist. Nicht die kleinste, die technisch geht.

Ein Rundumschlag über 21 Dateien endet im stundenlangen Reparieren. Eine
Scheibe, die man in einem Rutsch prüfen kann, endet in einem Merge.

> Beispiel: Sprachumschalter. Schritt 1 war die Anzeigefunktion — zwei Dateien,
> 349 Texte kippen automatisch mit. Schritt 2 sind 136 handgeschriebene
> Stellen, in Häppchen pro Bereich. Zusammen wäre es ein unprüfbarer Klumpen
> gewesen.

### 4. Bei Architektur-Fragen: erst ADR, dann Code

Wenn eine Entscheidung länger hält als der PR — Protokoll, Schlüssel,
Vertrauensgrenzen, neue Abhängigkeit — dann zuerst ein ADR nach dem Muster in
`architecture/adr/`. Auch wenn das Ergebnis „nicht jetzt bauen" ist. Gerade
dann.

Neue Oberfläche? Erst eine Nummer in `ui-map.md`, dann Code.

### 5. Bauen — Tests prüfen die Eigenschaft, nicht die Zeilen

Ein guter Test überlebt ein Refactoring und wird rot, wenn die **Zusicherung**
bricht. „Lesen einer alten Version verschiebt den Rollback-Schutz nicht" ist
eine Eigenschaft. „Funktion X ruft Funktion Y auf" ist keine.

### 6. Wirklich ausprobieren

Grüne Tests sind kein Beweis, dass die Funktion funktioniert. Den Weg im echten
Browser oder in der App gehen. Ein Screenshot ist keine Prüfung.

> Beispiel: Der Angriff aus #201 wurde nachgebaut — Tresor mit gestohlenem
> Token zerstört, dann wiederhergestellt. Erst danach war die Aussage belegt.

### 7. Docs im selben PR

Wenn sich ändert, **was das Produkt zusichert**, ändert sich `docs/` im selben
PR. Specs gewinnen gegen PR-Text; ein Dokument, das dem Code hinterherhinkt,
ist schlimmer als keines.

### 8. Der PR sagt auch, was er **nicht** tut

Der ehrlichste Abschnitt ist meist „Was hier noch nicht drin ist". Er verhindert,
dass jemand später eine Lücke für einen Bug hält — oder ein halbes Feature für
ein ganzes.

### Wenn eine Regel dauernd vergessen wird: Prüfskript statt Doku

Eine Regel, die niemand ausführt, hält niemand ein. Muster im Repo:
`scripts/check-module-boundaries.mjs`, `scripts/check-copy-language.mjs` —
beide laufen bei `npm test`.

Bei Altlasten als **Sperre mit Budget** bauen, nicht als Wand: Bestehendes ist
erlaubt, Neues wird rot, und wer aufräumt, senkt das Budget. So bleibt die
Aufräumarbeit in kleinen Schritten möglich.

---

## Teil B — Was Daniel beim Review macht

Vier Fragen, in dieser Reihenfolge. Der Code kommt zuletzt.

1. **Stimmt die Behauptung?** Sagt der PR-Text dasselbe wie der Diff? Bei
   Sicherheit: sagt er dasselbe wie `security-boundary.md`? Eine Übertreibung
   ist ein Defekt, auch wenn der Code fast das Gemeinte tut.
2. **Ist es eine Scheibe?** Ein Thema, prüfbar in einem Sitzen. Wenn nicht:
   zurückgeben mit einem Vorschlag, wo man schneidet.
3. **Was fehlt?** Steht der „was hier nicht drin ist"-Abschnitt drin und stimmt
   er? Gibt es einen Test, der rot würde, wenn jemand die Änderung zurückdreht?
4. **Dann erst der Code.**

Bei Krypto, CAS, Broker und allem, was die Vertrauensgrenze berührt: langsam
lesen, und `docs/security-boundary.md` daneben.

---

## Teil C — Mergen, auch bei mehreren offenen PRs

**Reihenfolge:**

1. **Reparaturen vor Funktionen.** Ein PR, der kaputte Tests repariert, geht
   zuerst — sonst stolpern alle anderen über denselben Fehler und man sucht
   dreimal dasselbe.
2. **Abhängigkeiten stehen im PR-Text.** Wer weiß, dass sein PR nach einem
   anderen kommen muss, schreibt es hin. Nicht der Reviewer soll es raten.
3. **Unabhängige PRs in beliebiger Reihenfolge**, aber einer nach dem anderen —
   nach jedem Merge CI grün abwarten, bevor der nächste geht.
4. **Nach dem Merge rebasen**, nicht mergen. `main` bleibt linear.

**Faustregel gegen Stau:** Mehr als drei offene PRs bedeuten fast immer, dass
zu viel angefangen und zu wenig zu Ende gebracht wurde. Dann erst leeren, dann
Neues anfangen.

**Nach dem Merge:** Was eine dauerhafte Entscheidung war, wandert ins
Entscheidungslog in Notion. Code lebt in GitHub, das *Warum* in Notion.

---

## Für Desktop und Mobile

Dieselben Regeln, mit einer Ergänzung: **eine Änderung, alle Clients.**

- Krypto und Snapshots bleiben plattformneutral (ADR-009). Kein Fork von
  `packages/crypto` — für kein Betriebssystem.
- Was in der Web-Oberfläche liegt, gilt automatisch für die Desktop-App: sie
  lädt denselben Code. Nicht doppelt bauen.
- Was das Betriebssystem braucht (Autofill, Passkey-Provider), ist ein eigener
  Client und ein eigenes ADR — nicht ein Anbau an einen UI-PR.
- Sprache immer DE und EN planen, angezeigt wird eine (`ui-map.md`).
