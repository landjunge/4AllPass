import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modulesRoot = resolve(repositoryRoot, "frontend/src/modules");
const sourceExtensions = new Set([".ts", ".tsx"]);
const importPattern = /(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)["']([^"']+)["']/g;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    return sourceExtensions.has(extension) ? [path] : [];
  });
}

function moduleName(path) {
  const local = relative(modulesRoot, path);
  return local.split(sep)[0] ?? "";
}

const violations = [];
for (const file of sourceFiles(modulesRoot)) {
  const owner = moduleName(file);
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) continue;
    const targetPath = resolve(dirname(file), specifier);
    const targetLocal = relative(modulesRoot, targetPath);
    if (targetLocal.startsWith("..") || targetLocal === "") continue;
    const target = moduleName(targetPath);
    if (!target || target === owner) continue;
    const publicEntry = resolve(modulesRoot, target);
    const publicEntries = new Set([
      publicEntry,
      publicEntry + ".ts",
      publicEntry + ".tsx",
      resolve(publicEntry, "index.ts"),
      resolve(publicEntry, "index.tsx"),
    ]);
    if (!publicEntries.has(targetPath)) {
      violations.push(relative(repositoryRoot, file) + " imports private internals from module " + target + ": " + specifier);
    }
  }
}

if (violations.length) {
  console.error("Module boundary violations:\\n- " + violations.join("\\n- "));
  process.exitCode = 1;
} else {
  console.log("Module boundaries: OK");
}
