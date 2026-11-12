/** Isolated browser contract check: real AP wrapper + pinned renderer, no app/backend. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const sources = new Set([
  "/frontend/src/lib/family-header.ts",
  "/frontend/src/lib/webauthnCapabilities.ts",
  "/frontend/src/modules/desktop-adapter/index.ts",
]);
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://fixture").pathname;
    if (path === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end('<html lang="de"><link rel="stylesheet" href="/networkpunkt/networkpunkt-appbar.css"><main><div id="header"></div></main></html>');
      return;
    }
    let file;
    if (sources.has(path)) file = resolve(root, `.${path}`);
    else if (/^\/networkpunkt\/[\w.-]+$/.test(path)) file = resolve(root, `frontend/public${path}`);
    else if (/^\/node_modules\/@tauri-apps\/api\/(?:[\w.-]+\/)*[\w.-]+\.js$/.test(path) && !path.includes("..")) file = resolve(root, `.${path}`);
    else { res.writeHead(404).end(); return; }
    let body = await readFile(file);
    if (sources.has(path)) {
      body = ts.transpileModule(body.toString(), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText.replaceAll('"@tauri-apps/api/core"', '"/node_modules/@tauri-apps/api/core.js"');
    }
    res.setHeader("Content-Type", path.endsWith(".png") ? "image/png" : path.endsWith(".css") ? "text/css" : "text/javascript");
    res.end(body);
  } catch { res.writeHead(500).end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    window.calls = 0;
    window.__TAURI_INTERNALS__ = { invoke: async () => { window.calls++; throw new Error("lost receipt"); } };
    const { mountFamilyHeader } = await import("/frontend/src/lib/family-header.ts");
    window.lock = "UNLOCKED";
    window.header = await mountFamilyHeader(document.querySelector("#header"), { locale: "de", lockState: () => window.lock });
  });
  const self = page.locator('[data-app-id="4allpass"]');
  await self.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-app-id="4allpass"]').dataset.state === "confirmed");
  assert.equal(await self.locator(".np-appbar-ring").getAttribute("data-pulse"), "false");
  const box = await self.boundingBox();
  assert.equal(box.width, 44); assert.equal(box.height, 44);
  const art = await self.locator(".np-appbar-art").boundingBox();
  assert.equal(Math.max(art.width, art.height), 32);
  for (const [lock, expected] of [["LOCKED", "confirmed"], ["UNLOCKING", "unknown"], ["LOCKING", "unknown"]]) {
    await page.evaluate(lock => { window.lock = lock; window.header.refresh(); }, lock);
    await page.waitForFunction(expected => document.querySelector('[data-app-id="4allpass"]').dataset.state === expected, expected);
  }
  const target = page.locator('[data-app-id="threaddesk"]');
  await target.click();
  await page.waitForFunction(() => document.querySelector('[data-app-id="threaddesk"]').getAttribute("aria-disabled") === "true");
  await page.waitForTimeout(700);
  await target.dispatchEvent("click");
  assert.equal(await page.evaluate(() => window.calls), 1, "lost IPC receipt must not offer a retry");
  await page.evaluate(() => { document.documentElement.lang = "en"; window.header.setLocale("en"); });
  await page.waitForFunction(() => document.querySelector(".np-appbar").lang === "en");
  assert.match(await target.getAttribute("aria-label"), /unknown|Check app/);
  await page.evaluate(() => window.header.destroy());
  assert.equal(await page.locator(".np-appbar").count(), 0);
  assert.equal(await page.locator("dialog").count(), 0);
  console.log("PASS: real host/renderer self states, no false vault pulse, 44px targets/32px artwork, lost-IPC retry block, DE/EN, cleanup");
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
