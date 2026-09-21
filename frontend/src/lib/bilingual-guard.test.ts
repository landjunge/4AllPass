import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Waechter gegen verschweisste Sprachen.
 *
 * Line = {de, en} ist der einzige Weg, zwei Sprachen zu fuehren. Ein Text der
 * Form "Deutsch / English" in einem String oder JSX-Knoten laesst sich nicht
 * umschalten, nicht einzeln pruefen und nicht wiederverwenden. Genau das war
 * vor dem Umschalter an 118 Stellen der Fall — dieser Test haelt fest, dass
 * keine neue dazukommt.
 */

const ROOT = join(import.meta.dirname, "..");

/** Ein Wort aus mindestens drei Buchstaben. Zahlen und Zeichen zaehlen nicht. */
const WORD = /[A-Za-zÄÖÜäöüß]{3,}/;
/** Zeichen, die auf Code statt auf Fliesstext deuten. */
const CODE = /[=;(){}[\]<>|&$`\\]|=>|\.\w|\d\s*\/\s*\d/;

const STRING_LITERAL = /"((?:[^"\\\n]|\\.)+)"/g;
const JSX_TEXT = /> *\n?([^<>{}\n][^<>{}]*)</g;

/**
 * Stellen, die bewusst beide Sprachen tragen. Jede mit Grund — ohne Grund
 * gehoert nichts in diese Liste.
 */
const ALLOWED: { file: string; reason: string }[] = [
  {
    file: "lib/copy-mode.ts",
    reason:
      "bilingual() ist die Zusammenfuegung selbst und muss sie erzeugen duerfen.",
  },
  {
    file: "lib/copy-mode.test.ts",
    reason:
      "prueft bilingual() und braucht dafuer ein zusammengefuegtes Beispiel.",
  },
  {
    file: "lib/bilingual-guard.test.ts",
    reason:
      "dieser Waechter fuehrt selbst Beispiele, an denen er sich pruefen laesst.",
  },
  {
    file: "utils/vault/labels.test.ts",
    reason:
      "Test-Attrappe fuer Translate: sie fuegt beide Sprachen absichtlich zusammen.",
  },
  {
    file: "components/RecoveryKitDialog.tsx",
    reason:
      "kitText erzeugt die Notfall-Datei zum Ausdrucken. Sie wird Jahre spaeter " +
      "gelesen, moeglicherweise von jemand anderem als dem Besitzer. Eine Sprache " +
      "zu verlieren hiesse hier, den Tresor zu verlieren.",
  },
  {
    file: "modules/agent-access/demo.ts",
    reason: "notes des Demo-Eintrags ist Tresor-Inhalt, kein Bedienungstext.",
  },
];

/** Schraegstriche innerhalb einer Sprache. Kein Sprachwechsel. */
const INNER_SLASH = [
  "API-Key / Token",
  "API key / token",
  "Base32 / otpauth",
  "Face ID / Touch ID",
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (name.endsWith(".ts") || name.endsWith(".tsx")) found.push(full);
  }
  return found;
}

function fusedIn(text: string): boolean {
  if (CODE.test(text)) return false;
  const parts = text.split(" / ");
  if (parts.length !== 2) return false;
  const [left, right] = parts;
  if (!WORD.test(left ?? "") || !WORD.test(right ?? "")) return false;
  return !INNER_SLASH.some((inner) => text.includes(inner));
}

function offendersIn(path: string): string[] {
  const src = readFileSync(path, "utf8");
  const hits: string[] = [];
  for (const pattern of [STRING_LITERAL, JSX_TEXT]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(src)) !== null) {
      const text = (match[1] ?? "").split(/\s+/).join(" ").trim();
      if (!fusedIn(text)) continue;
      const line = src.slice(0, match.index).split("\n").length;
      hits.push(`${path.slice(ROOT.length + 1)}:${line}  ${text.slice(0, 80)}`);
    }
  }
  return hits;
}

test("no visible text welds German and English into one string", () => {
  const allowed = new Set(ALLOWED.map((entry) => entry.file));
  const offenders: string[] = [];
  for (const path of sourceFiles(ROOT)) {
    const relative = path.slice(ROOT.length + 1);
    if (allowed.has(relative)) continue;
    offenders.push(...offendersIn(path));
  }
  assert.deepEqual(
    offenders,
    [],
    "Verschweisste Sprachen gefunden. Statt \"Deutsch / English\" gehoert der " +
      "Text in ein Line-Objekt und durch t():\n" +
      offenders.join("\n"),
  );
});

test("every allowed exception carries a reason", () => {
  for (const entry of ALLOWED) {
    assert.ok(entry.reason.trim().length > 20, `${entry.file} ohne Begruendung`);
  }
});

test("the guard actually catches a weld", () => {
  // Ohne diese Probe koennte der Waechter stillschweigend nichts pruefen.
  assert.equal(fusedIn("Tresor gesperrt / Vault locked"), true);
  assert.equal(fusedIn("Bitte zuerst einen Tresor auswählen. / Select a vault first."), true);
  // Und nicht anschlagen, wo kein Sprachwechsel vorliegt.
  assert.equal(fusedIn("1 / 4"), false);
  assert.equal(fusedIn("API-Key / Token"), false);
  assert.equal(fusedIn("Math.floor((grant.expiresAt - now) / 1000)"), false);
  assert.equal(fusedIn("Sperren"), false);
});
