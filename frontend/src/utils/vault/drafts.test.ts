import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyDraft, newEntryId, type VaultEntry } from "../../lib/entries.ts";
import { applyKindToDraft, createNewDraft, draftFromEntry, draftHasAdvancedFields } from "./drafts.ts";

test("createNewDraft fills a generated password", () => {
  const draft = createNewDraft("web");
  assert.equal(draft.kind, "web");
  assert.ok(draft.password.length >= 16);
});

test("applyKindToDraft sets sftp and api defaults without wiping filled fields", () => {
  const web = emptyDraft("web");
  const sftp = applyKindToDraft(web, "sftp");
  assert.equal(sftp.kind, "sftp");
  assert.equal(sftp.port, "22");
  assert.equal(sftp.protocol, "sftp");
  const api = applyKindToDraft(sftp, "api");
  assert.equal(api.kind, "api");
  assert.equal(api.capabilities, "repository.read");
  assert.equal(api.credentialType, "api_key");
  assert.equal(api.port, "22");
});

test("draftFromEntry round-trips visible fields", () => {
  const entry: VaultEntry = {
    id: newEntryId(),
    ...emptyDraft("web"),
    title: "Mail",
    username: "ada",
    password: "secret",
    url: "https://mail.example/",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const draft = draftFromEntry(entry);
  assert.equal(draft.title, "Mail");
  assert.equal(draft.username, "ada");
  assert.equal(draft.password, "secret");
  assert.equal(draftHasAdvancedFields(entry), false);
});
