import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBrowserActive, saveBrowserActive } from "./browser-active.ts";

function memoryStorage(): Storage {
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

test("browser active set round-trips per vault", () => {
  const storage = memoryStorage();
  saveBrowserActive(
    "vault-a",
    { extensions: ["brave", "chrome"], profiles: ["chrome:Default"] },
    storage,
  );
  assert.deepEqual(loadBrowserActive("vault-a", storage), {
    extensions: ["brave", "chrome"],
    profiles: ["chrome:Default"],
  });
  assert.equal(loadBrowserActive("vault-b", storage), null);
});

test("corrupt JSON is ignored", () => {
  const storage = memoryStorage();
  storage.setItem("4allpass.browser-active.vault-a", "{not-json");
  assert.equal(loadBrowserActive("vault-a", storage), null);
});
