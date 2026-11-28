import assert from "node:assert/strict";
import { test } from "node:test";

import { formatUsedByInput, hasUsageDependents, parseUsedByInput } from "./usage.ts";

test("parseUsedByInput splits on newlines and commas, trims, and drops empties", () => {
  assert.deepEqual(parseUsedByInput("n8n\nKiraBridge, ThreadDesk\n\n  \n"), ["n8n", "KiraBridge", "ThreadDesk"]);
});

test("parseUsedByInput dedupes repeated names", () => {
  assert.deepEqual(parseUsedByInput("n8n\nn8n\nKiraBridge"), ["n8n", "KiraBridge"]);
});

test("parseUsedByInput returns empty list for blank input", () => {
  assert.deepEqual(parseUsedByInput("   \n  "), []);
});

test("formatUsedByInput joins with newlines and round-trips through parseUsedByInput", () => {
  const list = ["n8n", "KiraBridge"];
  assert.equal(formatUsedByInput(list), "n8n\nKiraBridge");
  assert.deepEqual(parseUsedByInput(formatUsedByInput(list)), list);
});

test("hasUsageDependents is false only for an empty list", () => {
  assert.equal(hasUsageDependents({ usedBy: [] }), false);
  assert.equal(hasUsageDependents({ usedBy: ["n8n"] }), true);
});
