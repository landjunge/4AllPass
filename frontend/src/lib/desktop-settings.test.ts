import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LAUNCH_AT_LOGIN_BROWSER,
  LAUNCH_AT_LOGIN_HINT,
  LAUNCH_AT_LOGIN_LABEL,
  SLEEP_LOCK_HINT,
} from "./desktop-settings.ts";

test("launch-at-login copy is DE+EN and does not claim auto-unlock", () => {
  const blob = `${LAUNCH_AT_LOGIN_LABEL}\n${LAUNCH_AT_LOGIN_HINT}\n${LAUNCH_AT_LOGIN_BROWSER}`;
  assert.match(blob, /Beim Anmelden starten/);
  assert.match(blob, /Launch at login/);
  assert.match(LAUNCH_AT_LOGIN_HINT, /gesperrt|locked/i);
  assert.equal(/auto-unlock|entsperrt automatisch|passkey|ghp_/i.test(blob), false);
});

test("sleep/screen-lock copy does not claim FileVault or auto-unlock", () => {
  assert.match(SLEEP_LOCK_HINT, /FileVault/);
  assert.match(SLEEP_LOCK_HINT, /macOS/);
  assert.equal(/auto-unlock|hibernation-safe|passkey|ghp_/i.test(SLEEP_LOCK_HINT), false);
});
