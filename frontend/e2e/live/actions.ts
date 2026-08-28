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
  await clickAndType(page, page.getByLabel("E-mail"), email);
  await clickAndType(page, page.getByLabel("Account password"), ACCOUNT_PASSWORD);
  await page.getByTestId("auth-submit").click();
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
  await page.getByTestId("auth-switch").click();
  await clickAndType(page, page.getByLabel("E-mail"), email);
  await clickAndType(page, page.getByLabel("Account password"), ACCOUNT_PASSWORD);
  await page.getByTestId("auth-submit").click();
}

/** Local-first: CreateVaultPage is the empty screen. Welcome is gone. */
export async function beginCreateVault(page: Page): Promise<void> {
  const welcome = page.getByTestId("welcome-create");
  if (await welcome.isVisible().catch(() => false)) await welcome.click();
  await expect(page.getByTestId("vault-password")).toBeVisible({ timeout: 60_000 });
}

async function dismissRecoveryKit(page: Page): Promise<void> {
  await expect(page.getByTestId("confirm-kit-stored")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("confirm-kit-stored").click();
  await page.getByTestId("dismiss-kit").click();
}

/**
 * Local sidecar (shared SQLite, workers:1). After the first vault exists,
 * later tests see Unlock (`master-password`), not Create (`vault-password`).
 * The browser-cards Tauri stub sets `__TAURI_INTERNALS__`, so silent
 * `/auth/local` is skipped and Auth (`auth-submit`) is first.
 */
export async function reachUnlockedLocalApp(page: Page): Promise<void> {
  const auth = page.getByTestId("auth-submit");
  const createPassword = page.getByTestId("vault-password");
  const unlockPassword = page.getByTestId("master-password");
  await expect(auth.or(createPassword).or(unlockPassword)).toBeVisible({ timeout: 60_000 });

  if (await auth.isVisible()) {
    await clickAndType(page, page.getByLabel("E-mail"), uniqueEmail());
    await clickAndType(page, page.getByLabel("Account password"), ACCOUNT_PASSWORD);
    await page.getByTestId("auth-submit").click();
    const error = page.getByTestId("error-banner");
    await Promise.race([
      createPassword.waitFor({ state: "visible" }),
      unlockPassword.waitFor({ state: "visible" }),
      error.waitFor({ state: "visible" }),
    ]);
    if (await error.isVisible()) {
      throw new Error(`sign-up failed: ${((await error.textContent()) ?? "").trim()}`);
    }
  }

  if (await unlockPassword.isVisible()) {
    await unlockWithVaultPassword(page);
    await skipOnboardingWhenItAppears(page);
    return;
  }

  await clickAndType(page, page.getByTestId("vault-password"), VAULT_PASSWORD);
  await clickAndType(page, page.getByTestId("vault-password-repeat"), VAULT_PASSWORD);
  await page.getByTestId("create-vault").click();
  await dismissRecoveryKit(page);
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  await skipOnboardingWhenItAppears(page);
}

async function skipOnboardingWhenItAppears(page: Page): Promise<void> {
  const skip = page.getByTestId("onboarding-skip");
  try {
    await skip.waitFor({ state: "visible", timeout: 8_000 });
    await skip.click();
  } catch {
    // Already on the desk, or this vault skipped the wizard.
  }
}

export async function createVaultWithMouse(page: Page): Promise<string> {
  await beginCreateVault(page);
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

export async function skipOnboardingIfPresent(page: Page): Promise<void> {
  const skip = page.getByTestId("onboarding-skip");
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }
}

export async function addEntryWithMouse(
  page: Page,
  entry: { title: string; username: string; password: string; url?: string },
): Promise<void> {
  await skipOnboardingIfPresent(page);
  await page.getByTestId("new-entry").click();
  const title = page.getByTestId("entry-title");
  await expect(title).toBeVisible({ timeout: 30_000 });
  await title.scrollIntoViewIfNeeded();
  await clickAndType(page, title, entry.title);
  await clickAndType(page, page.getByTestId("entry-username"), entry.username);
  await clickAndType(page, page.getByTestId("entry-password"), entry.password);
  if (entry.url) await clickAndType(page, page.getByLabel("URL", { exact: true }), entry.url);
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
