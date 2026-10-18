import { expect, test } from "@playwright/test";
import { clickAndType, reachUnlockedLocalApp, VAULT_PASSWORD } from "../live/actions.ts";

const DEMO_SECRET = "ghp_demo-not-a-real-key";

test("Create → vault → machine access blocked without exposing a secret", async ({ page }) => {
  await page.goto("/");
  const create = page.getByTestId("create-vault");
  const unlock = page.getByTestId("master-password");
  await expect(create.or(unlock)).toBeVisible();
  if (await create.isVisible()) {
    await expect(page.getByTestId("create-back")).toBeVisible();
    await expect(page.getByTestId("account-email")).toHaveCount(0);
    await clickAndType(page, page.getByTestId("vault-password"), VAULT_PASSWORD);
    await clickAndType(page, page.getByTestId("vault-password-repeat"), VAULT_PASSWORD);
    await page.getByTestId("create-vault").click();

    const recoveryKey = (await page.getByTestId("recovery-key").textContent()) ?? "";
    expect(recoveryKey.replace(/-/g, "")).toHaveLength(55);
    await expect(page.getByTestId("dismiss-kit")).toBeDisabled();
    await page.getByTestId("confirm-kit-stored").click();
    await expect(page.getByTestId("dismiss-kit")).toBeEnabled();
    await page.getByTestId("dismiss-kit").click();
    await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
    const skip = page.getByTestId("onboarding-skip");
    if (await skip.isVisible().catch(() => false)) await skip.click();
  } else {
    await reachUnlockedLocalApp(page);
  }

  await page.getByTestId("tab-settings").click();
  await expect(page.getByTestId("launch-at-login")).toBeDisabled();
  await expect(page.getByTestId("launch-at-login-hint")).toContainText("Desktop app only");
  await expect(page.getByTestId("sleep-lock-hint")).toContainText("FileVault");
  await expect(page.getByTestId("uninstall-hint")).toContainText("löscht den Tresor nicht");

  await page.getByTestId("tab-access").click();
  await expect(page.getByRole("status")).toContainText("Machine access is blocked");
  await expect(page.getByTestId("access-allow")).toHaveCount(0);
  await expect(page.getByTestId("demo-seed")).toHaveCount(0);
  await expect(page.getByTestId("access-security-status")).not.toContainText(DEMO_SECRET);

  const brokerStatus = await page.evaluate(async () => {
    const token = sessionStorage.getItem("4allpass.session");
    const device = localStorage.getItem("4allpass.deviceId");
    const res = await fetch("/api/v1/local/broker", {
      headers: {
        Authorization: `Bearer ${token ?? ""}`,
        "X-Device-Id": device ?? "",
      },
    });
    return res.status;
  });
  // Passwordless local@ is not a pairing identity. Sidecar HTTP n8n still
  // needs an e-mail session (desktop Konto) or broker.token on disk.
  expect(brokerStatus).toBe(404);
});
