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
  assert.match(detected?.protocol ?? "", /ftp/i);
});

test("otpauth totp uri becomes a totp secret, not a password", () => {
  const detected = detectCredential(
    "otpauth://totp/GitHub:ada@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub",
  );
  assert.ok(detected);
  assert.equal(detected?.totpSecret, "JBSWY3DPEHPK3PXP");
  assert.equal(detected?.password, "");
  assert.equal(detected?.username, "ada@example.com");
  const draft = draftFromDetection(detected!);
  assert.equal(draft.totpSecret, "JBSWY3DPEHPK3PXP");
});

test("https URL is Web, not auto-approved", () => {
  const detected = detectCredential("https://github.com/login");
  assert.ok(detected);
  assert.equal(detected?.kind, "web");
  assert.equal(detected?.url, "https://github.com/login");
});

test("empty paste is not a guess", () => {
  assert.equal(detectCredential("   "), null);
});
