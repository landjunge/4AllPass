import { useEffect, useMemo, useState, type ReactNode } from "react";
import { copySecret } from "../lib/clipboard.ts";
import {
  getBrokerClientState,
  subscribeBrokerClient,
} from "../lib/local-broker-client.ts";
import { n8nHttpRecipe } from "../lib/n8n-http.ts";

export function N8nHttpRecipe(): ReactNode {
  const [snap, setSnap] = useState(getBrokerClientState());
  const [copied, setCopied] = useState<"body" | "curl" | null>(null);

  useEffect(() => subscribeBrokerClient(() => setSnap(getBrokerClientState())), []);

  const recipe = useMemo(() => {
    try {
      return n8nHttpRecipe(snap.url || "http://127.0.0.1:8788", snap.token);
    } catch {
      return n8nHttpRecipe("http://127.0.0.1:8788", snap.token);
    }
  }, [snap.url, snap.token]);

  function copy(kind: "body" | "curl"): void {
    const text = kind === "body" ? recipe.jsonText : recipe.curl;
    void copySecret(text)
      .then(() => setCopied(kind))
      .catch(() => setCopied(null));
  }

  return (
    <section className="card" data-testid="n8n-http">
      <h3>n8n auf diesem Rechner / n8n HTTP Request</h3>
      <p className="muted">
        Die meisten Nutzer brauchen das nicht. Nur wenn n8n auf diesem Rechner nach einem Login
        fragen soll: HTTP Request, POST, JSON-Body, kein Origin-Header. Kein Marketplace-Node. /
        Most people can skip this. Only if n8n on this computer should ask: HTTP Request, POST,
        JSON body, no Origin header. Not a marketplace node.
      </p>
      <p className="hint">
        Method <code>POST</code> · URL <code data-testid="n8n-http-url">{recipe.url}</code>
      </p>
      <p className="muted small">JSON body (kein Pairing-Token, kein Secret)</p>
      <pre className="mono block" data-testid="n8n-http-body">
        {JSON.stringify(recipe.jsonBody, null, 2)}
      </pre>
      <p className="muted small">curl (Authorization nur in der Kopie / only in the copy)</p>
      <pre className="mono block" data-testid="n8n-http-curl">
        {recipe.curlDisplay}
      </pre>
      <div className="actions">
        <button type="button" data-testid="n8n-copy-body" onClick={() => copy("body")}>
          JSON kopieren / Copy JSON
        </button>
        <button type="button" className="primary" data-testid="n8n-copy-curl" onClick={() => copy("curl")}>
          curl kopieren / Copy curl
        </button>
      </div>
      {copied ? (
        <p className="hint" data-testid="n8n-copied">
          {copied === "body" ? "JSON copied." : "curl copied (pairing token included)."} Clipboard
          overwrite after 30s if it still matches.
        </p>
      ) : null}
      <p className="hint" data-testid="n8n-docker-note">
        {recipe.dockerNote}
      </p>
    </section>
  );
}
