/**
 * Recovering from an unopenable head (ADR-015 §2).
 *
 * The dangerous shape here is a hostile server poisoning the head to push
 * someone onto older content. Recovery is therefore allowed to *read*
 * backwards but never to *write* backwards: the commit lands above the broken
 * head and the freshness pin only ever moves up.
 */
import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ARGON2ID_PROFILES,
  IntegrityError,
  buildManifest,
  deriveMasterKey,
  encodeVaultSnapshot,
  encryptEntry,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  sealManifest,
  wrapVaultKey,
  zeroize,
  type EncryptedEntry,
} from "@4allpass/crypto";

import { api, ApiError, type VaultRevisionSummary } from "./api.ts";
import { encodeEntryPlaintext, type VaultEntry } from "./entries.ts";
import { loadPin, savePin } from "./revision-pin.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import { CommitConflict, findRecoverableRevision, restoreRecoveredRevision } from "./vault-session.ts";

const PASSWORD = "head-recovery-master-password";
const profile = ARGON2ID_PROFILES.mobile_safe;
const VAULT_ID = "77777777-7777-4777-8777-777777777777";

const originalGetVault = api.getVault.bind(api);
const originalListRevisions = api.listRevisions.bind(api);
const originalGetRevision = api.getRevision.bind(api);
const originalCommit = api.commitSnapshot.bind(api);

afterEach(() => {
  clearTestStorage();
  api.getVault = originalGetVault;
  api.listRevisions = originalListRevisions;
  api.getRevision = originalGetRevision;
  api.commitSnapshot = originalCommit;
});

const ENTRY: VaultEntry = {
  id: "entry-1",
  title: "GitHub",
  username: "ada@example.com",
  password: "the-good-old-secret",
  url: "https://github.com",
  notes: "",
  kind: "web",
  providerId: "",
  totpSecret: "",
  favorite: false,
};

/** One vault key for the whole fixture, so every revision shares a master key. */
const vaultKey = generateVaultKey();
const salt = generateSalt(16);
const masterKey = deriveMasterKey(PASSWORD, salt, profile);

function master() {
  return wrapVaultKey({
    vaultKey,
    wrappingKey: masterKey,
    vaultId: VAULT_ID,
    type: "master",
    vaultKeyVersion: 1,
    kdf: kdfParamsFrom(profile, salt),
  });
}

function sealEntries(entries: readonly VaultEntry[]): EncryptedEntry[] {
  return entries.map((entry) => {
    const plaintext = encodeEntryPlaintext(entry);
    try {
      return encryptEntry({
        vaultKey,
        vaultId: VAULT_ID,
        entryId: entry.id,
        plaintext,
        vaultKeyVersion: 1,
        schemaVersion: 1,
      });
    } finally {
      zeroize(plaintext);
    }
  });
}

function goodRevision(revision: number, entries: readonly VaultEntry[]) {
  const envelopes = [master()];
  const encrypted = sealEntries(entries);
  return encodeVaultSnapshot({
    vaultId: VAULT_ID,
    revision,
    vaultKeyVersion: 1,
    cryptoProtocolVersion: 1,
    envelopes,
    entries: encrypted,
    sealedManifest: sealManifest({
      vaultKey,
      manifest: buildManifest({
        vaultId: VAULT_ID,
        revision,
        vaultKeyVersion: 1,
        envelopes,
        entries: encrypted,
      }),
    }),
  });
}

/** A head an attacker with a token could write: well-formed, manifest lies. */
function poisonedRevision(revision: number) {
  const good = goodRevision(revision, [ENTRY]);
  return { ...good, entries: [] };
}

function stubServer(head: number, rows: readonly VaultRevisionSummary[], wire: Record<number, unknown>) {
  api.getVault = async () =>
    Promise.resolve({
      vaultId: VAULT_ID,
      cryptoProtocolVersion: 1,
      activeRevision: head,
      activeVaultKeyVersion: 1,
      createdAt: "2026-09-01T00:00:00Z",
    });
  api.listRevisions = async () => Promise.resolve([...rows]);
  api.getRevision = async (_vaultId: string, revision: number) => {
    const found = wire[revision];
    if (!found) throw new Error("revision not found");
    return Promise.resolve(found as never);
  };
}

function row(revision: number, isActive = false): VaultRevisionSummary {
  return {
    revision,
    vaultKeyVersion: 1,
    createdAt: `2026-09-0${String(revision)}T10:00:00Z`,
    entryCount: 1,
    isActive,
  };
}

test("findRecoverableRevision walks down to the newest revision that still opens", async () => {
  stubServer(4, [row(4, true), row(3), row(2)], {
    4: poisonedRevision(4),
    3: poisonedRevision(3),
    2: goodRevision(2, [ENTRY]),
  });

  const found = await findRecoverableRevision(VAULT_ID, PASSWORD);

  assert.ok(found);
  assert.equal(found.revision, 2);
  assert.equal(found.brokenRevision, 4);
  assert.equal(found.entries[0]?.password, "the-good-old-secret");
});

test("findRecoverableRevision returns null when nothing opens", async () => {
  stubServer(3, [row(3, true), row(2)], {
    3: poisonedRevision(3),
    2: poisonedRevision(2),
  });

  assert.equal(await findRecoverableRevision(VAULT_ID, PASSWORD), null);
});

test("findRecoverableRevision does not move the pin", async () => {
  const pinned = { vaultId: VAULT_ID, revision: 4, vaultKeyVersion: 1, cryptoProtocolVersion: 1 as const };
  savePin(pinned);
  stubServer(4, [row(4, true), row(2)], {
    4: poisonedRevision(4),
    2: goodRevision(2, [ENTRY]),
  });

  const found = await findRecoverableRevision(VAULT_ID, PASSWORD);
  assert.ok(found);

  // Reading revision 2 must not make revision 2 the state we trust.
  assert.deepEqual(loadPin(VAULT_ID), pinned);
});

test("restoreRecoveredRevision commits above the broken head, never back at it", async () => {
  stubServer(4, [row(4, true), row(2)], {
    4: poisonedRevision(4),
    2: goodRevision(2, [ENTRY]),
  });
  const found = await findRecoverableRevision(VAULT_ID, PASSWORD);
  assert.ok(found);

  let sent: { revision: number; expectedRevision?: number | null } | null = null;
  api.commitSnapshot = async (_vaultId: string, payload) => {
    sent = payload as typeof sent;
    return Promise.resolve(goodRevision(payload.revision, [ENTRY]) as never);
  };

  await restoreRecoveredRevision(VAULT_ID, PASSWORD, found);

  assert.ok(sent);
  // 5, not 3: forward from the damaged head, so the pin can only go up.
  assert.equal(sent!.revision, 5);
  assert.equal(sent!.expectedRevision, 4);
});

for (const change of ["envelope", "entries", "missing-manifest", "manifest", "signed-fork", "revision"] as const) {
  test(`restore rejects a changed refetch (${change}) before commit or pin`, async () => {
    const original = goodRevision(2, [ENTRY]);
    stubServer(4, [row(2)], { 2: original });
    const pinned = { vaultId: VAULT_ID, revision: 4, vaultKeyVersion: 1, cryptoProtocolVersion: 1 as const };
    savePin(pinned);
    const found = await findRecoverableRevision(VAULT_ID, PASSWORD);
    assert.ok(found);
    const changed = structuredClone(original);
    if (change === "envelope") {
      // The master still opens: corruption is in another envelope the old
      // confirmation used to copy into a newly authenticated manifest.
      changed.envelopes.push({ ...changed.envelopes[0]!, type: "recovery", kdf: undefined });
    } else if (change === "entries") changed.entries = [];
    else if (change === "missing-manifest") delete changed.sealedManifest;
    else if (change === "manifest") {
      const manifest = changed.sealedManifest!;
      manifest.tag = (manifest.tag[0] === "A" ? "B" : "A") + manifest.tag.slice(1);
    } else if (change === "signed-fork") {
      Object.assign(changed, goodRevision(2, [ENTRY]));
    } else changed.revision = 3;
    api.getRevision = async () => changed;
    let commits = 0;
    api.commitSnapshot = async (vaultId, payload) => {
      commits++;
      return { ...payload, vaultId };
    };
    await assert.rejects(() => restoreRecoveredRevision(VAULT_ID, PASSWORD, found), IntegrityError);
    assert.equal(commits, 0);
    assert.deepEqual(loadPin(VAULT_ID), pinned);
  });
}

test("history lookup refuses a revision different from the requested listing row", async () => {
  stubServer(4, [row(2)], { 2: goodRevision(3, [ENTRY]) });
  assert.equal(await findRecoverableRevision(VAULT_ID, PASSWORD), null);
});

test("history confirmation preserves manifestless legacy recovery as a forward commit", async () => {
  const legacy = goodRevision(2, [ENTRY]);
  delete legacy.sealedManifest;
  stubServer(4, [row(2)], { 2: legacy });
  const found = await findRecoverableRevision(VAULT_ID, PASSWORD);
  assert.ok(found);
  api.commitSnapshot = async (vaultId, payload) => ({ ...payload, vaultId });
  const restored = await restoreRecoveredRevision(VAULT_ID, PASSWORD, found);
  assert.equal(restored.revision, 5);
  assert.equal(restored.entries[0]?.title, ENTRY.title);
});

test("history confirmation keeps CAS conflict and the existing pin intact", async () => {
  stubServer(4, [row(2)], { 2: goodRevision(2, [ENTRY]) });
  const pinned = { vaultId: VAULT_ID, revision: 4, vaultKeyVersion: 1, cryptoProtocolVersion: 1 as const };
  savePin(pinned);
  const found = await findRecoverableRevision(VAULT_ID, PASSWORD);
  assert.ok(found);
  api.commitSnapshot = async () => { throw new ApiError(409, { currentRevision: 5 }); };
  await assert.rejects(() => restoreRecoveredRevision(VAULT_ID, PASSWORD, found), CommitConflict);
  assert.deepEqual(loadPin(VAULT_ID), pinned);
});
