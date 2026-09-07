import { chromium } from "@playwright/test";

const ORIGIN = "http://127.0.0.1:8793";
const VAULT_PASSWORD = "AiStaging-Vault-2026!";

async function type(page, locator, text) {
  await locator.click();
  await locator.fill("");
  await locator.pressSequentially(text, { delay: 15 });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
try {
  await page.goto(ORIGIN + "/");
  const create = page.getByTestId("create-vault");
  const master = page.getByTestId("master-password");
  await Promise.race([
    create.waitFor({ state: "visible", timeout: 30000 }),
    master.waitFor({ state: "visible", timeout: 30000 }),
  ]);

  if (await master.isVisible().catch(() => false)) {
    console.log("Vault already exists in this data dir — nothing to create.");
  } else {
    await type(page, page.getByTestId("vault-password"), VAULT_PASSWORD);
    await type(page, page.getByTestId("vault-password-repeat"), VAULT_PASSWORD);
    await page.getByTestId("create-vault").click();
    const recoveryKey = await page.getByTestId("recovery-key").textContent({ timeout: 30000 });
    await page.getByRole("checkbox").click();
    await page.getByTestId("dismiss-kit").click();
    await page.waitForTimeout(500);
    const skip = page.getByTestId("onboarding-skip");
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.waitForTimeout(300);

    const entries = [
      { title: "AI Staging — GitHub demo", username: "KItesttresor@netzwerkpunkt.de", password: "Gh-Staging-Pass-1!", url: "https://github.com" },
      { title: "AI Staging — Cloud provider demo", username: "KItesttresor@netzwerkpunkt.de", password: "Cloud-Staging-Pass-2!", url: "https://console.example-cloud.test" },
    ];
    for (const entry of entries) {
      await page.getByTestId("new-entry").click();
      const title = page.getByTestId("entry-title");
      await title.waitFor({ state: "visible", timeout: 15000 });
      await type(page, title, entry.title);
      await type(page, page.getByTestId("entry-username"), entry.username);
      await type(page, page.getByTestId("entry-password"), entry.password);
      await type(page, page.getByRole("textbox", { name: "URL", exact: true }), entry.url);
      await page.getByTestId("save-entry").click();
      await page.waitForTimeout(300);
    }

    console.log("VAULT_PASSWORD=" + VAULT_PASSWORD);
    console.log("RECOVERY_KEY=" + (recoveryKey ?? "").trim());
    console.log("Entries created:", entries.map((e) => e.title).join(", "));
  }
} finally {
  await browser.close();
}
