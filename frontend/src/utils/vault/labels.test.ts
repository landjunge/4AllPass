import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyDraft, newEntryId } from "../../lib/entries.ts";
import type { Translate } from "../../types/vault.ts";
import {
  entryDisplayTitle,
  entryIconName,
  entryMetaLine,
  entrySecondaryLine,
  kindLabel,
  newEntryHeading,
} from "./labels.ts";

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

test("entryIconName uses domain then host then URL hostname, never a secret", () => {
  const base = { id: newEntryId(), ...emptyDraft("web"), updatedAt: "t" };
  assert.equal(entryIconName({ ...base, domain: "mail.example" }), "mail.example");
  assert.equal(entryIconName({ ...base, url: "https://www.github.com/login" }), "github.com");
  assert.equal(entryIconName({ ...base, host: "ftp.example.com", kind: "sftp" }), "ftp.example.com");
  assert.equal(entryIconName({ ...base, title: "Notes" }), "Notes");
});

test("entryMetaLine is username and host without repeating the kind when a person exists", () => {
  assert.equal(
    entryMetaLine(
      {
        id: newEntryId(),
        ...emptyDraft("web"),
        username: "ada",
        url: "https://mail.example/",
        updatedAt: "t",
      },
      "Login",
    ),
    "ada · mail.example",
  );
});
