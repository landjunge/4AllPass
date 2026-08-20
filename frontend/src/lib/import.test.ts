import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePlaintextExport, plaintextImportWarning } from "./import.ts";

test("warns that the file is plaintext", () => {
  assert.match(plaintextImportWarning(), /plaintext/i);
});

test("parses Bitwarden JSON logins and skips notes", () => {
  const result = parsePlaintextExport(
    JSON.stringify({
      items: [
        {
          type: 1,
          name: "GitHub",
          notes: "2fa",
          login: {
            username: "ada",
            password: "secret",
            uris: [{ uri: "https://github.com" }],
          },
        },
        { type: 2, name: "Just a note", notes: "no login" },
      ],
    }),
  );
  assert.equal(result.format, "bitwarden-json");
  assert.equal(result.skipped, 1);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.title, "GitHub");
  assert.equal(result.entries[0]?.username, "ada");
  assert.equal(result.entries[0]?.password, "secret");
  assert.equal(result.entries[0]?.url, "https://github.com");
});

test("parses KeePass-style CSV", () => {
  const result = parsePlaintextExport(
    "Account,Login Name,Password,Web Site,Comments\nBank,ada,pw,https://bank.example,note\n",
  );
  assert.equal(result.format, "csv");
  assert.equal(result.entries[0]?.title, "Bank");
  assert.equal(result.entries[0]?.username, "ada");
  assert.equal(result.entries[0]?.password, "pw");
  assert.equal(result.entries[0]?.url, "https://bank.example");
});
