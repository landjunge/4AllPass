import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LAUNCH_AT_LOGIN_BROWSER,
  LAUNCH_AT_LOGIN_HINT,
  LAUNCH_AT_LOGIN_LABEL,
  LICENSE_HINT,
  SLEEP_LOCK_HINT,
  UNINSTALL_HINT,
} from "./desktop-settings.ts";

// Seit dem Umschalter steht jede Sprache fuer sich allein. Deshalb wird jede
// Aussage in ihrem eigenen Feld geprueft, nicht mehr in einem gemeinsamen Blob:
// sonst koennte eine Sprache stillschweigend leer bleiben.

test("launch-at-login copy is DE+EN and does not claim auto-unlock", () => {
  assert.match(LAUNCH_AT_LOGIN_LABEL.de, /Beim Anmelden starten/);
  assert.match(LAUNCH_AT_LOGIN_LABEL.en, /Launch at login/);
  assert.match(LAUNCH_AT_LOGIN_HINT.de, /gesperrt/i);
  assert.match(LAUNCH_AT_LOGIN_HINT.en, /locked/i);
  const blob = [LAUNCH_AT_LOGIN_LABEL, LAUNCH_AT_LOGIN_HINT, LAUNCH_AT_LOGIN_BROWSER]
    .flatMap((line) => [line.de, line.en])
    .join("\n");
  assert.equal(/auto-unlock|entsperrt automatisch|passkey|ghp_/i.test(blob), false);
});

test("sleep copy is Lock button only, not auto-lock", () => {
  assert.match(SLEEP_LOCK_HINT.de, /Ruhemodus/);
  assert.match(SLEEP_LOCK_HINT.de, /Bildschirmsperre/);
  assert.match(SLEEP_LOCK_HINT.de, /Sperren drückst/);
  assert.match(SLEEP_LOCK_HINT.de, /FileVault/);
  assert.match(SLEEP_LOCK_HINT.en, /Sleep/);
  assert.match(SLEEP_LOCK_HINT.en, /screen lock/i);
  assert.match(SLEEP_LOCK_HINT.en, /press Lock/);
  assert.match(SLEEP_LOCK_HINT.en, /FileVault/);
  const blob = `${SLEEP_LOCK_HINT.de}\n${SLEEP_LOCK_HINT.en}`;
  assert.equal(/auto-unlock|hibernation-safe|passkey|ghp_/i.test(blob), false);
});

test("license copy is personal free, commercial not", () => {
  assert.match(LICENSE_HINT.de, /Quelloffen/);
  assert.match(LICENSE_HINT.de, /Privat frei/);
  assert.match(LICENSE_HINT.de, /Kommerziell nur mit Erlaubnis von Daniel Filipek/);
  assert.match(LICENSE_HINT.de, /PolyForm Noncommercial/);
  assert.match(LICENSE_HINT.en, /Source is public/);
  assert.match(LICENSE_HINT.en, /Personal use free/);
  assert.match(LICENSE_HINT.en, /Commercial use only with permission from Daniel Filipek/);
  assert.match(LICENSE_HINT.en, /PolyForm Noncommercial/);
});

test("uninstall copy says the vault folder stays", () => {
  assert.match(UNINSTALL_HINT.de, /löscht den Tresor nicht/i);
  assert.match(UNINSTALL_HINT.de, /Application Support/);
  assert.match(UNINSTALL_HINT.de, /APPDATA/);
  assert.match(UNINSTALL_HINT.en, /does not silently delete/i);
  const blob = `${UNINSTALL_HINT.de}\n${UNINSTALL_HINT.en}`;
  assert.equal(/wipe|format|ghp_/i.test(blob), false);
});

test("no settings line is empty in either language", () => {
  const lines = {
    LAUNCH_AT_LOGIN_LABEL,
    LAUNCH_AT_LOGIN_HINT,
    LAUNCH_AT_LOGIN_BROWSER,
    LICENSE_HINT,
    SLEEP_LOCK_HINT,
    UNINSTALL_HINT,
  };
  for (const [name, line] of Object.entries(lines)) {
    assert.ok(line.de.trim().length > 0, `de fehlt in ${name}`);
    assert.ok(line.en.trim().length > 0, `en fehlt in ${name}`);
    assert.equal(line.de.includes(" / "), false, `${name}.de ist noch verschweißt`);
    assert.equal(line.en.includes(" / "), false, `${name}.en ist noch verschweißt`);
  }
});
