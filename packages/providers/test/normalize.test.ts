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
