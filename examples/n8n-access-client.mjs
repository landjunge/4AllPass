#!/usr/bin/env node
/**
 * Stand-in for an n8n HTTP Request node.
 * Not a marketplace node. Talks to the local loopback broker, not FastAPI.
 *
 *   FOURALLPASS_BROKER_TOKEN=… node examples/n8n-access-client.mjs
 *   node examples/n8n-access-client.mjs delete
 *   node examples/n8n-access-client.mjs unknown
 */
const base = (process.env.FOURALLPASS_BROKER_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const token = process.env.FOURALLPASS_BROKER_TOKEN || "";
const kind = process.argv[2] || "read";

const bodies = {
  read: {
    application: "n8n",
    provider: "GitHub",
    credential: "personal",
    scope: ["repository.read"],
    ttl: 15,
  },
  delete: {
    application: "n8n",
    provider: "GitHub",
    credential: "personal",
    scope: ["repository.delete"],
    ttl: 15,
  },
  unknown: {
    application: "malicious-agent",
    provider: "GitHub",
    credential: "personal",
    scope: ["repository.read"],
    ttl: 15,
  },
};

if (!token) {
  console.error("FOURALLPASS_BROKER_TOKEN is required");
  process.exit(1);
}
const body = bodies[kind];
if (!body) {
  console.error("use: read | delete | unknown");
  process.exit(1);
}

const res = await fetch(`${base}/v1/access/request`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});
const json = await res.json();
if (json.access_token) json.access_token = "(redacted in this client)";
console.log(JSON.stringify(json, null, 2));
if (json.status !== "approved") process.exit(2);
