import { expect, test } from "@playwright/test";
import { addEntryWithMouse, VAULT_PASSWORD } from "../live/actions.ts";

const ORIGIN = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8790";

// Run only against a fresh disposable local profile. Genuine compiled app,
// backend CAS and crypto; only the two postcommit metadata faults are injected.
test("hard revoke adopts the committed key/self-lock and reconciles only metadata", async ({ page }) => {
  await page.goto(ORIGIN);
  await page.getByTestId("vault-password").fill(VAULT_PASSWORD);
  await page.getByTestId("vault-password-repeat").fill(VAULT_PASSWORD);
  await page.getByTestId("create-vault").click();
  const kit = (await page.getByTestId("recovery-key").textContent())!.trim();
  await page.getByRole("checkbox").check();
  await page.getByTestId("dismiss-kit").click();
  await addEntryWithMouse(page, { title: "Synthetic rotation survivor", username: "test@example.invalid", password: "synthetic-vault-entry" });

  const ids = await page.evaluate(async () => {
    const self = localStorage.getItem("4allpass.deviceId")!;
    const headers = { Authorization: `Bearer ${sessionStorage.getItem("4allpass.session")!}`, "X-Device-Id": self, "Content-Type": "application/json" };
    const vaults = await (await fetch("/api/v1/vaults", { headers })).json();
    const vaultId = vaults[0].vaultId as string;
    const other = "dev_synthetic_rotation_target";
    for (const deviceId of [self, other]) {
      const response = await fetch(`/api/v1/vaults/${vaultId}/devices`, {
        method: "POST", headers, body: JSON.stringify({ deviceId, label: "Synthetic rotation fixture" }),
      });
      if (!response.ok) throw new Error("synthetic device metadata setup failed");
    }
    return { self, other };
  });
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("tab-devices").click();

  let posts = 0;
  let deletes = 0;
  let lists = 0;
  let failDelete = true;
  let failList = false;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/snapshots")) posts++;
  });
  await page.route("**/api/v1/vaults/*/devices/**", async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    deletes++;
    if (failDelete) return route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"synthetic metadata outage"}' });
    return route.continue();
  });
  await page.route("**/api/v1/vaults/*/devices", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    lists++;
    if (failList) return route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"synthetic refresh outage"}' });
    return route.continue();
  });

  const rotate = async (target: string) => {
    await page.getByTestId(`rotate-key-${target}`).click();
    await page.getByTestId("rotate-vault-password").fill(VAULT_PASSWORD);
    await page.getByTestId("rotate-recovery-key").fill(kit);
    await page.getByTestId("confirm-rotate").click();
    await expect(page.getByTestId("rotate-vault-password")).toHaveCount(0);
    await expect(page.getByTestId("reconcile-hard-revoke")).toBeEnabled();
  };
  const progress = page.getByTestId("hard-revoke-progress");
  await rotate(ids.other);
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  await expect(page.getByTestId("revision")).toHaveText("revision 3 · vault key v2");
  await page.getByTestId("language-de").click();
  await expect(progress).toContainText("Tresor-Schlüssel bereits gewechselt");
  await page.getByTestId("language-en").click();
  await expect(progress).toContainText("Vault key already rotated");
  expect(posts).toBe(1);

  failDelete = false;
  failList = true;
  await page.getByTestId("reconcile-hard-revoke").click();
  await expect(progress).toContainText("device revocation at the service confirmed");
  await expect(page.getByTestId("reconcile-hard-revoke")).toBeEnabled();
  const acknowledgedDeletes = deletes;
  const failedLists = lists;
  failList = false;
  await page.getByTestId("reconcile-hard-revoke").click();
  await expect(progress).toHaveCount(0);
  expect(deletes).toBe(acknowledgedDeletes);
  expect(lists).toBe(failedLists + 1);
  expect(posts).toBe(1);

  failDelete = true;
  await rotate(ids.self);
  await expect(page.getByTestId("lock-state")).toHaveText("LOCKED");
  await expect(page.getByTestId("master-password")).toBeVisible();
  await expect(progress).toContainText("Vault key already rotated");
  await page.getByTestId("language-de").click();
  await expect(progress).toContainText("Tresor-Schlüssel bereits gewechselt");
  expect(posts).toBe(2);
  failDelete = false;
  await page.getByTestId("reconcile-hard-revoke").click();
  await expect(progress).toHaveCount(0);
  expect(posts).toBe(2);
  await page.getByTestId("master-password").fill(VAULT_PASSWORD);
  await page.getByTestId("unlock-submit").click();
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  await expect(page.getByTestId("revision")).toHaveText("revision 4 · vault key v3");
  await page.getByTestId("tab-entries").click();
  await expect(page.getByRole("button", { name: /Synthetic rotation survivor/ })).toBeVisible();
});
