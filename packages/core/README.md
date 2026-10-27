# `@4allpass/core`

Laufzeitneutrale Zugriffsregeln, Freigabemetadaten und Audit.

**Einordnung der alten API-Beschreibung:** Der aktuelle Maschinenweg ist ohne
geschützten Produktionshost gesperrt; die unten beschriebene frühere
Materialübergabe ist kein nutzbarer Rohgeheimnis-Umgehungsweg.
Siehe [aktuelle Grenze](../../docs/PROTECTED-ACCESS-20261018.md).

- Kein React, DOM, FastAPI, Tauri oder BroadcastChannel.
- `evaluatePolicy` kann `allow` im Sinn von **für menschliche Zustimmung geeignet** zurückgeben; keine automatische Übergabe.
- `AccessGrant` enthält kein Geheimnis. In der früheren PWA-/Desktop-API fügte die UI nach Allow `material` hinzu.
- `AccessRequest.application` bleibt im Übertragungsformat eine Zeichenfolge (`n8n`), damit der Loopback-Broker unverändert bleibt.
