import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyDraft, newEntryId } from "../../lib/entries.ts";
import type { Translate } from "../../types/vault.ts";
import { entryDisplayTitle, entrySecondaryLine, kindLabel, newEntryHeading } from "./labels.ts";

const t: Translate = (plain) => `${plain.de} / ${plain.en}`;

test("kindLabel and newEntryHeading stay bilingual", () => {
  assert.equal(kindLabel("web", t), "Login / Login");
  assert.equal(kindLabel("api", t), "API-Key / API key");
  assert.equal(newEntryHeading("sftp", t), "Neuer Server-Zugang / New server login");
});

test("entryDisplayTitle prefers title then url then host", () => {
  const untitled = "Ohne Titel / Untitled";
  assert.equal(
    entryDisplayTitle(
      { id: newEntryId(), ...emptyDraft("web"), url: "https://mail.example/", updatedAt: "t" },
      untitled,
    ),
    "https://mail.example/",
  );
  assert.equal(
    entrySecondaryLine(
      { id: newEntryId(), ...emptyDraft("web"), username: "ada", updatedAt: "t" },
      "Login",
    ),
    "Login · ada",
  );
});
