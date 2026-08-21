import assert from "node:assert/strict";
import { test } from "node:test";

import {
  N8N_HTTP_PLACEHOLDER_TOKEN,
  N8N_HTTP_TTL_SECONDS,
  n8nHttpRecipe,
} from "./n8n-http.ts";

const TOKEN = "pairing-token-test-value";

test("n8n HTTP recipe is POST JSON to loopback with no Origin and no secret", () => {
  const recipe = n8nHttpRecipe("http://127.0.0.1:8788", TOKEN);
  assert.equal(recipe.method, "POST");
  assert.equal(recipe.url, "http://127.0.0.1:8788/v1/access/request");
  assert.equal(recipe.jsonBody.application, "n8n");
  assert.deepEqual(recipe.jsonBody.scope, ["repository.read"]);
  assert.equal(recipe.jsonBody.ttl, N8N_HTTP_TTL_SECONDS);
  assert.equal(recipe.jsonText.includes(TOKEN), false);
  assert.equal(recipe.jsonText.includes("ghp_"), false);
  assert.equal(recipe.jsonText.includes("Origin"), false);
  assert.match(recipe.curl, /Authorization: Bearer pairing-token-test-value/);
  assert.equal(recipe.curl.includes("Origin"), false);
  assert.equal(recipe.curl.includes("ghp_"), false);
  assert.equal(recipe.curlDisplay.includes(TOKEN), false);
  assert.match(recipe.curlDisplay, /Authorization: Bearer ••••/);
});

test("localhost is rewritten to 127.0.0.1; remote hosts are refused", () => {
  const recipe = n8nHttpRecipe("http://localhost:8787/", TOKEN);
  assert.equal(recipe.url, "http://127.0.0.1:8787/v1/access/request");
  assert.throws(() => n8nHttpRecipe("https://api.example.com", TOKEN), /127\.0\.0\.1/);
});

test("empty pairing token becomes a placeholder, not an empty Bearer", () => {
  const recipe = n8nHttpRecipe("http://127.0.0.1:8788", "  ");
  assert.match(recipe.curl, new RegExp(`Bearer ${N8N_HTTP_PLACEHOLDER_TOKEN}`));
  assert.equal(JSON.parse(recipe.jsonText).application, "n8n");
});

test("Docker note does not include a secret and names host.docker.internal", () => {
  const recipe = n8nHttpRecipe("http://127.0.0.1:8788", TOKEN);
  assert.match(recipe.dockerNote, /host\.docker\.internal/);
  assert.equal(recipe.dockerNote.includes(TOKEN), false);
  assert.equal(recipe.dockerNote.includes("ghp_"), false);
});
