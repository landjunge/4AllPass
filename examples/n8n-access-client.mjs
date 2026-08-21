#!/usr/bin/env npx tsx
/**
 * Stand-in for an n8n HTTP Request / Code node.
 * Not a marketplace node. Uses @4allpass/access against the loopback relay,
 * not FastAPI.
 *
 *   FOURALLPASS_BROKER_TOKEN=… npx tsx examples/n8n-access-client.mjs
 *   npx tsx examples/n8n-access-client.mjs delete
 *   npx tsx examples/n8n-access-client.mjs unknown
 */
import { GitHub, fourAllPass, redactGrant } from "@4allpass/access";

const kind = process.argv[2] || "read";

const client = fourAllPass({
  application: kind === "unknown" ? "malicious-agent" : "n8n",
});

const capability =
  kind === "delete" ? GitHub.repositoryDelete : GitHub.repositoryRead;

if (kind !== "read" && kind !== "delete" && kind !== "unknown") {
  console.error("use: read | delete | unknown");
  process.exit(1);
}

try {
  const result = await client.request({
    provider: GitHub.provider,
    capability,
    ttl: 15,
  });
  console.log(JSON.stringify(redactGrant(result), null, 2));
  if (result.status !== "approved") process.exit(2);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
