import assert from "node:assert/strict";
import { test } from "node:test";

import { AuthFailureError, IntegrityError, ProtocolError } from "@4allpass/crypto";

import type { VaultEntry } from "./entries.ts";
import { buildSharePackage, looksLikeSharePackage, openSharePackage, SHARE_KIND } from "./share.ts";

function entry(partial: Partial<VaultEntry> & Pick<VaultEntry, "id" | "password">): VaultEntry {
  return {
    kind: "web",
    title: "GitHub",
    provider: "",
    account: "",
    username: "ada",
    url: "https://github.com",
    host: "",
    port: "",
    protocol: "",
    capabilities: "",
    notes: "",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...partial,
  };
}

test("share package round-trips one entry and omits the others", () => {
  const keep = entry({ id: "entry_keep", password: "s3cret-share-only-this" });
  const skip = entry({ id: "entry_skip", title: "Bank", password: "s3cret-must-not-leave" });
  const built = buildSharePackage([keep]);
  assert.equal(built.entryCount, 1);
  assert.equal(looksLikeSharePackage(built.json), true);
  assert.equal(built.json.includes(keep.password), false);
  assert.equal(built.json.includes(skip.password), false);
  const parsed = JSON.parse(built.json) as { kind: string };
  assert.equal(parsed.kind, SHARE_KIND);
  const opened = openSharePackage(built.json, built.shareKey);
  assert.equal(opened.length, 1);
  assert.equal(opened[0]?.password, keep.password);
  assert.equal(opened[0]?.title, keep.title);
  assert.notEqual(opened[0]?.id, keep.id);
});

test("wrong share key does not decrypt", () => {
  const built = buildSharePackage([entry({ id: "entry_1", password: "s3cret-share-wrong-key" })]);
  const other = buildSharePackage([entry({ id: "entry_2", password: "other" })]);
  assert.throws(
    () => openSharePackage(built.json, other.shareKey),
    (error: unknown) =>
      error instanceof AuthFailureError ||
      error instanceof IntegrityError ||
      error instanceof ProtocolError,
  );
});

test("tampered share ciphertext is refused", () => {
  const built = buildSharePackage([entry({ id: "entry_1", password: "s3cret-share-tamper" })]);
  const pack = JSON.parse(built.json) as {
    kind: string;
    snapshot: { entries: Array<{ ciphertext: string }> };
  };
  const original = pack.snapshot.entries[0]!.ciphertext;
  pack.snapshot.entries[0]!.ciphertext = `${original.slice(0, -4)}AAAA`;
  assert.throws(
    () => openSharePackage(JSON.stringify(pack), built.shareKey),
    (error: unknown) => error instanceof IntegrityError || error instanceof AuthFailureError,
  );
});
