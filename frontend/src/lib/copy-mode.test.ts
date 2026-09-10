import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bilingual,
  inLanguage,
  loadCopyMode,
  loadLanguage,
  pick,
  saveCopyMode,
  saveLanguage,
} from "./copy-mode.ts";

function memory(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
    key() {
      return null;
    },
  } as Storage;
}

test("plain language is the default", () => {
  assert.equal(loadCopyMode(memory()), "plain");
});

test("expert mode round-trips", () => {
  const storage = memory();
  saveCopyMode("expert", storage);
  assert.equal(loadCopyMode(storage), "expert");
});

test("pick uses plain unless expert and expert copy exists", () => {
  const plain = { de: "Grün heißt an.", en: "Green means on." };
  const expert = { de: "Extension-Instanz merkt den Haken.", en: "The extension instance stores the tick." };
  assert.match(pick("plain", "de", plain, expert), /Grün heißt an/);
  assert.equal(pick("plain", "de", plain, expert).includes("Extension-Instanz"), false);
  assert.match(pick("expert", "de", plain, expert), /Extension-Instanz/);
});

test("pick renders one language, never both", () => {
  const line = { de: "Sperren", en: "Lock" };
  assert.equal(pick("plain", "de", line), "Sperren");
  assert.equal(pick("plain", "en", line), "Lock");
  // The whole point of the switch: no more "Sperren / Lock" on a surface.
  assert.equal(pick("plain", "de", line).includes("/"), false);
  assert.equal(pick("plain", "en", line).includes("/"), false);
});

test("a missing translation falls back instead of rendering an empty label", () => {
  assert.equal(inLanguage("en", { de: "Nur Deutsch", en: "" }), "Nur Deutsch");
  assert.equal(inLanguage("de", { de: "   ", en: "English only" }), "English only");
});

test("German is the default until the user chooses", () => {
  // Not sniffed from the system: the desktop webview would otherwise start
  // the same build in a different language than the browser does.
  assert.equal(loadLanguage(memory()), "de");
});

test("a stored choice is what decides", () => {
  const storage = memory();
  saveLanguage("en", storage);
  assert.equal(loadLanguage(storage), "en");
  saveLanguage("de", storage);
  assert.equal(loadLanguage(storage), "de");
});

test("bilingual still joins DE and EN for the callers that want both", () => {
  assert.equal(bilingual({ de: "Sperren", en: "Lock" }), "Sperren / Lock");
  assert.equal(bilingual({ de: "OK", en: "OK" }), "OK");
});
