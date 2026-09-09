/**
 * Copy goes through `t({ de, en })` — never a hand-written "DE / EN" string.
 *
 * The reason this is a script and not a line in a doc: a doc line was already
 * there ("DE+EN in the same PR") and 136 hand-written slashes accumulated
 * anyway. A rule nobody runs is a rule nobody keeps.
 *
 * This is a ratchet, not a gate. The existing violations are allowed by an
 * explicit budget; adding one fails. Converting a file means lowering the
 * budget in the same commit, so the number only ever walks down.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(repositoryRoot, "frontend/src");
const sourceExtensions = new Set([".ts", ".tsx"]);

/**
 * Budget of hand-written bilingual strings still in the tree.
 * Only ever lower this. See docs/ui-map.md.
 */
const BUDGET = 136;

// "Etwas Deutsches / Something English" — a slash with words on both sides,
// inside one quoted string or a JSX text node.
const DENGLISH = /[^\s"'`{}<>/][^"'`{}<>/]{3,60} \/ [A-ZÄÖÜ][^"'`{}<>/]{3,60}/;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    if (!sourceExtensions.has(extension)) return [];
    return entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx") ? [] : [path];
  });
}

const found = [];
for (const file of sourceFiles(sourceRoot)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    // A line that is already handing both halves to `t()` is correct by
    // construction — the renderer picks one.
    if (/\bde:\s*["'`]/.test(line) || /\ben:\s*["'`]/.test(line)) return;
    const match = DENGLISH.exec(line);
    if (match) {
      found.push(`${relative(repositoryRoot, file)}:${String(index + 1)}: ${match[0].trim().slice(0, 70)}`);
    }
  });
}

if (found.length > BUDGET) {
  const added = found.length - BUDGET;
  console.error(
    `Hand-written "DE / EN" copy went up by ${String(added)} (${String(found.length)} > budget ${String(BUDGET)}).\n` +
      `Use t({ de: "…", en: "…" }) so the language switch can pick one.\n` +
      `See docs/ui-map.md. Newest matches:\n` +
      found.slice(-Math.min(added + 3, found.length)).map((row) => `  ${row}`).join("\n"),
  );
  process.exit(1);
}

if (found.length < BUDGET) {
  console.error(
    `Good news: only ${String(found.length)} hand-written "DE / EN" strings left, budget is ${String(BUDGET)}.\n` +
      `Lower BUDGET to ${String(found.length)} in scripts/check-copy-language.mjs so it cannot creep back up.`,
  );
  process.exit(1);
}

console.log(`copy language: ${String(found.length)} hand-written "DE / EN" strings, at budget.`);
