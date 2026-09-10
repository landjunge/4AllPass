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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = new Set([".ts", ".tsx", ".html"]);

/**
 * Every surface a user reads, not just the React app.
 *
 * The first version watched `frontend/src` only, which made the count look
 * like the whole problem. It was not: the tab title and the social preview in
 * `index.html`, the desktop access prompt in `public/`, and the entire browser
 * extension were outside the lens and kept their slashes untouched.
 */
const scanRoots = [
  "frontend/src",
  "frontend/index.html",
  "frontend/public",
  "frontend/vite.config.ts",
  "extension/src",
].map((path) => resolve(repositoryRoot, path));

/**
 * Budget of hand-written bilingual strings still in the tree.
 *
 * Only ever lower this. The one exception is widening the lens above — then
 * the number jumps because more is being *seen*, not because more was
 * written, and the commit that widens it says so. Never raise it to make a
 * failing run pass. See docs/ui-map.md.
 *
 * 136 → 160 when the lens widened. Two movements inside that number:
 * `frontend/src` went 136 → 132, because four of the old hits were code
 * comments and comments are not copy; and 28 real ones came into view —
 * 18 in the browser extension, 5 in the tab title and social preview, 5 in
 * the desktop access prompt.
 */
const BUDGET = 160;

// "Etwas Deutsches / Something English" — a slash with words on both sides,
// inside one quoted string or a JSX text node.
const DENGLISH = /[^\s"'`{}<>/][^"'`{}<>/]{3,60} \/ [A-ZÄÖÜ][^"'`{}<>/]{3,60}/;

function sourceFiles(path) {
  if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    if (!sourceExtensions.has(extension)) return [];
    return entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx") ? [] : [child];
  });
}

const found = [];
for (const file of scanRoots.flatMap(sourceFiles)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    // A line that is already handing both halves to `t()` is correct by
    // construction — the renderer picks one.
    if (/\bde:\s*["'`]/.test(line) || /\ben:\s*["'`]/.test(line)) return;
    // Comments are not copy. A slash in prose ("memory / IndexedDB") is not
    // Denglisch, and counting it would push developers to reword comments
    // instead of fixing labels.
    if (/^\s*(\/\/|\/\*|\*|<!--)/.test(line)) return;
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
