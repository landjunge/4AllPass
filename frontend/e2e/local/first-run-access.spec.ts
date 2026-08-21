import { expect, test } from "@playwright/test";
import { clickAndType, VAULT_PASSWORD } from "../live/actions.ts";

const DEMO_SECRET = "ghp_demo-not-a-real-key";

test("Welcome → vault → Access allow without showing the secret", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("welcome-create")).toBeVisible();
  await expect(page.getByTestId("welcome-restore")).toBeVisible();
  await expect(page.getByTestId("account-email")).toHaveCount(0);
  await page.getByTestId("welcome-create").click();

  await clickAndType(page, page.getByTestId("vault-password"), VAULT_PASSWORD);
  await clickAndType(page, page.getByTestId("vault-password-repeat"), VAULT_PASSWORD);
  await page.getByTestId("create-vault").click();

  const recoveryKey = (await page.getByTestId("recovery-key").textContent()) ?? "";
  expect(recoveryKey.replace(/-/g, "")).toHaveLength(55);
  await page.getByRole("checkbox").click();
  await page.getByTestId("dismiss-kit").click();
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");

  await page.getByTestId("tab-settings").click();
  await expect(page.getByTestId("launch-at-login")).toBeDisabled();
  await expect(page.getByTestId("launch-at-login-hint")).toContainText("Desktop app only");
  await expect(page.getByTestId("sleep-lock-hint")).toContainText("FileVault");

  await page.getByTestId("tab-access").click();
  await expect(page.getByTestId("n8n-http-body")).toContainText("repository.read");
  await expect(page.getByTestId("n8n-http-body")).not.toContainText("ghp_");
  await expect(page.getByTestId("n8n-http-curl")).not.toContainText("Origin");
  await expect(page.getByTestId("n8n-http-curl")).toContainText("••••");
  await expect(page.getByTestId("n8n-docker-note")).toContainText("host.docker.internal");
  await expect(page.getByTestId("demo-scene")).toContainText("Need a GitHub credential");
  await page.getByTestId("demo-seed").click();
  await expect(page.getByTestId("demo-scene")).toContainText("n8n asks GitHub repository.read", {
    timeout: 60_000,
  });

  await page.getByTestId("demo-n8n-read").click();
  await page.getByTestId("access-allow").click();
  await expect(page.getByTestId("access-flash")).toHaveText("ACCESS GRANTED");
  const grant = page.getByTestId("demo-grant-status");
  await expect(grant).toContainText("n8n");
  await expect(grant).toContainText("s left");
  await expect(grant).not.toContainText("ghp_");
  await expect(grant).not.toContainText(DEMO_SECRET);

  const broker = await page.evaluate(async () => {
    const token = sessionStorage.getItem("4allpass.session");
    const device = localStorage.getItem("4allpass.deviceId");
    const res = await fetch("/api/v1/local/broker", {
      headers: {
        Authorization: `Bearer ${token ?? ""}`,
        "X-Device-Id": device ?? "",
      },
    });
    return res.json() as Promise<{ url: string; token: string }>;
  });
  expect(broker.token.length).toBeGreaterThan(20);
  await expect(page.getByTestId("broker-status")).toContainText("live", { timeout: 15_000 });

  // Node-like client: no Origin header (a page fetch would be 403).
  const incoming = request.post(`${broker.url}/v1/access/request`, {
    headers: {
      Authorization: `Bearer ${broker.token}`,
      "Content-Type": "application/json",
    },
    data: {
      application: "n8n",
      provider: "GitHub",
      credential: "personal",
      scope: ["repository.read"],
      ttl: 15,
    },
  });
  await expect(page.getByTestId("broker-allow")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("broker-allow").click();
  const granted = await incoming;
  expect(granted.ok()).toBeTruthy();
  const body = (await granted.json()) as { status: string; access_token?: string };
  expect(body.status).toBe("approved");
  expect(body.access_token).toBe(DEMO_SECRET);
});
