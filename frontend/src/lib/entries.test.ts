import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decodeEntryPlaintext,
  emptyDraft,
  encodeEntryPlaintext,
  newEntryId,
  wipeVaultEntry,
  type VaultEntry,
} from "./entries.ts";
import { lock } from "./vault-session.ts";

test("old plaintext without kind still unlocks as web", () => {
  const id = newEntryId();
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      title: "GitHub",
      username: "ada",
      password: "s3cret",
      url: "https://github.com",
      notes: "",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  const entry = decodeEntryPlaintext(id, bytes);
  assert.equal(entry.kind, "web");
  assert.equal(entry.title, "GitHub");
  assert.equal(entry.password, "s3cret");
  assert.equal(entry.provider, "");
  assert.equal(entry.totpSecret, "");
});

test("wipeVaultEntry clears every secret class including totpSecret", () => {
  const entry: VaultEntry = {
    id: newEntryId(),
    ...emptyDraft("web"),
    title: "GitHub",
    username: "ada",
    password: "s3cret",
    notes: "private note",
    totpSecret: "JBSWY3DPEHPK3PXP",
  };
  wipeVaultEntry(entry);
  assert.equal(entry.password, "");
  assert.equal(entry.notes, "");
  assert.equal(entry.totpSecret, "");
  assert.equal(entry.username, "ada");
  assert.equal(entry.title, "GitHub");
});

test("lock() via wipeVaultEntry leaves no TOTP secret on a stale entry ref", () => {
  const entry: VaultEntry = {
    id: newEntryId(),
    ...emptyDraft("web"),
    password: "s3cret",
    notes: "n",
    totpSecret: "JBSWY3DPEHPK3PXP",
  };
  const vaultKey = new Uint8Array(32);
  vaultKey.fill(7);
  lock({
    vaultId: "vault_test",
    revision: 1,
    vaultKeyVersion: 1,
    vaultKey,
    envelopes: [],
    entries: [entry],
    unlockedWith: "master_password",
  });
  assert.equal(entry.totpSecret, "");
  assert.equal(entry.password, "");
  assert.equal(entry.notes, "");
  assert.deepEqual(Array.from(vaultKey), new Array(32).fill(0));
});

test("totpSecret round-trips in entry plaintext", () => {
  const id = newEntryId();
  const entry: VaultEntry = {
    id,
    ...emptyDraft("web"),
    title: "GitHub",
    totpSecret: "JBSWY3DPEHPK3PXP",
  };
  const again = decodeEntryPlaintext(id, encodeEntryPlaintext(entry));
  assert.equal(again.totpSecret, "JBSWY3DPEHPK3PXP");
});

test("api and sftp round-trip in ciphertext JSON", () => {
  const id = newEntryId();
  const api: VaultEntry = {
    id,
    ...emptyDraft("api"),
    title: "GitHub PAT",
    provider: "GitHub",
    account: "personal",
    password: "ghp_not-a-real-token",
    capabilities: "repository.read",
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
  const back = decodeEntryPlaintext(id, encodeEntryPlaintext(api));
  assert.equal(back.kind, "api");
  assert.equal(back.provider, "GitHub");
  assert.equal(back.capabilities, "repository.read");
  assert.equal(back.password, "ghp_not-a-real-token");

  const sftp: VaultEntry = {
    id,
    ...emptyDraft("sftp"),
    title: "prod",
    host: "ftp.example.com",
    port: "22",
    protocol: "sftp",
    username: "deploy",
    password: "unused-in-assert-host",
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
  const sftpBack = decodeEntryPlaintext(id, encodeEntryPlaintext(sftp));
  assert.equal(sftpBack.kind, "sftp");
  assert.equal(sftpBack.host, "ftp.example.com");
  assert.equal(sftpBack.protocol, "sftp");
});
