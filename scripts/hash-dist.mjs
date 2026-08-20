#!/usr/bin/env node
/**
 * SHA-256 tree hash of a dist directory.
 *
 * Each file: hex digest of its bytes. Tree: SHA-256 of the sorted
 * "digest  posix-relative-path\n" manifest. Empty dirs are ignored.
 * `.DS_Store` is skipped. Paths are relative to the given root, `/` separated.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP = new Set([".DS_Store"]);

function posixRel(root, file) {
  return relative(root, file).split(sep).join("/");
}

async function listFiles(dir, acc = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await listFiles(path, acc);
    else if (entry.isFile()) acc.push(path);
  }
  return acc;
}

export async function hashTree(root) {
  const info = await stat(root);
  if (!info.isDirectory()) {
    throw new Error(`${root} is not a directory`);
  }
  const files = await listFiles(root);
  files.sort((a, b) => posixRel(root, a).localeCompare(posixRel(root, b)));
  const lines = [];
  for (const file of files) {
    const digest = createHash("sha256").update(await readFile(file)).digest("hex");
    lines.push(`${digest}  ${posixRel(root, file)}`);
  }
  const manifest = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  const tree = createHash("sha256").update(manifest).digest("hex");
  return { tree, lines, fileCount: files.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/hash-dist.mjs <dist-dir>");
    process.exit(2);
  }
  const result = await hashTree(dir);
  for (const line of result.lines) console.log(line);
  console.log(`tree ${result.tree}  ${result.fileCount} files`);
}
