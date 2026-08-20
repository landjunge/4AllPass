import assert from "node:assert/strict";
import { test } from "node:test";

import { createIdleLock } from "../src/idle-lock.ts";

test("fires onIdle after the idle window unless touched again", () => {
  const queued: Array<{ fn: () => void; ms: number }> = [];
  let fires = 0;
  const lock = createIdleLock(() => {
    fires += 1;
  }, {
    ms: 50,
    schedule: (fn, ms) => {
      queued.push({ fn, ms });
      return queued.length;
    },
    cancel: () => undefined,
  });
  lock.touch();
  assert.equal(queued.length, 1);
  lock.touch();
  assert.equal(queued.length, 2);
  queued[1]!.fn();
  assert.equal(fires, 1);
  lock.stop();
});

test("stop prevents a pending idle lock", () => {
  let fires = 0;
  let handle: (() => void) | null = null;
  const lock = createIdleLock(() => {
    fires += 1;
  }, {
    schedule: (fn) => {
      handle = fn;
      return 1;
    },
    cancel: () => {
      handle = null;
    },
  });
  lock.touch();
  lock.stop();
  handle?.();
  assert.equal(fires, 0);
});
