import assert from "node:assert/strict";
import { test } from "node:test";
import { entriesForPage, hostnameOf, maskUsername, publicPicks, wipeFillEntry } from "../src/match.ts";

test("hostnameOf strips www", () => {
  assert.equal(hostnameOf("https://www.github.com/login"), "github.com");
});

test("entriesForPage treats www.github.com as github.com", () => {
  const entries = [{ id: "1", title: "GitHub", username: "ada", password: "x", url: "https://github.com" }];
  assert.equal(entriesForPage(entries, "https://www.github.com/login").length, 1);
  assert.equal(entriesForPage(entries, "https://foo.github.com/login").length, 1);
});

test("entriesForPage rejects encoded-dot and lookalike hosts", () => {
  const entries = [{ id: "1", title: "GitHub", username: "ada", password: "x", url: "https://github.com" }];
  assert.deepEqual(entriesForPage(entries, "https://github.com%2eevil.com/login"), []);
  assert.deepEqual(entriesForPage(entries, "https://github.com.evil.com/login"), []);
  assert.deepEqual(entriesForPage(entries, "https://evilgithub.com/login"), []);
  assert.deepEqual(entriesForPage(entries, "https://github.com.evil.test/login"), []);
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

test("hostnameOf ignores userinfo (github.com@evil.com is evil.com)", () => {
  assert.equal(hostnameOf("https://github.com@evil.com/login"), "evil.com");
  assert.equal(hostnameOf("https://user@github.com/login"), "github.com");
  assert.notEqual(hostnameOf("https://github.com@evil.com/login"), "github.com");
});

test("hostnameOf punycodes IDN homographs, not the latin lookalike", () => {
  assert.equal(hostnameOf("https://g\u0456thub.com/login"), "xn--gthub-n2e.com");
  assert.notEqual(hostnameOf("https://g\u0456thub.com/login"), "github.com");
});

test("hostnameOf strips a trailing DNS dot", () => {
  assert.equal(hostnameOf("https://github.com./login"), "github.com");
});

test("entriesForPage does not fill an HTTPS GitHub entry into HTTP github.com", () => {
  const entries = [{ id: "1", title: "GitHub", username: "ada", password: "x", url: "https://github.com" }];
  assert.deepEqual(entriesForPage(entries, "http://github.com/login"), []);
  assert.equal(entriesForPage(entries, "https://github.com/login").length, 1);
});

test("entriesForPage still fills loopback HTTP (local test-login)", () => {
  const entries = [
    {
      id: "1",
      title: "Demo",
      username: "ada",
      password: "x",
      url: "http://127.0.0.1:8788/test-login.html",
    },
  ];
  assert.equal(entriesForPage(entries, "http://127.0.0.1:8788/test-login.html").length, 1);
});

test("entriesForPage does not suffix-match a shared parent host (github.io)", () => {
  const parent = [{ id: "1", title: "Pages", username: "ada", password: "x", url: "https://github.io" }];
  assert.deepEqual(entriesForPage(parent, "https://evil.github.io/login"), []);
  assert.equal(entriesForPage(parent, "https://github.io/").length, 1);

  const tenant = [
    { id: "2", title: "Mine", username: "ada", password: "x", url: "https://ada.github.io" },
  ];
  assert.equal(entriesForPage(tenant, "https://ada.github.io/app").length, 1);
  assert.deepEqual(entriesForPage(tenant, "https://evil.github.io/login"), []);
});

test("entriesForPage does not fill a GitHub entry on github.com@evil.com", () => {
  const entries = [{ id: "1", title: "GitHub", username: "ada", password: "x", url: "https://github.com" }];
  assert.deepEqual(entriesForPage(entries, "https://github.com@evil.com/login"), []);
  assert.deepEqual(entriesForPage(entries, "https://g\u0456thub.com/login"), []);
  assert.equal(entriesForPage(entries, "https://user@github.com/session").length, 1);
});

test("entriesForPage rejects evilgithub.com and allows login.github.com", () => {
  const entries = [{ id: "1", title: "GitHub", username: "ada", password: "x", url: "https://github.com" }];
  assert.deepEqual(entriesForPage(entries, "https://evilgithub.com/login"), []);
  assert.equal(entriesForPage(entries, "https://login.github.com/session").length, 1);
});

test("entriesForPage does not suffix-match a TLD-only saved host", () => {
  const entries = [{ id: "1", title: "TLD", username: "ada", password: "x", url: "https://com" }];
  assert.deepEqual(entriesForPage(entries, "https://evilgithub.com/login"), []);
  assert.equal(entriesForPage(entries, "https://com/").length, 1);
});

test("known Microsoft login domain matches a microsoft.com vault entry", () => {
  const entries = [
    { id: "1", title: "Microsoft", username: "ada@contoso.test", password: "secret", url: "https://account.microsoft.com" },
  ];
  assert.equal(entriesForPage(entries, "https://login.microsoftonline.com/common/oauth2").length, 1);
  assert.deepEqual(entriesForPage(entries, "https://evilmicrosoft.com/login"), []);
});

test("stored providerId does not override a conflicting URL", () => {
  const taggedWrongHost = [
    {
      id: "1",
      title: "MS",
      username: "ada",
      password: "secret",
      url: "https://contoso.example",
      providerId: "microsoft",
    },
  ];
  assert.deepEqual(entriesForPage(taggedWrongHost, "https://login.microsoftonline.com/"), []);

  const taggedPhish = [
    {
      id: "2",
      title: "GitHub",
      username: "ada",
      password: "secret",
      url: "https://evilgithub.com",
      providerId: "github",
    },
  ];
  assert.deepEqual(entriesForPage(taggedPhish, "https://github.com/login"), []);
});

test("URL-less providerId still matches a high-confidence page", () => {
  const tagged = [
    { id: "1", title: "MS", username: "ada", password: "secret", url: "", providerId: "microsoft" },
  ];
  assert.equal(entriesForPage(tagged, "https://login.microsoftonline.com/").length, 1);
});

test("entriesForPage does not treat a one-label host as a suffix of github.com", () => {
  const entries = [{ id: "1", title: "com", username: "ada", password: "x", url: "https://com/" }];
  assert.deepEqual(entriesForPage(entries, "https://github.com/login"), []);
  assert.equal(entriesForPage(entries, "https://com/").length, 1);
});

test("wipeFillEntry clears username, password, and totpSecret", () => {
  const entry = {
    id: "1",
    title: "GitHub",
    username: "ada",
    password: "secret-must-not-linger",
    url: "https://github.com",
    totpSecret: "JBSWY3DPEHPK3PXP",
  };
  wipeFillEntry(entry);
  assert.equal(entry.username, "");
  assert.equal(entry.password, "");
  assert.equal(entry.totpSecret, "");
});

test("maskUsername never returns the raw address; publicPicks drop the password", () => {
  assert.equal(maskUsername("ada@contoso.test"), "a***@contoso.test");
  const picks = publicPicks([
    { id: "1", title: "GitHub", username: "ada@contoso.test", password: "secret-must-not-leak", url: "https://github.com" },
  ]);
  assert.equal(picks[0]?.username, "a***@contoso.test");
  assert.equal(JSON.stringify(picks).includes("secret-must-not-leak"), false);
});
