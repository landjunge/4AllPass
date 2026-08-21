import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(dir, "n8n-github-read.workflow.json"), "utf8");

test("n8n workflow talks to loopback, not FastAPI, and holds no secret", () => {
  const wf = JSON.parse(raw);
  const node = wf.nodes[0];
  assert.equal(node.type, "n8n-nodes-base.httpRequest");
  assert.equal(node.parameters.method, "POST");
  assert.equal(node.parameters.url, "http://127.0.0.1:8788/v1/access/request");
  const headers = node.parameters.headerParameters.parameters;
  assert.equal(
    headers.some((h) => h.name === "Origin"),
    false,
  );
  assert.match(
    headers.find((h) => h.name === "Authorization").value,
    /FOURALLPASS_BROKER_TOKEN/,
  );
  const body = JSON.parse(node.parameters.jsonBody);
  assert.equal(body.application, "n8n");
  assert.deepEqual(body.scope, ["repository.read"]);
  assert.equal(raw.includes("ghp_"), false);
  assert.equal(raw.includes("access_token"), false);
  assert.equal(raw.includes("localhost"), false);
});
