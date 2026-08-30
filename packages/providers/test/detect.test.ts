import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DETECT_FIELD_ONLY_MAX,
  DETECT_HIGH_MIN,
  detectSetup,
} from "../src/detect.ts";

test("OPENAI_API_KEY alone is not high confidence and still asks", () => {
  const got = detectSetup({ fieldNames: ["OPENAI_API_KEY"] });
  assert.equal(got.providerId, "openai");
  assert.equal(got.credentialKind, "api");
  assert.equal(got.requiresConfirmation, true);
  assert.ok(got.confidence <= DETECT_FIELD_ONLY_MAX);
  assert.ok(got.confidence < DETECT_HIGH_MIN);
  assert.ok(got.reasons.includes("field:openai"));
  assert.equal(got.reasons.some((reason) => /sk-/.test(reason)), false);
  assert.match(got.promptDe, /OpenAI/);
  assert.match(got.promptEn, /OpenAI/);
  assert.doesNotMatch(got.promptDe, /OPENAI_API_KEY/);
});

test("generic API_KEY is not a provider", () => {
  const got = detectSetup({ fieldNames: ["API_KEY", "password"] });
  assert.equal(got.providerId, null);
  assert.equal(got.confidence, 0);
});

test("n8n + OpenAI field + api.openai.com is high and still asks", () => {
  const got = detectSetup({
    application: "n8n",
    url: "https://api.openai.com/v1",
    fieldNames: ["openai_api_key"],
    pageTitle: "n8n",
  });
  assert.equal(got.providerId, "openai");
  assert.equal(got.credentialKind, "api");
  assert.equal(got.targetApplication, "n8n");
  assert.equal(got.requiresConfirmation, true);
  assert.ok(got.confidence >= DETECT_HIGH_MIN);
  assert.ok(got.reasons.includes("field:openai"));
  assert.ok(got.reasons.includes("domain:openai"));
  assert.ok(got.reasons.includes("application:n8n"));
});

test("n8n on loopback with OpenAI field asks, but is not high without domain", () => {
  const got = detectSetup({
    url: "http://127.0.0.1:5678/home/credentials",
    fieldNames: ["OPENAI_API_KEY"],
    pageTitle: "n8n",
  });
  assert.equal(got.providerId, "openai");
  assert.equal(got.targetApplication, "n8n");
  assert.equal(got.pageHost, "127.0.0.1:5678");
  assert.equal(got.requiresConfirmation, true);
  assert.ok(got.confidence < DETECT_HIGH_MIN);
  assert.match(got.promptDe, /127\.0\.0\.1:5678/);
  assert.match(got.promptDe, /n8n/);
});

test("github.com/login is GitHub web-login and still asks", () => {
  const got = detectSetup({ url: "https://github.com/login" });
  assert.equal(got.providerId, "github");
  assert.equal(got.credentialKind, "web-login");
  assert.equal(got.requiresConfirmation, true);
  assert.equal(got.confidence, 1);
  assert.match(got.promptDe, /GitHub-Anmeldung/);
  assert.match(got.promptEn, /GitHub login/);
});

test("evilgithub.com is not GitHub", () => {
  const got = detectSetup({ url: "https://evilgithub.com/login" });
  assert.equal(got.providerId, null);
  assert.notEqual(got.reasons.includes("domain:github"), true);
});

test("github.com@evil.com is not GitHub", () => {
  const got = detectSetup({ url: "https://github.com@evil.com/login" });
  assert.equal(got.pageHost, "evil.com");
  assert.equal(got.providerId, null);
});

test("IDN homograph is not GitHub", () => {
  const got = detectSetup({ url: "https://g\u0456thub.com/login" });
  assert.notEqual(got.providerId, "github");
});

test("OpenAI field on github.com is a conflict, not a high OpenAI vote", () => {
  const got = detectSetup({
    url: "https://github.com/settings",
    fieldNames: ["OPENAI_API_KEY"],
  });
  assert.equal(got.requiresConfirmation, true);
  assert.ok(got.confidence < DETECT_HIGH_MIN);
  assert.ok(got.reasons.includes("conflict:field-domain"));
});

test("ftp protocol on an unknown host is FTP and still asks", () => {
  const got = detectSetup({ url: "ftp://ftp.example.com", protocol: "ftp" });
  assert.equal(got.credentialKind, "ftp");
  assert.equal(got.providerId, null);
  assert.equal(got.requiresConfirmation, true);
  assert.match(got.promptDe, /FTP\/SFTP/);
  assert.match(got.promptEn, /FTP\/SFTP/);
});

test("Cloudflare dashboard is Cloudflare web-login", () => {
  const got = detectSetup({ url: "https://dash.cloudflare.com/" });
  assert.equal(got.providerId, "cloudflare");
  assert.equal(got.credentialKind, "web-login");
  assert.equal(got.requiresConfirmation, true);
});

test("user pick plus agreeing domain is high and still asks", () => {
  const got = detectSetup({
    url: "https://platform.openai.com/api-keys",
    fieldNames: ["OPENAI_API_KEY"],
    userSelection: "openai",
  });
  assert.equal(got.providerId, "openai");
  assert.equal(got.confidence, 1);
  assert.equal(got.requiresConfirmation, true);
  assert.ok(got.reasons.includes("user:openai"));
});

test("application n8n alone does not invent a provider", () => {
  const got = detectSetup({ application: "n8n", pageTitle: "n8n" });
  assert.equal(got.providerId, null);
  assert.equal(got.targetApplication, "n8n");
  assert.equal(got.confidence, 0);
  assert.equal(got.promptDe, "");
});

test("detectSetup never echoes a pasted secret from fieldNames", () => {
  const got = detectSetup({ fieldNames: ["sk-live-not-a-field-name"] });
  assert.equal(got.providerId, null);
  assert.doesNotMatch(got.promptDe, /sk-live/);
  assert.doesNotMatch(JSON.stringify(got.reasons), /sk-live/);
});
