import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.env.FOURALLPASS_SUITE_ARTIFACTS ?? join(homedir(), "gnom-hub-v1/docs/assets/4allpass-user-suite");
mkdirSync(root, { recursive: true });
const reportPath = join(root, "suite.json");

const stages = [
  {
    id: "fresh-user",
    area: "startup/account/vault/entries/browser/agent-access/settings",
    command: ["npm", ["run", "test:e2e:fresh-user"]],
    enabled: true,
  },
  {
    id: "import-restore",
    area: "import/browser-profiles/sharing/vault-lifecycle",
    command: ["npm", ["run", "test:e2e:local"]],
    enabled: true,
  },
  {
    id: "autofill-local",
    area: "autofill/browser extension",
    command: ["npm", ["run", "test:e2e:autofill-local"]],
    enabled: true,
  },
  {
    id: "devices",
    area: "devices/device-management/recovery-management",
    command: ["npx", ["playwright", "test", "-c", "playwright.config.ts", "e2e/device-unlock.spec.ts", "e2e/two-device.spec.ts"]],
    enabled: process.env.E2E_INCLUDE_DEVICE === "1",
    note: "Needs the real E2E backend prerequisites described by playwright.config.ts.",
  },
];

const requested = process.argv[2] || process.env.FOURALLPASS_SUITE_STAGE || "all";
const selected = requested === "all" ? stages.filter((stage) => stage.enabled) : stages.filter((stage) => stage.id === requested);
if (!selected.length) {
  console.error(`Unknown or disabled stage: ${requested}`);
  process.exit(2);
}

const report = {
  startedAt: new Date().toISOString(),
  finishedAt: null,
  requested,
  status: "running",
  failedStage: null,
  stages: [],
};

function persist() {
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

persist();

for (const stage of selected) {
  const entry = {
    id: stage.id,
    area: stage.area,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    note: stage.note ?? null,
  };
  report.stages.push(entry);
  persist();

  console.log(`\n=== 4AllPass user suite: ${stage.id} ===`);
  const [command, args] = stage.command;
  const child = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  entry.finishedAt = new Date().toISOString();
  entry.exitCode = typeof child.status === "number" ? child.status : 1;
  entry.status = entry.exitCode === 0 ? "passed" : "failed";
  persist();

  if (entry.status === "failed") {
    report.status = "failed";
    report.failedStage = stage.id;
    report.finishedAt = new Date().toISOString();
    persist();
    console.error(`\nFAILED: ${stage.id}`);
    console.error(`Responsible area: ${stage.area}`);
    console.error(`Report: ${reportPath}`);
    process.exit(entry.exitCode || 1);
  }
}

report.status = "passed";
report.finishedAt = new Date().toISOString();
persist();
console.log(`\nPASS: complete selected user suite`);
console.log(`Report: ${reportPath}`);
