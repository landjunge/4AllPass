/**
 * packages/crypto may depend only on leaf noble crates. No network, no UI.
 * docs/supply-chain-security.md §2, ADR-014.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED_RUNTIME = new Set(["@noble/ciphers", "@noble/hashes"]);
const FORBIDDEN_SPECIFIERS = [
  "react",
  "react-dom",
  "node:http",
  "node:https",
  "node:net",
  "node:dns",
  "node:dgram",
  "node:child_process",
  "undici",
  "axios",
  "node-fetch",
  "@tauri-apps/api",
  "@tauri-apps/plugin-autostart",
];

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(path));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("crypto core supply chain", () => {
  it("runtime dependencies are only noble ciphers and hashes", () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const names = Object.keys(pkg.dependencies ?? {});
    assert.deepEqual(names.sort(), [...ALLOWED_RUNTIME].sort());
  });

  it("noble runtime crates have no further npm dependencies", () => {
    const lock = JSON.parse(readFileSync(join(PKG_ROOT, "../../package-lock.json"), "utf8")) as {
      packages: Record<string, { dependencies?: Record<string, string> }>;
    };
    for (const name of ALLOWED_RUNTIME) {
      const node = lock.packages[`node_modules/${name}`];
      assert.ok(node, `lockfile missing ${name}`);
      assert.deepEqual(node.dependencies ?? {}, {});
    }
  });

  it("src does not import network, UI, or shell modules", () => {
    const importRe = /(?:from|import)\s+["']([^"']+)["']/g;
    const hits: string[] = [];
    for (const file of walkTs(join(PKG_ROOT, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(importRe)) {
        const spec = match[1] ?? "";
        if (FORBIDDEN_SPECIFIERS.some((bad) => spec === bad || spec.startsWith(`${bad}/`))) {
          hits.push(`${file}: ${spec}`);
        }
      }
    }
    assert.deepEqual(hits, []);
  });
});
