import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, chromium } from "@playwright/test";
import { VAULT_PASSWORD, addEntryWithMouse } from "../live/actions.ts";
import { ensureLocalVault } from "./vault.ts";

const DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../extension/dist/chromium",
);
const ORIGIN = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8794";

async function launchExtension() {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      "--enable-unsafe-extension-debugging",
    ],
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  return { context, extensionId };
}

async function unlockAndFill(
  context: Awaited<ReturnType<typeof launchExtension>>["context"],
  extensionId: string,
  loginUrl: string,
  field: { user: string; pass: string; userSel: string; passSel: string; pickTitle?: string },
) {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator("#api").fill(ORIGIN);
  await popup.locator("#vault").fill(VAULT_PASSWORD);
  await popup.locator("#unlock-btn").click();
  await expect(popup.locator("#status")).toContainText("Unlocked", { timeout: 60_000 });

  const login = await context.newPage();
  await login.goto(loginUrl);
  await expect(login.locator(field.userSel)).toBeVisible();

  await login.bringToFront();
  await popup.bringToFront();
  await popup.locator("#fill").click();
  if (field.pickTitle) {
    const pick = popup.locator("#picks button").filter({ hasText: field.pickTitle });
    await pick.click({ timeout: 8_000 }).catch(() => undefined);
  }
  await expect(login.locator(field.userSel)).toHaveValue(field.user);
  await expect(login.locator(field.passSel)).toHaveValue(field.pass);
  return login;
}

test("local vault password unlocks the extension and fills the demo login", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const page = await context.newPage();
    await ensureLocalVault(page, ORIGIN);
    await addEntryWithMouse(page, {
      title: "Demo login",
      username: "ada@example.com",
      password: "s3cret-autofill",
      url: `${ORIGIN}/test-login.html`,
    });
    const login = await unlockAndFill(context, extensionId, `${ORIGIN}/test-login.html`, {
      user: "ada@example.com",
      pass: "s3cret-autofill",
      userSel: "#username",
      passSel: "#password",
    });
    await expect(login.locator("#trap-opacity")).toHaveValue("");
    await expect(login.locator("#trap-tiny")).toHaveValue("");
    await expect(login.locator("#trap-aria")).toHaveValue("");
  } finally {
    await context.close();
  }
});

test("local vault fills a GitHub-shaped login in one click", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const page = await context.newPage();
    await ensureLocalVault(page, ORIGIN);
    await addEntryWithMouse(page, {
      title: "GitHub",
      username: "ada@example.com",
      password: "s3cret-github-42",
      url: `${ORIGIN}/test-login-github.html`,
    });
    const login = await unlockAndFill(context, extensionId, `${ORIGIN}/test-login-github.html`, {
      user: "ada@example.com",
      pass: "s3cret-github-42",
      userSel: "#login_field",
      passSel: "#password",
      pickTitle: "GitHub",
    });
    await expect(login.locator('input[name="required_field_test"]')).toHaveValue("");
  } finally {
    await context.close();
  }
});
