import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOtpauth, totp, totpFromBase32, totpRemaining } from "./totp.ts";

test("RFC 6238 SHA-1 8-digit vector at T=59", async () => {
  const secret = new TextEncoder().encode("12345678901234567890");
  assert.equal(await totp(secret, 59, 8, 30), "94287082");
});

test("RFC 6238 SHA-1 8-digit vector at T=1111111109", async () => {
  const secret = new TextEncoder().encode("12345678901234567890");
  assert.equal(await totp(secret, 1_111_111_109, 8, 30), "07081804");
});

test("parseOtpauth reads secret and does not treat the URI host as the secret", () => {
  const got = parseOtpauth(
    "otpauth://totp/GitHub:ada@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&digits=6&period=30",
  );
  assert.ok(got);
  assert.equal(got?.secret, "JBSWY3DPEHPK3PXP");
  assert.equal(got?.issuer, "GitHub");
  assert.equal(got?.account, "ada@example.com");
  assert.equal(parseOtpauth("https://example.com"), null);
});

test("totpFromBase32 round-trips a known secret without logging the secret in the code", async () => {
  const code = await totpFromBase32("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59, 8, 30);
  assert.equal(code, "94287082");
  assert.equal(code.includes("GEZDG"), false);
});

test("totpRemaining is in (0, period]", () => {
  const left = totpRemaining(59, 30);
  assert.ok(left > 0 && left <= 30);
});
