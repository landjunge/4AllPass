# `@4allpass/access`

**Aktueller Quellstand vom 18.10.2026:** Maschinenzugriff ist ohne geschützten
Nutzungsweg gesperrt. Alte `approved`-/`access_token`-Antworten werden abgewiesen,
nicht an den Aufrufer zurückgegeben. Historische Beispiele unten beschreiben die
alte API und dürfen nicht zur Umgehung über Rohgeheimnisse verwendet werden.
Kein produktiver vermittelter Dienst ist angeschlossen.
Siehe ../../docs/PROTECTED-ACCESS-20261018.md.

Kleines Node-SDK für Agenten: `fourAllPass.request({ provider, capability, ttl })`.
Spricht mit dem lokalen Relay auf `127.0.0.1`, nicht mit FastAPI. FastAPI erzeugt
keine Tokens. Dies ist kein n8n-Marktplatz-Node.

```ts
import { fourAllPass, GitHub, redactGrant } from "@4allpass/access";

const client = fourAllPass({
  token: process.env.FOURALLPASS_BROKER_TOKEN,
  application: "n8n",
});

const result = await client.request({
  provider: GitHub.provider,
  capability: GitHub.repositoryRead,
  ttl: 15,
});

console.log(redactGrant(result));
```

Kopplungstoken: `FOURALLPASS_BROKER_TOKEN`, im Datenverzeichnis unter `broker.token`
oder im Zugriffsreiter. Tresorpasswort und Vault Key werden hier niemals
übergeben. Datenverzeichnis: macOS `~/Library/Application Support/4AllPass/`,
Windows `%APPDATA%\4AllPass\`, Linux `~/.local/share/4allpass/`.

| Regel | Verhalten dieses Pakets |
| --- | --- |
| Nur Loopback | URL muss `127.0.0.1` oder `localhost` sein. Entfernte Hosts führen zu einem Fehler. |
| Kein `Origin` | Browserzugriff auf den Freigabeweg ergibt 403. Verwendung aus Node/n8n-Code, nicht aus Webseiten. |
| Keine Entschlüsselung | Regeln und Klartext verbleiben in der entsperrten Anwendung. |
| Unbekannte Anwendung | Anfrage wird weitergereicht; der Tresor verweigert. Das SDK erzeugt kein Vertrauen. |
| Protokolle | `redactGrant` / `redactSecrets` verwenden; `accessToken` nicht ausgeben. |

Die GitHub-Fähigkeiten entsprechen der Tresorvorlage (`repository.read` / `write`,
`issue.read`) und dem besonders riskanten `repository.delete`. Dies ist keine
vollständige Liste der GitHub-REST-Berechtigungen.
