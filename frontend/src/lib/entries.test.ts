import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decodeEntryPlaintext,
  emptyDraft,
  encodeEntryPlaintext,
  newEntryId,
  type VaultEntry,
} from "./entries.ts";

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
