import assert from "node:assert/strict";
import { test } from "node:test";
import { entriesForPage, hostnameOf } from "../src/match.ts";

test("hostnameOf strips www", () => {
  assert.equal(hostnameOf("https://www.github.com/login"), "github.com");
});

test("entriesForPage matches host and ignores unrelated", () => {
  const entries = [
    { id: "1", title: "GitHub", username: "ada", password: "x", url: "https://github.com/login" },
    { id: "2", title: "Bank", username: "ada", password: "y", url: "https://bank.example" },
  ];
  const hits = entriesForPage(entries, "https://github.com/session");
  assert.deepEqual(
    hits.map((entry) => entry.id),
    ["1"],
  );
});

test("entriesForPage does not match on title and rejects lookalike hosts", () => {
  const entries = [
    { id: "1", title: "github.com", username: "ada", password: "x", url: "" },
    { id: "2", title: "GitHub", username: "ada", password: "y", url: "https://github.com" },
  ];
  assert.deepEqual(
    entriesForPage(entries, "https://github.com/login").map((entry) => entry.id),
    ["2"],
  );
  assert.deepEqual(entriesForPage(entries, "https://github.com.evil.test"), []);
  assert.deepEqual(entriesForPage(entries, "https://notgithub.com"), []);
});

test("entriesForPage allows subdomains of the saved host", () => {
  const entries = [{ id: "1", title: "Ex", username: "ada", password: "x", url: "https://example.com" }];
  assert.equal(entriesForPage(entries, "https://app.example.com/login").length, 1);
});
