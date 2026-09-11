import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bilingual,
  langFromNavigator,
  loadCopyMode,
  loadLang,
  normaliseLang,
  pick,
  render,
  saveCopyMode,
  saveLang,
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

test("pick follows the chosen language", () => {
  const plain = { de: "Grün heißt an.", en: "Green means on." };
  assert.equal(pick("plain", "de", plain), "Grün heißt an.");
  assert.equal(pick("plain", "en", plain), "Green means on.");
  // Eine Sprache auf einmal: die andere darf nicht mitlaufen.
  assert.equal(pick("plain", "en", plain).includes("Grün"), false);
  assert.equal(pick("plain", "de", plain).includes("Green"), false);
});

test("render falls back instead of showing nothing", () => {
  assert.equal(render("en", { de: "Sperren", en: "" }), "Sperren");
  assert.equal(render("de", { de: "   ", en: "Lock" }), "Lock");
});

test("unknown languages fall back to German", () => {
  for (const value of ["fr", "klingon", "", null, undefined]) {
    assert.equal(normaliseLang(value), "de");
  }
  assert.equal(normaliseLang("EN-gb"), "en");
  assert.equal(normaliseLang("de_AT"), "de");
});

test("the browser decides when the user has not chosen", () => {
  assert.equal(langFromNavigator(["en-US", "de"]), "en");
  assert.equal(langFromNavigator(["fr-FR", "de-DE"]), "de");
  assert.equal(langFromNavigator(["fr-FR"]), "de");
  assert.equal(langFromNavigator([]), "de");
});

test("a chosen language beats the browser and round-trips", () => {
  const storage = memory();
  assert.equal(loadLang(storage, ["en-US"]), "en");
  saveLang("de", storage);
  assert.equal(loadLang(storage, ["en-US"]), "de");
});

test("a blocked storage does not break the language", () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  } as unknown as Storage;
  assert.equal(loadLang(blocked, ["en-US"]), "en");
  assert.doesNotThrow(() => saveLang("en", blocked));
});

test("bilingual joins DE and EN", () => {
  // Bleibt fuer Texte, die den Umschalter nicht mitmachen duerfen — die
  // Notfall-Datei liest jemand ohne unsere Oberflaeche.
  assert.equal(bilingual({ de: "Sperren", en: "Lock" }), "Sperren / Lock");
  assert.equal(bilingual({ de: "OK", en: "OK" }), "OK");
});
