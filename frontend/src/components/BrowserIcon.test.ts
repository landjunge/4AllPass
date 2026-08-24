import assert from "node:assert/strict";
import { test } from "node:test";
import { browserIconVariant } from "./BrowserIcon.tsx";

const SPECS = [
  "chrome",
  "chrome-canary",
  "chromium",
  "brave",
  "edge",
  "arc",
  "vivaldi",
  "opera",
  "opera-gx",
  "firefox",
  "firefox-developer",
  "firefox-nightly",
  "safari",
];

test("every listed browser has a real mark, not the letter fallback", () => {
  for (const id of SPECS) {
    assert.equal(browserIconVariant(id), id);
  }
});

test("unknown browser ids fall back instead of pretending to be Chrome", () => {
  assert.equal(browserIconVariant("netscape"), "fallback");
  assert.equal(browserIconVariant(""), "fallback");
});
