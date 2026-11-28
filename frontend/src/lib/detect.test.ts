import assert from "node:assert/strict";
import { test } from "node:test";

import { decideAccess } from "./access.ts";
import { detectCredential, draftFromDetection, mergeDetectedCredential } from "./detect.ts";
import { emptyDraft } from "./entries.ts";

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

test("mergeDetectedCredential preserves title, account, and notes the user already typed", () => {
  const detected = detectCredential("ghp_abcdefghijklmnopqrstuvwxyz012345")!;
  const current = {
    ...emptyDraft("api"),
    title: "My GitHub PAT",
    account: "work",
    notes: "rotate every 90 days",
    password: "",
  };
  const merged = mergeDetectedCredential(current, detected);
  assert.equal(merged.title, "My GitHub PAT");
  assert.equal(merged.account, "work");
  assert.equal(merged.notes, "rotate every 90 days");
  assert.equal(merged.password, "ghp_abcdefghijklmnopqrstuvwxyz012345");
  assert.equal(merged.provider, "GitHub");
});

test("mergeDetectedCredential fills a still-blank title from the detection", () => {
  const detected = detectCredential("ghp_abcdefghijklmnopqrstuvwxyz012345")!;
  const blank = { ...emptyDraft("api"), title: "" };
  const merged = mergeDetectedCredential(blank, detected);
  assert.equal(merged.title, "GitHub");
  assert.equal(merged.provider, "GitHub");
  assert.equal(merged.url, "https://api.github.com");
  assert.equal(merged.capabilities, "repository.read");
});

test("recapturing a different provider updates provider, URL, and capabilities together with the password", () => {
  // The user captured a GitHub key, then switched the provider dropdown to
  // OpenAI and captured again before ever saving — provider/URL must move
  // with the new password, never stay pinned to the first capture.
  const github = detectCredential("ghp_abcdefghijklmnopqrstuvwxyz012345")!;
  const afterFirstCapture = mergeDetectedCredential(emptyDraft("api"), github);
  assert.equal(afterFirstCapture.provider, "GitHub");

  const openai = detectCredential("sk-" + "abcdefghijklmnopqrstuvwxyz0123456789")!;
  const afterRecapture = mergeDetectedCredential(afterFirstCapture, openai);
  assert.equal(afterRecapture.provider, "OpenAI");
  assert.equal(afterRecapture.url, "https://api.openai.com");
  assert.equal(afterRecapture.password, "sk-" + "abcdefghijklmnopqrstuvwxyz0123456789");
});

test("mergeDetectedCredential always overwrites the password with the newly captured key", () => {
  const detected = detectCredential("ghp_abcdefghijklmnopqrstuvwxyz012345")!;
  const current = { ...emptyDraft("api"), password: "an-old-stale-value" };
  const merged = mergeDetectedCredential(current, detected);
  assert.equal(merged.password, "ghp_abcdefghijklmnopqrstuvwxyz012345");
});
