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
      <h3>Loopback broker</h3>
      <p className="muted">
        Optional. Default off. A foreign process (n8n HTTP Request) can POST{" "}
        <code>/v1/access/request</code> to 127.0.0.1 after you paste the pairing token. FastAPI is
        not this process. Browser Origin on the grant path is rejected. App name is still a string.
      </p>
      <label>
        Broker URL
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          data-testid="broker-url"
          autoComplete="off"
        />
      </label>
      <label>
        Pairing token
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
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            data-testid="broker-connect"
            onClick={() => connectLocalBroker(url, token)}
          >
            Connect
          </button>
        )}
      </div>
      <p className="hint" data-testid="broker-status">
        {snap.status === "off"
          ? "off"
          : snap.status === "live"
            ? "live — vault is polling 127.0.0.1"
            : snap.status === "connecting"
              ? "connecting…"
              : snap.error || "error"}
      </p>
    </section>
  );
}
