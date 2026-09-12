import { useEffect, useState, type ReactNode } from "react";
import { useCopy } from "../state/copy-mode.tsx";
import {
  DEFAULT_BROKER_URL,
  connectLocalBroker,
  disconnectLocalBroker,
  getBrokerClientState,
  subscribeBrokerClient,
} from "../lib/local-broker-client.ts";

export function LocalBrokerConnect(): ReactNode {
  const { t } = useCopy();
  const [url, setUrl] = useState(DEFAULT_BROKER_URL);
  const [token, setToken] = useState("");
  const [snap, setSnap] = useState(getBrokerClientState());

  useEffect(() => subscribeBrokerClient(() => setSnap(getBrokerClientState())), []);

  return (
    <section className="card" data-testid="local-broker">
      <h3>{t({ de: "Verbindung für Programme", en: "Program connection" })}</h3>
      <p className="muted">
        {t({ de: "Nur wenn ein Programm auf diesem Rechner fragen soll. Solange der Tresor offen ist, nimmt 4AllPass die Frage entgegen. Der Server sieht kein Passwort.", en: "Only if a program on this computer should ask. While the vault is unlocked, 4AllPass takes the question. The server never sees the password." })}
      </p>
      <label>
        {t({ de: "Adresse", en: "Broker URL" })}
      <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          data-testid="broker-url"
          autoComplete="off"
        />
      </label>
      <label>
        {t({ de: "Koppel-Code", en: "Pairing token" })}
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
            {t({ de: "Trennen", en: "Disconnect" })}
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            data-testid="broker-connect"
            onClick={() => connectLocalBroker(url, token)}
          >
            {t({ de: "Verbinden", en: "Connect" })}
          </button>
        )}
      </div>
      <p className="hint" data-testid="broker-status">
        {snap.status === "off"
          ? t({ de: "aus", en: "off" })
          : snap.status === "live"
            ? t({ de: "verbunden — Tresor hört auf diesem Rechner", en: "live — vault is polling 127.0.0.1" })
            : snap.status === "connecting"
              ? t({ de: "verbindet…", en: "connecting…" })
              : snap.error || t({ de: "Fehler", en: "error" })}
      </p>
    </section>
  );
}
