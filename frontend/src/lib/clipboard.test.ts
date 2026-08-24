import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  clearCopiedSecret,
  copySecret,
  readClipboardText,
  resetCopiedSecretForTests,
} from "./clipboard.ts";

afterEach(() => resetCopiedSecretForTests());

function fakeClipboard(initial = "") {
  let text = initial;
  const reads: string[] = [];
  const writes: string[] = [];
  return {
    reads,
    writes,
    clipboard: {
      async readText() {
        reads.push(text);
        return text;
      },
      async writeText(next: string) {
        writes.push(next);
        text = next;
      },
    },
  };
}

test("readClipboardText is one shot and does not write", async () => {
  const { clipboard, writes } = fakeClipboard("sk-test-not-a-live-key");
  const got = await readClipboardText(clipboard);
  assert.equal(got, "sk-test-not-a-live-key");
  assert.deepEqual(writes, []);
});

test("copySecret writes then clears if the clipboard still matches", async () => {
  const { clipboard, writes } = fakeClipboard();
  const queued: Array<() => void> = [];
  await copySecret("s3cret", {
    clipboard,
    clearAfterMs: 30,
    schedule: (fn) => {
      queued.push(fn);
      return 1;
    },
    cancel: () => undefined,
  });
  assert.deepEqual(writes, ["s3cret"]);
  await queued[0]();
  assert.deepEqual(writes, ["s3cret", ""]);
});

test("copySecret does not clobber a clipboard the user replaced", async () => {
  const { clipboard, writes } = fakeClipboard();
  const queued: Array<() => void> = [];
  await copySecret("s3cret", {
    clipboard,
    schedule: (fn) => {
      queued.push(fn);
      return 1;
    },
    cancel: () => undefined,
  });
  await clipboard.writeText("something-else");
  await queued[0]();
  assert.deepEqual(writes, ["s3cret", "something-else"]);
});

test("copySecret does not clobber when readText is denied", async () => {
  const writes: string[] = [];
  const clipboard = {
    async writeText(next: string) {
      writes.push(next);
    },
    async readText() {
      throw new Error("denied");
    },
  };
  const queued: Array<() => void> = [];
  await copySecret("s3cret", {
    clipboard,
    schedule: (fn) => {
      queued.push(fn);
      return 1;
    },
    cancel: () => undefined,
  });
  await queued[0]();
  assert.deepEqual(writes, ["s3cret"]);
});

test("clearCopiedSecret overwrites a matching clipboard on lock", async () => {
  const { clipboard, writes } = fakeClipboard();
  await copySecret("s3cret", {
    clipboard,
    schedule: () => 1,
    cancel: () => undefined,
  });
  await clearCopiedSecret(clipboard);
  assert.deepEqual(writes, ["s3cret", ""]);
});
