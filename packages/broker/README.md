# `@4allpass/broker`

Aktueller Quellstand: Maschinenanfragen werden mit `handoff_unavailable`
abgewiesen; Rohmaterial wird weder in die Warteschlange aufgenommen noch
weitergereicht. Historische Nutzungsbeschreibungen unten ermöglichen keinen
geschützten Produktivbetrieb. Siehe ../../docs/PROTECTED-ACCESS-20261018.md.

**Entwicklungsrelay**, nicht der Produktbroker.

| Aufruf | Prozess | Port |
| --- | --- | --- |
| `npm run app` / `4AllPass.app` | Sidecar `backend/app/broker.py` | `:8788`, gleicher Ursprung |
| `npm run broker`, nur Vite | dieses Paket | `:8787` |

Entschlüsselt niemals Schlüsselhüllen und erzeugt keine GitHub-/Stripe-Tokens.
Ein Kopplungstoken ist erforderlich. Browser-`Origin` auf dem Freigabeweg wird
verweigert. Regeln verbleiben in `@4allpass/core` innerhalb der entsperrten UI.

`@4allpass/core` hier nicht importieren; das würde die menschliche Zustimmung überspringen.
