import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyImportedEntry,
  entriesFromEnvText,
  entriesFromProviderJson,
  looksLikeEnvFile,
} from "./import-classify.ts";

const GITHUB_PAT = "ghp_demotokenvalue1";
const OPENAI_KEY = "sk-demotokenvalue12ab";
const STRIPE_KEY = "sk_test_demokey12";

test("GitHub PAT becomes an API entry, not a website login", () => {
  const entry = classifyImportedEntry({
    title: "ci",
    username: "ada",
    password: GITHUB_PAT,
    url: "https://github.com",
  });
  assert.equal(entry.kind, "api");
  assert.equal(entry.provider, "GitHub");
  assert.equal(entry.providerId, "github");
  assert.equal(entry.password, GITHUB_PAT);
});

test("OpenAI key prefix is classified as API", () => {
  const entry = classifyImportedEntry({ password: OPENAI_KEY });
  assert.equal(entry.kind, "api");
  assert.equal(entry.provider, "OpenAI");
  assert.equal(entry.providerId, "openai");
});

test("env name OPENAI_API_KEY classifies without a well-known prefix", () => {
  const entry = classifyImportedEntry({
    title: "OPENAI_API_KEY",
    password: "proj_not_a_sk_prefix_value",
    nameHint: "OPENAI_API_KEY",
  });
  assert.equal(entry.kind, "api");
  assert.equal(entry.provider, "OpenAI");
});

test("normal website login stays web", () => {
  const entry = classifyImportedEntry({
    title: "Mail",
    username: "ada",
    password: "hunter2-not-a-token",
    url: "https://mail.example/",
  });
  assert.equal(entry.kind, "web");
  assert.equal(entry.username, "ada");
});

test(".env lines become API entries and skip comments", () => {
  const text = `# comment
OPENAI_API_KEY=${OPENAI_KEY}
GITHUB_TOKEN=${GITHUB_PAT}
export STRIPE_SECRET_KEY="${STRIPE_KEY}"
PATH=/usr/bin
`;
  assert.equal(looksLikeEnvFile(text), true);
  const entries = entriesFromEnvText(text);
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((item) => item.provider).sort(),
    ["GitHub", "OpenAI", "Stripe"],
  );
  assert.equal(
    entries.every((item) => item.kind === "api"),
    true,
  );
});

test("provider JSON map and array import API keys", () => {
  const map = entriesFromProviderJson({
    OPENAI_API_KEY: OPENAI_KEY,
    GITHUB_TOKEN: GITHUB_PAT,
  });
  assert.ok(map);
  assert.equal(map.length, 2);
  const list = entriesFromProviderJson([
    { provider: "GitHub", token: GITHUB_PAT },
    { name: "OpenAI", secret: OPENAI_KEY },
  ]);
  assert.ok(list);
  assert.equal(list.length, 2);
  assert.equal(list.every((item) => item.kind === "api"), true);
});

test("Bitwarden-shaped JSON is not treated as a provider map", () => {
  assert.equal(entriesFromProviderJson({ items: [] }), null);
});
