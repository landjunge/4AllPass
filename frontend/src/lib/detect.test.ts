import assert from "node:assert/strict";
import { test } from "node:test";

import { decideAccess } from "./access.ts";
import { detectCredential, draftFromDetection } from "./detect.ts";

test("ghp_ token is GitHub API, not a grant", () => {
  const detected = detectCredential("ghp_abcdefghijklmnopqrstuvwxyz012345");
  assert.ok(detected);
  assert.equal(detected?.kind, "api");
  assert.equal(detected?.provider, "GitHub");
  const draft = draftFromDetection(detected!);
  const verdict = decideAccess(
    {
      application: "n8n",
      provider: "GitHub",
      credential: "personal",
      scope: ["repository.read"],
      ttlSeconds: 60,
    },
    [],
  );
  assert.equal(verdict.status, "denied");
  assert.equal(draft.kind, "api");
});

test("ftp host plus login is SFTP class", () => {
  const detected = detectCredential("ftp.example.com\ndeploy\ns3cret");
  assert.ok(detected);
  assert.equal(detected?.kind, "sftp");
  assert.equal(detected?.host, "ftp.example.com");
  assert.equal(detected?.username, "deploy");
  assert.equal(detected?.password, "s3cret");
  assert.equal(detected?.protocol, "ftp");
  assert.equal(detected?.port, "21");
});

test("sftp paste with dotted username does not treat the password as username", () => {
  const detected = detectCredential("sftp\nftp.example.com\nmy.user\ns3cret");
  assert.ok(detected);
  assert.equal(detected?.kind, "sftp");
  assert.equal(detected?.username, "my.user");
  assert.equal(detected?.password, "s3cret");
  assert.equal(detected?.protocol, "sftp");
  assert.equal(detected?.port, "22");
});

test("https URL is Web, not auto-approved", () => {
  const detected = detectCredential("https://github.com/login");
  assert.ok(detected);
  assert.equal(detected?.kind, "web");
  assert.equal(detected?.url, "https://github.com/login");
});

test("https userinfo is stripped out of the stored URL", () => {
  const detected = detectCredential("https://ada:s3cret@github.com/login");
  assert.ok(detected);
  assert.equal(detected?.kind, "web");
  assert.equal(detected?.username, "ada");
  assert.equal(detected?.password, "s3cret");
  assert.equal(detected?.url.includes("s3cret"), false);
  assert.equal(detected?.url, "https://github.com/login");
});

test("empty paste is not a guess", () => {
  assert.equal(detectCredential("   "), null);
});
