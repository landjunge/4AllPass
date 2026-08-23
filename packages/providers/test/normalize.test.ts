import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeDomain, possibleRegistrable } from "../src/normalize.ts";

test("strips scheme path query www and case", () => {
  assert.equal(normalizeDomain("https://WWW.GitHub.com/login?return_to=/foo"), "github.com");
});

test("strips port", () => {
  assert.equal(normalizeDomain("https://example.com:8443/a"), "example.com");
});

test("possible registrable is not a provider claim", () => {
  assert.equal(possibleRegistrable("shop.example.de"), "example.de");
});

test("userinfo is not the host (github.com@evil.com)", () => {
  assert.equal(normalizeDomain("https://github.com@evil.com/login"), "evil.com");
  assert.equal(normalizeDomain("github.com@evil.com/login"), "evil.com");
  assert.equal(normalizeDomain("https://user@evil.com/login"), "evil.com");
  assert.notEqual(normalizeDomain("https://github.com@evil.com/login"), "github.com");
});

test("legitimate userinfo on the real host stays the real host", () => {
  assert.equal(normalizeDomain("https://user@github.com/login"), "github.com");
  assert.equal(normalizeDomain("https://ada:token@github.com/settings"), "github.com");
});

test("IDN homograph is punycode, not the latin lookalike", () => {
  const cyrillicI = "https://g\u0456thub.com/login";
  const cyrillicA = "https://\u0430pple.com/";
  assert.equal(normalizeDomain(cyrillicI), "xn--gthub-n2e.com");
  assert.notEqual(normalizeDomain(cyrillicI), "github.com");
  assert.equal(normalizeDomain(cyrillicA), "xn--pple-43d.com");
  assert.notEqual(normalizeDomain(cyrillicA), "apple.com");
});
