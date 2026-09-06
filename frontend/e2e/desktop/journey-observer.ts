import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";

export interface JourneyEvent {
  step: string;
  status: "started" | "passed" | "failed";
  at: string;
  message?: string;
  screenshot?: string;
}

export class JourneyObserver {
  private readonly events: JourneyEvent[] = [];
  readonly root: string;

  constructor(private readonly page: Page, private readonly testInfo: TestInfo) {
    this.root = process.env.FOURALLPASS_JOURNEY_ARTIFACTS ?? join(homedir(), "gnom-hub-v1/docs/assets/fresh-user-journey");
    mkdirSync(this.root, { recursive: true });
  }

  private persist(): void {
    writeFileSync(join(this.root, "journey.json"), `${JSON.stringify(this.events, null, 2)}\n`, "utf8");
  }

  async step<T>(name: string, action: () => Promise<T>): Promise<T> {
    this.events.push({ step: name, status: "started", at: new Date().toISOString() });
    this.persist();
    try {
      const result = await this.testInfo.step(name, action);
      const screenshot = `${name}.png`;
      await this.page.screenshot({ path: join(this.root, screenshot), fullPage: true });
      this.events.push({ step: name, status: "passed", at: new Date().toISOString(), screenshot });
      this.persist();
      return result;
    } catch (error) {
      const screenshot = `${name}-FAILED.png`;
      await this.page.screenshot({ path: join(this.root, screenshot), fullPage: true }).catch(() => undefined);
      this.events.push({
        step: name,
        status: "failed",
        at: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
        screenshot,
      });
      this.persist();
      throw error;
    }
  }
}

export async function expectUsableControls(page: Page): Promise<void> {
  const bad = await page.locator("button:visible, input:visible, textarea:visible, select:visible").evaluateAll((nodes) =>
    nodes.flatMap((node) => {
      const el = node as HTMLElement;
      const label =
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.getAttribute("data-testid") ||
        (el instanceof HTMLInputElement ? el.placeholder : "") ||
        el.textContent?.trim() ||
        "";
      return label ? [] : [el.outerHTML.slice(0, 180)];
    }),
  );
  if (bad.length) throw new Error(`Unbeschriftete Bedienelemente: ${bad.join(" | ")}`);
}
