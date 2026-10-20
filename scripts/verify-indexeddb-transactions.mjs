#!/usr/bin/env node
/**
 * Verify both local stores with real Chromium IndexedDB, no backend or app.
 * Fresh contexts contain synthetic records only; all page requests are routed
 * to in-memory fixtures or blocked. The optional source commit supports red
 * regression checks without changing the checkout. Requires installed Chrome.
 * Run: node scripts/verify-indexeddb-transactions.mjs [source-commit]
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRef = process.argv[2];
if (process.argv.length > 3 || (sourceRef && !/^[a-f0-9]{7,40}$/.test(sourceRef))) {
  throw new Error("Usage: node scripts/verify-indexeddb-transactions.mjs [source-commit]");
}
const origin = "http://127.0.0.1:49731";
const sources = {
  snapshot: "frontend/src/lib/snapshot-cache.ts",
  device: "packages/webauthn/src/store.ts",
};
const modules = {};
const sourceSha256 = {};
for (const [kind, path] of Object.entries(sources)) {
  const source = sourceRef
    ? execFileSync("git", ["show", `${sourceRef}:${path}`], { cwd: root, encoding: "utf8" })
    : await readFile(join(root, path), "utf8");
  sourceSha256[path] = createHash("sha256").update(source).digest("hex");
  modules[kind] = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const kind of Object.keys(sources)) {
    for (const operation of ["save", "load", "remove"]) {
      for (const abort of [false, true]) {
        const context = await browser.newContext();
        try {
          await context.route("**/*", async (route) => {
            const url = route.request().url();
            if (url === `${origin}/module.js`) {
              return route.fulfill({ contentType: "text/javascript", body: modules[kind] });
            }
            if (url === `${origin}/e03.html`) {
              return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>E03 synthetic IndexedDB</title>" });
            }
            return route.abort();
          });
          const page = await context.newPage();
          await page.goto(`${origin}/e03.html`);
          const row = await page.evaluate(async ({ kind, operation, abort }) => {
            const module = await import("/module.js");
            const snapshot = {
              vaultId: "synthetic-cache-vault", revision: 1, vaultKeyVersion: 1,
              cryptoProtocolVersion: 1, entries: [], envelopes: [],
            };
            const record = {
              vaultId: "synthetic-device-vault", deviceId: "synthetic-device-id", rpId: "localhost",
              credentialId: "c3ludGhldGljLWNyZWRlbnRpYWw=", mechanism: "prf",
              deviceKeyVersion: 1, createdAt: "2026-10-20T00:00:00Z",
            };
            const value = kind === "snapshot" ? snapshot : record;
            const dbName = kind === "snapshot" ? "4allpass-snapshot-cache" : "e03-synthetic-device-record";
            const storeName = kind === "snapshot" ? "wire" : "device-unlock";
            const key = kind === "snapshot" ? value.vaultId : `${value.vaultId}\u0000${value.deviceId}`;
            async function rawDb() {
              const opening = indexedDB.open(dbName, 1);
              opening.onupgradeneeded = () => opening.result.createObjectStore(storeName);
              return new Promise((resolve, reject) => {
                opening.onsuccess = () => resolve(opening.result);
                opening.onerror = () => reject(opening.error);
              });
            }
            if (operation !== "save") {
              const db = await rawDb();
              await new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, "readwrite");
                tx.oncomplete = resolve;
                tx.onabort = () => reject(tx.error);
                tx.objectStore(storeName).put(value, key);
              });
              db.close();
            }
            const events = [];
            const original = IDBDatabase.prototype.transaction;
            IDBDatabase.prototype.transaction = function (...args) {
              const tx = Reflect.apply(original, this, args);
              tx.addEventListener("complete", () => events.push("complete"));
              tx.addEventListener("abort", () => events.push("abort"));
              const objectStore = tx.objectStore.bind(tx);
              tx.objectStore = function (...args) {
                const store = objectStore(...args);
                const originalRequest = store[operation === "save" ? "put" : operation === "load" ? "get" : "delete"].bind(store);
                store[operation === "save" ? "put" : operation === "load" ? "get" : "delete"] = function (...args) {
                  const request = originalRequest(...args);
                  request.addEventListener("success", () => {
                    events.push("request-success");
                    if (abort) tx.abort();
                  }, { once: true });
                  return request;
                };
                return store;
              };
              return tx;
            };
            let rejected = false;
            let errorName = null;
            let result;
            let timedOut = false;
            let timer;
            let transactionEndedWhenSettled;
            try {
              const cache = kind === "snapshot"
                ? module.indexedDbSnapshotCache()
                : module.indexedDbDeviceUnlockStore(dbName);
              const pending = operation === "save"
                ? kind === "snapshot" ? cache.save(value.vaultId, value) : cache.save(value)
                : kind === "snapshot" ? cache[operation](value.vaultId)
                  : cache[operation](value.vaultId, value.deviceId);
              result = await Promise.race([
                pending,
                new Promise((_, reject) => {
                  timer = setTimeout(() => {
                    timedOut = true;
                    reject(new Error("store operation did not settle"));
                  }, 2000);
                }),
              ]);
            } catch (error) {
              rejected = true;
              errorName = error?.name ?? "unknown";
            } finally {
              clearTimeout(timer);
              transactionEndedWhenSettled = events.includes(abort ? "abort" : "complete");
              IDBDatabase.prototype.transaction = original;
            }
            const db = await rawDb();
            const persisted = await new Promise((resolve, reject) => {
              const tx = db.transaction(storeName, "readonly");
              const request = tx.objectStore(storeName).get(key);
              tx.oncomplete = () => resolve(request.result ?? null);
              tx.onabort = () => reject(tx.error);
            });
            db.close();
            const expectedPersisted = operation === "save" ? (abort ? null : value)
              : operation === "remove" ? (abort ? value : null) : value;
            const persistedMatches = JSON.stringify(persisted) === JSON.stringify(expectedPersisted);
            const resultMatches = operation === "load"
              ? JSON.stringify(result) === JSON.stringify(value) : result === undefined;
            return {
              kind, operation, abort, rejected, errorName, timedOut, transactionEndedWhenSettled,
              persistedMatches, resultMatches, events,
              passed: !timedOut && persistedMatches && transactionEndedWhenSettled && (abort ? rejected : !rejected && resultMatches),
            };
          }, { kind, operation, abort });
          results.push(row);
        } finally {
          await context.close();
        }
      }
    }
  }
} finally {
  const summary = {
    sourceRef: sourceRef ?? "working-tree", sourceSha256, browser: browser.version(),
    headless: true, freshContextPerCase: true,
    network: "All page requests fulfilled locally or aborted; no HTTP server or app/backend started",
    source: sources, tests: results.length, passed: results.filter((row) => row.passed).length,
    failed: results.filter((row) => !row.passed).length, results,
  };
  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
  process.exitCode = summary.failed ? 1 : 0;
}
