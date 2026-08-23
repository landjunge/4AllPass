import assert from "node:assert/strict";
import { test } from "node:test";
import { hostMatches } from "../src/match.ts";
import { resolveProvider } from "../src/resolve.ts";

test("evilgithub.com is not GitHub", () => {
  assert.equal(hostMatches("evilgithub.com", "github.com", "subdomain"), false);
  const got = resolveProvider("https://evilgithub.com/login");
  assert.equal(got.providerId, null);
  assert.notEqual(got.matchType, "exact-domain");
  assert.notEqual(got.matchType, "subdomain");
});

test("github.com exact", () => {
  const got = resolveProvider("https://github.com/login");
  assert.equal(got.providerId, "github");
  assert.equal(got.providerName, "GitHub");
  assert.equal(got.matchType, "exact-domain");
  assert.equal(got.confidence, 1);
  assert.equal(got.requiresConfirmation, false);
  assert.equal(got.normalizedDomain, "github.com");
});

test("api.github.com is a known subdomain", () => {
  const got = resolveProvider("https://api.github.com/user");
  assert.equal(got.providerId, "github");
  assert.equal(got.matchType, "subdomain");
  assert.equal(got.confidence, 0.98);
});

test("login.microsoftonline.com is Microsoft login domain", () => {
  const got = resolveProvider("https://login.microsoftonline.com/common/oauth2");
  assert.equal(got.providerId, "microsoft");
  assert.equal(got.providerName, "Microsoft");
  assert.equal(got.matchType, "known-login-domain");
  assert.ok(got.confidence >= 0.95);
});

test("github-login.example.com is not GitHub", () => {
  const got = resolveProvider("https://github-login.example.com");
  assert.equal(got.providerId, null);
  assert.equal(got.normalizedDomain, "github-login.example.com");
});

test("unknown shop stays unknown with heuristic possibleName", () => {
  const got = resolveProvider("https://shop.example.de/konto");
  assert.equal(got.providerId, null);
  assert.equal(got.matchType, "heuristic");
  assert.equal(got.possibleName, "example.de");
  assert.equal(got.requiresConfirmation, true);
  assert.ok(got.confidence < 0.7);
});

test("user override wins over built-in", () => {
  const got = resolveProvider("https://git.example.com", {
    overrides: [{ host: "git.example.com", match: "exact", providerId: "github" }],
  });
  assert.equal(got.providerId, "github");
  assert.equal(got.matchType, "user-override");
  assert.equal(got.confidence, 1);
});
