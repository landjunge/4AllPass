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
