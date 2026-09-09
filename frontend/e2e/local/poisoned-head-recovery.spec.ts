import { expect, test } from "@playwright/test";
import { addEntryWithMouse, clickAndType, VAULT_PASSWORD } from "../live/actions.ts";
import { ensureLocalVault } from "../extension/vault.ts";

const ORIGIN = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8790";

/**
 * ADR-015 §2 — the actual attack from issue #201, end to end.
 *
 * A session token is enough to commit a snapshot the server accepts and no
 * client can open: the server never verifies the sealed manifest. Before this
 * change that was terminal in practice — the vault would not open, and the
 * revision history that could have saved it lives *inside* the unlocked vault.
 */
test("a vault poisoned by a token-only writer can be recovered at unlock", async ({ page }) => {
  await ensureLocalVault(page, ORIGIN);
  await addEntryWithMouse(page, {
    title: "Überlebt den Angriff",
    username: "ada@example.com",
    password: "survives-the-attack-42",
  });
  await expect(page.getByRole("button", { name: /Überlebt den Angriff/ })).toBeVisible();

  // The attack: reuse only what a stolen session has — the bearer token — and
  // commit a well-formed revision whose manifest is bound to the wrong one.
  const poisoned = await page.evaluate(async () => {
    const token = sessionStorage.getItem("4allpass.session");
    const deviceId = localStorage.getItem("4allpass.deviceId") ?? "";
    const headers = {
      Authorization: `Bearer ${token ?? ""}`,
      "X-Device-Id": deviceId,
      "Content-Type": "application/json",
    };
    const vaults = (await (await fetch("/api/v1/vaults", { headers })).json()) as Array<{
      vaultId: string;
    }>;
    const vaultId = vaults[0]?.vaultId ?? "";
    const head = (await (
      await fetch(`/api/v1/vaults/${vaultId}/snapshot`, { headers })
    ).json()) as Record<string, unknown>;

    const response = await fetch(`/api/v1/vaults/${vaultId}/snapshots`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        expectedRevision: head.revision,
        revision: (head.revision as number) + 1,
        vaultKeyVersion: head.vaultKeyVersion,
        cryptoProtocolVersion: 1,
        envelopes: head.envelopes,
        entries: [],
        // Bound to the previous revision, so no client can verify it here.
        sealedManifest: head.sealedManifest,
      }),
    });
    return response.status;
  });
  // The server has no way to refuse this today. That is issue #201.
  expect(poisoned).toBe(200);

  await page.reload();
  await clickAndType(page, page.getByTestId("master-password"), VAULT_PASSWORD);
  await page.getByTestId("unlock-submit").click();

  // Not "wrong password" — damaged, and offered a way back.
  await expect(page.getByTestId("unlock-damaged")).toBeVisible();
  await page.getByTestId("find-recovery").click();
  await expect(page.getByTestId("recovery-found")).toBeVisible();

  await page.getByTestId("accept-recovery").click();

  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  await expect(page.getByRole("button", { name: /Überlebt den Angriff/ })).toBeVisible();
});
