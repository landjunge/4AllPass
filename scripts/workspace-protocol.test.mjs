/**
 * Internal @4allpass deps must use the workspace protocol, not "*".
 * "*" can resolve to the public registry when npm ci / lockfile is skipped.
 * docs/supply-chain-security.md §3. Audit 2026-08-30: packages 404 on npmjs.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function packageJsonPaths() {
  const out = [join(ROOT, "package.json")];
  for (const dir of ["packages", "frontend", "extension"]) {
    const abs = join(ROOT, dir);
    if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) continue;
    if (dir === "frontend" || dir === "extension") {
      out.push(join(abs, "package.json"));
      continue;
    }
    for (const name of readdirSync(abs)) {
      const pkg = join(abs, name, "package.json");
      if (statSync(pkg, { throwIfNoEntry: false })?.isFile()) out.push(pkg);
    }
  }
  return out;
}

test("@4allpass dependencies use workspace: not a registry wildcard", () => {
  const bad = [];
  for (const path of packageJsonPaths()) {
    const pkg = JSON.parse(readFileSync(path, "utf8"));
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      const deps = pkg[field] ?? {};
      for (const [name, spec] of Object.entries(deps)) {
        if (!name.startsWith("@4allpass/")) continue;
        if (typeof spec !== "string" || !spec.startsWith("workspace:")) {
          bad.push(`${path}: ${field}.${name}=${JSON.stringify(spec)}`);
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});
