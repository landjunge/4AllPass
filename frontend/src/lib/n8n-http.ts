/**
 * Copy-paste recipe for n8n's HTTP Request node.
 * Not a marketplace node. Talks to the loopback relay, not FastAPI.
 * The JSON body never contains the pairing token or a vault secret.
 */

export const N8N_HTTP_TTL_SECONDS = 600;
export const N8N_HTTP_PLACEHOLDER_TOKEN = "PAIRING_TOKEN";

export const N8N_DOCKER_NOTE =
  "n8n in Docker cannot reach 127.0.0.1 on the host. Use host.docker.internal from the container; the broker stays on the host. / n8n in Docker erreicht 127.0.0.1 auf dem Host nicht. Im Container host.docker.internal; der Broker bleibt auf dem Host.";

export interface N8nHttpBody {
  application: "n8n";
  provider: "GitHub";
  credential: "personal";
  scope: ["repository.read"];
  ttl: number;
}

export interface N8nHttpRecipe {
  method: "POST";
  url: string;
  jsonBody: N8nHttpBody;
  jsonText: string;
  curl: string;
  curlDisplay: string;
  dockerNote: string;
}

function loopbackOrigin(raw: string): string {
  const trimmed = raw.trim() || "http://127.0.0.1:8788";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("broker URL is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("broker URL must be http(s) on loopback");
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("broker URL must be 127.0.0.1 (n8n talks to the local app, not FastAPI)");
  }
  parsed.hostname = "127.0.0.1";
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = "";
  parsed.username = "";
  parsed.password = "";
  return parsed.origin;
}

function curlFor(url: string, token: string, jsonText: string): string {
  return [
    `curl -sS -X POST '${url}/v1/access/request'`,
    `  -H 'Authorization: Bearer ${token}'`,
    `  -H 'Content-Type: application/json'`,
    `  --data '${jsonText}'`,
  ].join(" \\\n");
}

export function n8nHttpRecipe(brokerUrl: string, pairingToken: string): N8nHttpRecipe {
  const origin = loopbackOrigin(brokerUrl);
  const token = pairingToken.trim() || N8N_HTTP_PLACEHOLDER_TOKEN;
  const jsonBody: N8nHttpBody = {
    application: "n8n",
    provider: "GitHub",
    credential: "personal",
    scope: ["repository.read"],
    ttl: N8N_HTTP_TTL_SECONDS,
  };
  const jsonText = JSON.stringify(jsonBody);
  return {
    method: "POST",
    url: `${origin}/v1/access/request`,
    jsonBody,
    jsonText,
    curl: curlFor(origin, token, jsonText),
    curlDisplay: curlFor(origin, "••••", jsonText),
    dockerNote: N8N_DOCKER_NOTE,
  };
}
