# Architekturdokumentation

**Status:** Vision und Architekturentscheidungen; keine Umsetzungsfreigabe.
**Reihenfolge der Programmumsetzung bleibt:** [`../product-maturity.md`](../product-maturity.md) v3.

| Datei | Bedeutung |
| --- | --- |
| [`future-architecture.md`](future-architecture.md) | Langfristige Vision, ehrlicher Abgleich zum Code und Architekturphasen |
| [`../security-boundary.md`](../security-boundary.md) | Wer Klartext/VK sehen darf; tatsächlich laufende Umsetzung |
| [`../specs/maip-v0.1.md`](../specs/maip-v0.1.md) | Gemeinsame Agentenidentität, experimentell und nicht umgesetzt |
| [`agent-access.md`](agent-access.md) | Spätere Zugangsdatenverwendung; Fähigkeiten statt Tresor, unbeaufsichtigter/Roboterbetrieb dort zurückgestellt |
| [`../specs/maip-v0.1.md`](../specs/maip-v0.1.md) | Experimentelles Agentenidentitätsprofil |
| [`../vault-protocol.md`](../vault-protocol.md) | Speichervertrag zwischen Client und Server |
| [`../vault-storage.md`](../vault-storage.md) | Lokale, selbst gehostete oder verwaltete Ablage |
| [`future-compatibility-check.md`](future-compatibility-check.md) | PASS / WARNING / BLOCK für spätere Agenten |
| [`adr/`](adr/) | Entscheidungen; Status `accepted` nur, wenn laufender Code ihn bereits erfüllt |

Die derzeit maßgeblichen Spezifikationen bleiben an ihren Stellen:
[`../crypto-protocol.md`](../crypto-protocol.md),
[`../security-boundary.md`](../security-boundary.md),
[`../vault-revision.md`](../vault-revision.md),
[`../team-mode.md`](../team-mode.md), nur zur Prüfung,
[`../post-quantum-roadmap.md`](../post-quantum-roadmap.md).

Bei Widerspruch zu `packages/crypto` haben Bibliothek und ihre Tests Vorrang.
