#!/usr/bin/env node
/**
 * Build the PWA and the Chromium extension twice and require identical tree
 * hashes. Same Node, same lockfile, same machine — not a cross-OS claim.
 * See docs/reproducible-builds.md.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { hashTree } from "./hash-dist.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, cwd, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH ?? "0",
      TZ: "UTC",
      LC_ALL: "C",
      ...extraEnv,
    },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
  }
}

async function twice(label, build) {
  const firstDir = await mkdtemp(join(tmpdir(), `4allpass-${label}-a-`));
  const secondDir = await mkdtemp(join(tmpdir(), `4allpass-${label}-b-`));
  try {
    await build(firstDir);
    await build(secondDir);
    const first = await hashTree(firstDir);
    const second = await hashTree(secondDir);
    if (first.tree !== second.tree) {
      const left = new Set(first.lines);
      const right = new Set(second.lines);
      const onlyFirst = first.lines.filter((line) => !right.has(line));
      const onlySecond = second.lines.filter((line) => !left.has(line));
      console.error(`${label}: builds diverged`);
      for (const line of onlyFirst) console.error(`  only first:  ${line}`);
      for (const line of onlySecond) console.error(`  only second: ${line}`);
      process.exitCode = 1;
      return;
    }
    console.log(`${label}: ${first.tree}  (${first.fileCount} files, two builds match)`);
  } finally {
    await rm(firstDir, { recursive: true, force: true });
    await rm(secondDir, { recursive: true, force: true });
  }
}

await twice("extension", async (outDir) => {
  run("node", ["scripts/build.mjs"], join(root, "extension"), {
    FOURALLPASS_OUTDIR: outDir,
  });
});

await twice("frontend", async (outDir) => {
  run("npx", ["vite", "build", "--outDir", outDir, "--emptyOutDir"], join(root, "frontend"));
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
