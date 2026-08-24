import assert from "node:assert/strict";
import { test } from "node:test";
import { bilingual, loadCopyMode, pick, saveCopyMode } from "./copy-mode.ts";

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
  assert.match(pick("plain", plain, expert), /Grün heißt an/);
  assert.equal(pick("plain", plain, expert).includes("Extension-Instanz"), false);
  assert.match(pick("expert", plain, expert), /Extension-Instanz/);
});

test("bilingual joins DE and EN", () => {
  assert.equal(bilingual({ de: "Sperren", en: "Lock" }), "Sperren / Lock");
  assert.equal(bilingual({ de: "OK", en: "OK" }), "OK");
});
