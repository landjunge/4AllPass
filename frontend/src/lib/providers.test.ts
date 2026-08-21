import assert from "node:assert/strict";
import { test } from "node:test";

import { applyTemplate, parseProviderTemplate, templateById } from "./providers.ts";

test("github template is API with read/write/issue caps", () => {
  const github = templateById("github");
  assert.ok(github);
  assert.equal(github?.kind, "api");
  assert.ok(github?.capabilities.includes("repository.read"));
  const draft = applyTemplate(github!, "work");
  assert.equal(draft.provider, "GitHub");
  assert.equal(draft.account, "work");
  assert.equal(draft.kind, "api");
});

test("YAML-shaped custom template is allowed", () => {
  const parsed = parseProviderTemplate(`
provider:
  id: acme
  name: Acme
credentials:
  - type: personal_access_token
capabilities:
  - widget.read
  - widget.write
`);
  assert.equal(parsed.id, "acme");
  assert.equal(parsed.name, "Acme");
  assert.deepEqual(parsed.capabilities, ["widget.read", "widget.write"]);
  assert.equal(parsed.credentialType, "personal_access_token");
});

test("JSON custom template is allowed", () => {
  const parsed = parseProviderTemplate(
    JSON.stringify({ id: "aws", name: "AWS", kind: "api", capabilities: ["sts.read"] }),
  );
  assert.equal(parsed.id, "aws");
  assert.equal(parsed.capabilities[0], "sts.read");
});
