import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clickAndType, VAULT_PASSWORD } from "../live/actions.ts";
import { emptyDraft, type VaultEntry } from "../../src/lib/entries.ts";
import { buildSharePackage } from "../../src/lib/share.ts";

const RESTORED_TITLE = "GitHub (restored)";
const DEMO_SECRET = "ghp_demo-not-a-real-key";

function githubEntry(): VaultEntry {
  return {
    id: "entry_restored",
    ...emptyDraft("api"),
    title: RESTORED_TITLE,
    provider: "GitHub",
    account: "personal",
    password: DEMO_SECRET,
    capabilities: "repository.read",
    credentialType: "personal_access_token",
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
}

test("Welcome restore from share file — new recovery key, secret stays in vault", async ({
  page,
}) => {
  const built = buildSharePackage([githubEntry()]);
  const sharePath = join(tmpdir(), "4allpass-restore-share.json");
  writeFileSync(sharePath, built.json);

  await page.goto("/");
  await expect(page.getByTestId("welcome-restore")).toBeVisible();
  await page.getByTestId("welcome-restore").click();
  await page.getByTestId("restore-file").setInputFiles(sharePath);
  await clickAndType(page, page.getByTestId("restore-share-key"), built.shareKey);
  await clickAndType(page, page.getByTestId("vault-password"), VAULT_PASSWORD);
  await clickAndType(page, page.getByTestId("vault-password-repeat"), VAULT_PASSWORD);
  await page.getByTestId("restore-vault").click();

  const recoveryKey = (await page.getByTestId("recovery-key").textContent()) ?? "";
  expect(recoveryKey.replace(/-/g, "")).toHaveLength(55);
  expect(recoveryKey).not.toEqual(built.shareKey);
  await page.getByRole("checkbox").click();
  await page.getByTestId("dismiss-kit").click();
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  await expect(page.getByText(RESTORED_TITLE)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("ghp_");
});
