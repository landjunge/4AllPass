import assert from "node:assert/strict";
import { test } from "node:test";
import { entriesForPage, hostnameOf, maskUsername, publicPicks } from "../src/match.ts";

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

test("entriesForPage rejects evilgithub.com and allows login.github.com", () => {
  const entries = [{ id: "1", title: "GitHub", username: "ada", password: "x", url: "https://github.com" }];
  assert.deepEqual(entriesForPage(entries, "https://evilgithub.com/login"), []);
  assert.equal(entriesForPage(entries, "https://login.github.com/session").length, 1);
});

test("known Microsoft login domain matches a microsoft.com vault entry", () => {
  const entries = [
    { id: "1", title: "Microsoft", username: "ada@contoso.test", password: "secret", url: "https://account.microsoft.com" },
  ];
  assert.equal(entriesForPage(entries, "https://login.microsoftonline.com/common/oauth2").length, 1);
  assert.deepEqual(entriesForPage(entries, "https://evilmicrosoft.com/login"), []);
});

test("stored providerId matches a high-confidence page without suffix host", () => {
  const entries = [
    { id: "1", title: "MS", username: "ada", password: "secret", url: "https://contoso.example", providerId: "microsoft" },
  ];
  assert.equal(entriesForPage(entries, "https://login.microsoftonline.com/").length, 1);
});

test("maskUsername never returns the raw address; publicPicks drop the password", () => {
  assert.equal(maskUsername("ada@contoso.test"), "a***@contoso.test");
  const picks = publicPicks([
    { id: "1", title: "GitHub", username: "ada@contoso.test", password: "secret-must-not-leak", url: "https://github.com" },
  ]);
  assert.equal(picks[0]?.username, "a***@contoso.test");
  assert.equal(JSON.stringify(picks).includes("secret-must-not-leak"), false);
});
