import { expect, type Locator, type Page } from "@playwright/test";

export const ACCOUNT_PASSWORD = "account-password-1234";
export const VAULT_PASSWORD = "korrektes-pferd-batterie-heftklammer";

export const ENTRIES = [
  { title: "GitHub", username: "ada@example.com", password: "s3cret-github-42" },
  { title: "Bank", username: "ada", password: "s3cret-bank-99" },
] as const;

function uniqueEmail(): string {
  return `live_${Date.now()}_${Math.floor(Math.random() * 10_000)}@example.com`;
}

/** Real mouse click, then type like a person — not `fill()`. */
export async function clickAndType(page: Page, locator: Locator, text: string): Promise<void> {
  await locator.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await locator.pressSequentially(text, { delay: 35 });
}

export async function signUpWithMouse(page: Page): Promise<string> {
  const email = uniqueEmail();
  await page.goto("/");
  await page.getByRole("button", { name: "Need an account?" }).click();
  await clickAndType(page, page.getByLabel("E-mail"), email);
  await clickAndType(page, page.getByLabel("Account password"), ACCOUNT_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  const error = page.getByTestId("error-banner");
  await Promise.race([
    page.getByTestId("account-email").waitFor({ state: "visible" }),
    error.waitFor({ state: "visible" }),
  ]);
  if (await error.isVisible()) {
    throw new Error(`sign-up failed: ${((await error.textContent()) ?? "").trim()}`);
  }
  await expect(page.getByTestId("account-email")).toHaveText(email);
  return email;
}

export async function signInWithMouse(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await clickAndType(page, page.getByLabel("E-mail"), email);
  await clickAndType(page, page.getByLabel("Account password"), ACCOUNT_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

export async function createVaultWithMouse(page: Page): Promise<string> {
  await clickAndType(page, page.getByLabel("Vault password"), VAULT_PASSWORD);
  await clickAndType(page, page.getByLabel("Repeat"), VAULT_PASSWORD);
  await page.getByRole("button", { name: "Create vault" }).click();
  const recoveryKey = (await page.getByTestId("recovery-key").textContent()) ?? "";
  expect(recoveryKey.replace(/-/g, "")).toHaveLength(55);
  await page.getByRole("checkbox").click();
  await page.getByTestId("dismiss-kit").click();
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  return recoveryKey;
}

export async function unlockWithVaultPassword(page: Page): Promise<void> {
  await clickAndType(page, page.getByTestId("master-password"), VAULT_PASSWORD);
  await page.getByTestId("unlock-submit").click();
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
}

export async function addEntryWithMouse(
  page: Page,
  entry: { title: string; username: string; password: string },
): Promise<void> {
  await page.getByTestId("new-entry").click();
  await clickAndType(page, page.getByTestId("entry-title"), entry.title);
  await clickAndType(page, page.getByTestId("entry-username"), entry.username);
  await clickAndType(page, page.getByTestId("entry-password"), entry.password);
  await page.getByTestId("save-entry").click();
  await expect(page.getByRole("button", { name: new RegExp(entry.title) })).toBeVisible();
}

export async function expectLocked(page: Page): Promise<void> {
  await expect(page.getByTestId("lock-state")).toHaveText("LOCKED");
  await expect(page.getByRole("button", { name: new RegExp(ENTRIES[0].title) })).toHaveCount(0);
  await expect(page.getByTestId("master-password")).toBeVisible();
}

export async function expectEntriesVisible(page: Page): Promise<void> {
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  for (const entry of ENTRIES) {
    await expect(page.getByRole("button", { name: new RegExp(entry.title) })).toBeVisible();
  }
}
