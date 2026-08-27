import assert from "node:assert/strict";
import { test } from "node:test";

import { pwnedCount, sha1Hex } from "./pwned.ts";

test("pwnedCount matches a suffix from the range body without sending the password", async () => {
  const hash = await sha1Hex("password");
  const suffix = hash.slice(5);
  const count = await pwnedCount("password", async (prefix) => {
    assert.equal(prefix, hash.slice(0, 5));
    return `${suffix}:12\nAAAAA:1\n`;
  });
  assert.equal(count, 12);
});

test("pwnedCount is zero when the suffix is absent", async () => {
  const count = await pwnedCount("password", async () => "FFFFF:3\n");
  assert.equal(count, 0);
});
