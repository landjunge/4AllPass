import { expect, test } from "@playwright/test";
import { addEntryWithMouse } from "../live/actions.ts";
import { ensureLocalVault } from "../extension/vault.ts";

// Use the project baseURL (E2E_LOCAL_PORT) instead of a hardcoded default:
// 8790 can be occupied by an unrelated service, which made the bootstrap land
// on a foreign Auth screen. Empty origin keeps goto() relative to baseURL.
const ORIGIN = process.env.E2E_BASE_URL ?? "";

/**
 * V7.3 — Einstellungen → Sicherheit → Frühere Stände.
 *
 * Restoring must read like a normal undo to the user while staying a forward
 * commit underneath: the state that was live stays listed afterwards.
 */
async function pinSnapshot(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith("4allpass.pin."))
    .map((key) => localStorage.getItem(key) ?? "")
    .sort());
}

function revisionNumber(text: string): number {
  const match = /revision\s+(\d+)/.exec(text);
  if (!match) throw new Error(`revision text missing: ${text}`);
  return Number(match[1]);
}

test("an accidentally deleted entry comes back from an earlier state", async ({ page }) => {
  await ensureLocalVault(page, ORIGIN);

  await addEntryWithMouse(page, {
    title: "Wichtiger Zugang",
    username: "ada@example.com",
    password: "do-not-lose-this-42",
  });
  await expect(page.getByRole("button", { name: /Wichtiger Zugang/ })).toBeVisible();

  // The accident: open it and delete it.
  await page.getByRole("button", { name: /Wichtiger Zugang/ }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: /Löschen|Delete/ }).click();
  await expect(page.getByRole("button", { name: /Wichtiger Zugang/ })).toHaveCount(0);

  // History lives under Settings → Security, not on the desk.
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("tab-security").click();
  const history = page.getByTestId("settings-history");
  await expect(history).toBeVisible();

  const revisionBefore = revisionNumber((await page.getByTestId("revision").textContent()) ?? "");
  const pinBefore = await pinSnapshot(page);
  expect(pinBefore).toHaveLength(1);

  const rows = page.getByTestId("history-list").getByRole("button");
  await expect(rows.first()).toBeVisible();
  await rows.first().click();

  // Preview shows what was in there — and never a password.
  const preview = page.getByTestId("history-preview");
  await expect(preview).toContainText("Wichtiger Zugang");
  await expect(preview).toContainText("ada@example.com");
  await expect(page.locator("body")).not.toContainText("do-not-lose-this-42");

  // Reading a historic preview must not move the head or the pin.
  expect(revisionNumber((await page.getByTestId("revision").textContent()) ?? "")).toBe(revisionBefore);
  expect(await pinSnapshot(page)).toEqual(pinBefore);

  await page.getByTestId("history-restore").click();

  // Back on the desk the entry is there again, as a new forward revision.
  await page.getByTestId("tab-entries").click();
  await expect(page.getByRole("button", { name: /Wichtiger Zugang/ })).toBeVisible();
  expect(revisionNumber((await page.getByTestId("revision").textContent()) ?? "")).toBe(revisionBefore + 1);
  const pinAfter = await pinSnapshot(page);
  expect(pinAfter).not.toEqual(pinBefore);
  expect(pinAfter.length).toBe(1);

  // And the state we restored *from* was not rewound away: history still has
  // entries listed, including the one that was live during the accident.
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("tab-security").click();
  await expect(page.getByTestId("history-list").getByRole("button").first()).toBeVisible();
});
