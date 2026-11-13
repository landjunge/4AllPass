/**
 * Targeted checks for the shared appbar host: the canonical module CSS is
 * loaded, <html lang> follows the DE/EN choice, and the untouched module keeps
 * its 44px targets / visually-hidden helper text. No crypto, lock or vault.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { applyDocumentLang } from "./copy-mode.ts";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, "..", "..");

test("index.html loads the canonical appbar module CSS", () => {
  const html = readFileSync(join(frontend, "index.html"), "utf8");
  assert.match(html, /<link[^>]+href="\/networkpunkt\/networkpunkt-appbar\.css"/);
});

test("canonical appbar CSS keeps 44px targets, sr-only and hidden version", () => {
  const css = readFileSync(join(frontend, "public", "networkpunkt", "networkpunkt-appbar.css"), "utf8");
  assert.match(css, /\.np-appbar-button\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
  assert.match(css, /\.np-appbar-art[^{]*\{[^}]*width:\s*32px[^}]*height:\s*32px/);
  assert.match(css, /\.np-appbar-sr\s*\{[^}]*clip-path:\s*inset\(50%\)/);
  assert.match(css, /\.np-appbar-version\s*\{\s*display:\s*none/);
});

test("applyDocumentLang follows the DE/EN choice", () => {
  const root = { documentElement: { lang: "de" } };
  applyDocumentLang("en", root);
  assert.equal(root.documentElement.lang, "en");
  applyDocumentLang("de", root);
  assert.equal(root.documentElement.lang, "de");
});

test("applyDocumentLang is a no-op without a DOM", () => {
  assert.doesNotThrow(() => applyDocumentLang("en", undefined));
});
