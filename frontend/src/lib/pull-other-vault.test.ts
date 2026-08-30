import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyDraft } from "./entries.ts";
import { wipeVaultEntry } from "./entries.ts";
import { cloneEntries } from "./pull-other-vault.ts";

test("clone keeps secrets after the source vault is wiped", () => {
  const source = [
    {
      ...emptyDraft("web"),
      id: "entry_src",
      password: "dummy-pass",
      notes: "dummy-note",
      totpSecret: "dummy-totp",
      updatedAt: "2026-08-24T00:00:00.000Z",
    },
  ];
  const cloned = cloneEntries(source);
  for (const entry of source) wipeVaultEntry(entry);
  assert.equal(source[0]?.password, "");
  assert.equal(cloned[0]?.password, "dummy-pass");
  assert.equal(cloned[0]?.notes, "dummy-note");
  assert.equal(cloned[0]?.totpSecret, "dummy-totp");
});
