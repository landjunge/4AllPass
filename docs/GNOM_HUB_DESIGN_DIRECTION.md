# Design direction — follow Gnom-Hub v1

Stand: 2026-09-05. Auftrag: *„das design von gnom-hub-v1 anschauen die richtung bitte und doc und notion“*.

Vollständige Tokens und Begründung: [gnom-hub-v1 `docs/DESIGN_DIRECTION.md`](https://github.com/landjunge/gnom-hub-v1/blob/main/docs/DESIGN_DIRECTION.md) (lokal: `~/gnom-hub-v1/docs/DESIGN_DIRECTION.md`).

## Was gilt wo

| Fläche | Palette | Datei |
|---|---|---|
| 4AllPass Tresor **heute** | Golden Magpie | `frontend/src/tokens.css` |
| Docs, Live-Watch, gemeinsame Desk-Chrome | Gnom-Hub **Desk** | `#121316` / graue Chrome / Silber `#6b7280` — **nicht** Site-Grün |
| Logo | 4AllPass (Elster + goldener Schlüssel) | niemals Gnom-Wortmarke auf dem Tresor |

`4allpass-ui` sagt weiter: Magpie nicht in einem Crypto/Security-PR mit Gnom-Grau mischen. Richtung heißt: **nächstes bewusstes UI-PR** darf die Vault-Chrome an Gnom-Hub angleichen, wenn Daniel das in dem PR bestätigt. Bis dahin Magpie laufen lassen.

## Live-User-Watch (kein echter 400er-Tresor)

Playwright headed, langsam, Maus + Tastatur, eigenes leeres Data-Dir:

```sh
cd ~/4AllPass/frontend
npm run test:e2e:user-watch
```

Fenster bleibt offen (`slowMo` ~400 ms, `pressSequentially`). Video unter `frontend/test-results/`. Dummy-Passwort der Suite ist **nicht** Daniels Vault.

Daniels Desk-App: nur `scripts/open-desktop.sh --desktop`. Port 8788 + `app.local` ist **nicht** sein Tresor.

Zwei Tresore: Mensch (~400 Einträge, Desk) vs. KI/Tests (isoliertes Data-Dir).
