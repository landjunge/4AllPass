import { useEffect, useState, type ReactNode } from "react";
import {
  DEFAULT_BROKER_URL,
  connectLocalBroker,
  disconnectLocalBroker,
  getBrokerClientState,
  subscribeBrokerClient,
} from "../lib/local-broker-client.ts";

export function LocalBrokerConnect(): ReactNode {
  const [url, setUrl] = useState(DEFAULT_BROKER_URL);
  const [token, setToken] = useState("");
  const [snap, setSnap] = useState(getBrokerClientState());

  useEffect(() => subscribeBrokerClient(() => setSnap(getBrokerClientState())), []);

  return (
    <section className="card" data-testid="local-broker">
      <h3>Verbindung für Programme / Loopback broker</h3>
      <p className="muted">
        Nur wenn ein Programm auf diesem Rechner fragen soll. Solange der Tresor offen ist, nimmt
        4AllPass die Frage entgegen. Der Server sieht kein Passwort. / Only if a program on this
        computer should ask. While the vault is unlocked, 4AllPass takes the question. The server
        never sees the password.
      </p>
      <label>
        Adresse / Broker URL
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          data-testid="broker-url"
          autoComplete="off"
        />
      </label>
      <label>
        Koppel-Code / Pairing token
        <input
          value={token}
          onChange={(event) => setToken(event.target.value)}
          data-testid="broker-token"
          autoComplete="off"
        />
      </label>
      <div className="actions">
        {snap.status === "live" || snap.status === "connecting" ? (
          <button type="button" data-testid="broker-disconnect" onClick={() => disconnectLocalBroker()}>
            Trennen / Disconnect
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            data-testid="broker-connect"
            onClick={() => connectLocalBroker(url, token)}
          >
            Verbinden / Connect
          </button>
        )}
      </div>
      <p className="hint" data-testid="broker-status">
        {snap.status === "off"
          ? "aus / off"
          : snap.status === "live"
            ? "verbunden — Tresor hört auf diesem Rechner / live — vault is polling 127.0.0.1"
            : snap.status === "connecting"
              ? "verbindet… / connecting…"
              : snap.error || "Fehler / error"}
      </p>
    </section>
  );
}
