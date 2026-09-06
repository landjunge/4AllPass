import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type WatchServerOptions = {
  port: string;
  dataPrefix: string;
};

export function isolatedWatchServer({ port, dataPrefix }: WatchServerOptions) {
  if (port === "8788") {
    throw new Error("Visible UI tests must never use the real 4AllPass port 8788");
  }

  const frontendRoot = join(import.meta.dirname, "../..");
  const backendRoot = join(frontendRoot, "../backend");
  const uiDist = join(frontendRoot, "dist");
  const python = join(backendRoot, ".venv/bin/python");
  const dataDir = mkdtempSync(join(tmpdir(), dataPrefix));

  return {
    command: `${python} -m app.local --port ${port} --data-dir "${dataDir}" --ui-dist "${uiDist}"`,
    cwd: backendRoot,
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      FOURALLPASS_DATA_DIR: dataDir,
      FOURALLPASS_UI_DIST: uiDist,
    },
  };
}

export function visibleWatchUse(port: string) {
  return {
    baseURL: `http://127.0.0.1:${port}`,
    headless: false,
    launchOptions: { slowMo: 180 },
    actionTimeout: 90_000,
    video: "retain-on-failure" as const,
    trace: "retain-on-failure" as const,
    viewport: { width: 1280, height: 800 },
  };
}
