import assert from "node:assert/strict";
import { test } from "node:test";
import { LineError } from "./copy-mode.ts";
import { importReviewRows, parsePlaintextExport } from "./import.ts";
import { parseVaultImportFile } from "../services/vault/importFile.ts";

const MARKER = "synthetic-secret-fragment-not-for-preview";

for (const newline of ["\n", "\r\n"]) {
  test(`quoted multiline password stays one field (${JSON.stringify(newline)})`, () => {
    const password = `synthetic first${newline}${MARKER}`;
    const parsed = parsePlaintextExport(
      `title,username,password,url${newline}Mail,ada,"${password}",https://mail.example/${newline}`,
    );
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0]?.password, password);
    assert.equal(JSON.stringify(importReviewRows(parsed.entries)).includes(MARKER), false);
  });
}

test("escaped quotes, commas, unicode and multiline notes preserve field boundaries", () => {
  const parsed = parsePlaintextExport(
    'title,username,password,url,notes\r\n"Mail, personal",ada,"synthetic""quoted,é",https://mail.example/,"first\r\n\r\nlast"\r\n',
  );
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0]?.password, 'synthetic"quoted,é');
  assert.equal(parsed.entries[0]?.notes, "first\r\n\r\nlast");
});

test("final password whitespace survives with and without a final record separator", () => {
  for (const ending of ["", "\n", "\r\n"]) {
    const parsed = parsePlaintextExport(`title,password\nMail,  synthetic tail  ${ending}`);
    assert.equal(parsed.entries[0]?.password, "  synthetic tail  ");
  }
});

test("BOM and empty physical lines do not lose trailing empty columns or EOF records", () => {
  const parsed = parsePlaintextExport('\uFEFF\r\ntitle,username,password,url\r\n\r\nMail,ada,synthetic,\r\nSecond,bob,"",');
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0]?.url, "");
  assert.equal(parsed.entries[1]?.password, "");
});

for (const [name, row] of [
  ["unclosed quote", `Mail,ada,"${MARKER},https://mail.example/`],
  ["quote inside plain field", `Mail,ada,synthetic"${MARKER},https://mail.example/`],
  ["content after closing quote", `Mail,ada,"synthetic"${MARKER},https://mail.example/`],
  ["short record", MARKER],
  ["extra column", `Mail,ada,synthetic,https://mail.example/,${MARKER}`],
  ["empty incomplete quoted record", '""'],
] as const) {
  test(`malformed CSV refuses the entire file with safe DE/EN feedback: ${name}`, () => {
    assert.throws(
      () => parsePlaintextExport(`title,username,password,url\nValid,ada,synthetic,https://mail.example/\n${row}\n`),
      (error: unknown) => {
        assert.ok(error instanceof LineError);
        assert.match(error.line.de, /nichts übernommen/i);
        assert.match(error.line.en, /Nothing was imported/);
        assert.equal(JSON.stringify(error.line).includes(MARKER), false);
        return true;
      },
    );
  });
}

test("unquoted extra physical line is refused instead of exposing it as a title", () => {
  assert.throws(
    () => parsePlaintextExport(`title,username,password,url\nMail,ada,synthetic,https://mail.example/\n${MARKER}\n`),
    LineError,
  );
});

test("unsupported CSV columns use fixed DE/EN feedback without echoing headers", () => {
  assert.throws(() => parsePlaintextExport(`${MARKER},other\nvalue,value\n`), (error: unknown) => {
    assert.ok(error instanceof LineError);
    assert.match(error.line.de, /Spalte/);
    assert.match(error.line.en, /column/);
    assert.equal(JSON.stringify(error.line).includes(MARKER), false);
    return true;
  });
});

test("file service rejects a valid prefix followed by corruption before yielding a preview", async () => {
  const file = {
    text: async () => `title,username,password,url\nMail,ada,synthetic,https://mail.example/\n${MARKER}\n`,
  };
  await assert.rejects(() => parseVaultImportFile(file as File), LineError);
});
