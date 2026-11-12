import assert from "node:assert/strict";
import { test } from "node:test";

import { mapLockState } from "./family-header.ts";

// Test the real shared normalizer, rather than an invented host vocabulary.
const stateModule = "../../public/networkpunkt/networkpunkt-appbar-state.js";
const { createPeerState } = await import(stateModule);

test("local observations survive the pinned normalizer without claiming vault proof", () => {
  for (const [lockState, expected] of [
    ["UNLOCKED", "confirmed"], ["LOCKED", "confirmed"],
    ["UNLOCKING", "unknown"], ["LOCKING", "unknown"], ["unexpected", "unknown"],
  ]) {
    const binding = { appId: "4allpass", connectionRef: "same-origin-host", peerRef: "4allpass", peerEpoch: "fixture" };
    const peer = createPeerState(binding);
    assert.equal(peer.receive(peer.begin(), { v: 1, ...binding, seq: 1, state: mapLockState(lockState), ttlMs: 10000 }), true);
    assert.equal(peer.snapshot().state, expected);
    assert.equal(peer.snapshot().vault, "unknown");
    assert.equal(peer.snapshot().pulse, false);
  }
});
