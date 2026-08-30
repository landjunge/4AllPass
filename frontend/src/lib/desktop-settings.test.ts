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

test("launch-at-login copy is DE+EN and does not claim auto-unlock", () => {
  const blob = `${LAUNCH_AT_LOGIN_LABEL}\n${LAUNCH_AT_LOGIN_HINT}\n${LAUNCH_AT_LOGIN_BROWSER}`;
  assert.match(blob, /Beim Anmelden starten/);
  assert.match(blob, /Launch at login/);
  assert.match(LAUNCH_AT_LOGIN_HINT, /gesperrt|locked/i);
  assert.equal(/auto-unlock|entsperrt automatisch|passkey|ghp_/i.test(blob), false);
});

test("sleep copy is Lock button only, not auto-lock", () => {
  assert.match(SLEEP_LOCK_HINT, /FileVault/);
  assert.match(SLEEP_LOCK_HINT, /Ruhemodus/);
  assert.match(SLEEP_LOCK_HINT, /Sleep/);
  assert.match(SLEEP_LOCK_HINT, /Bildschirmsperre/);
  assert.match(SLEEP_LOCK_HINT, /screen lock/i);
  assert.match(SLEEP_LOCK_HINT, /Sperren drückst|press Lock/);
  assert.equal(/auto-unlock|hibernation-safe|passkey|ghp_/i.test(SLEEP_LOCK_HINT), false);
});

test("license copy is personal free, commercial not", () => {
  assert.match(LICENSE_HINT, /Quelloffen|Privat frei/);
  assert.match(LICENSE_HINT, /Personal use free|Source is public/);
  assert.match(LICENSE_HINT, /Kommerziell nicht|Commercial use is not/);
  assert.match(LICENSE_HINT, /PolyForm Noncommercial/);
});

test("uninstall copy says the vault folder stays", () => {
  assert.match(UNINSTALL_HINT, /löscht den Tresor nicht|does not silently delete/i);
  assert.match(UNINSTALL_HINT, /Application Support/);
  assert.match(UNINSTALL_HINT, /APPDATA/);
  assert.equal(/wipe|format|ghp_/i.test(UNINSTALL_HINT), false);
});
