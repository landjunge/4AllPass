import {
  assertFreshSnapshot,
  decodeVaultSnapshot,
  deriveMasterKeyFromEnvelope,
  revisionFromManifest,
  sealedManifestDigest,
  unwrapVaultKey,
  verifySnapshot,
  verifySnapshotManifest,
  zeroize,
  type KeyEnvelope,
  type VaultRevision,
  type VaultSnapshot,
} from "@4allpass/crypto";

import { defaultPinStore, type PinStore } from "./revision-pin.ts";

export interface VaultItem {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  providerId: string;
  totpSecret: string;
}

function decodeItem(id: string, plaintext: Uint8Array): VaultItem {
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<VaultItem> & {
    providerId?: unknown;
  };
  return {
    id,
    title: parsed.title ?? "",
    username: parsed.username ?? "",
    password: parsed.password ?? "",
    url: parsed.url ?? "",
    notes: parsed.notes ?? "",
    providerId: typeof parsed.providerId === "string" ? parsed.providerId : "",
    totpSecret: typeof parsed.totpSecret === "string" ? parsed.totpSecret : "",
  };
}

export async function apiRequest<T>(
  apiOrigin: string,
  token: string | null,
  deviceId: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { "X-Device-Id": deviceId };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${apiOrigin}/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const detail =
      typeof parsed === "object" && parsed && "detail" in parsed
        ? String((parsed as { detail: unknown }).detail)
        : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return parsed as T;
}

/**
 * Desktop / `npm run app` has no account. Empty email + empty sign-in
 * password → POST /auth/local. Anything else → POST /auth/login.
 */
export function storageAuthRequest(
  email: string,
  accountPassword: string,
): { path: "/auth/local" | "/auth/login"; body?: { email: string; password: string } } {
  const mail = email.trim();
  if (!mail && !accountPassword) return { path: "/auth/local" };
  return { path: "/auth/login", body: { email: mail, password: accountPassword } };
}

function masterEnvelopeOf(snapshot: VaultSnapshot): KeyEnvelope {
  const envelope = snapshot.envelopes.find((candidate) => candidate.type === "master");
  if (!envelope) throw new Error("snapshot has no master envelope");
  return envelope;
}

/**
 * Same open order as the PWA: freshness pin → unwrap → sealed manifest →
 * decrypt the records verification returned, not the wire copies.
 */
export function openUnlockedSnapshot(
  wire: unknown,
  options: {
    vaultId: string;
    vaultPassword: string;
    pin?: VaultRevision | null;
  },
): { entries: VaultItem[]; pin: VaultRevision } {
  const snapshot = decodeVaultSnapshot(wire);
  if (snapshot.vaultId !== options.vaultId) {
    throw new Error("server returned a snapshot for a different vault");
  }
  assertFreshSnapshot(options.pin ?? null, {
    vaultId: snapshot.vaultId,
    revision: snapshot.revision,
    vaultKeyVersion: snapshot.vaultKeyVersion,
    cryptoProtocolVersion: snapshot.cryptoProtocolVersion,
    ...(snapshot.sealedManifest
      ? { manifestDigest: sealedManifestDigest(snapshot.sealedManifest) }
      : {}),
  });

  const master = masterEnvelopeOf(snapshot);
  const masterKey = deriveMasterKeyFromEnvelope(options.vaultPassword, master);
  try {
    const vaultKey = unwrapVaultKey(master, {
      wrappingKey: masterKey,
      vaultId: options.vaultId,
      expectType: "master",
      expectVaultKeyVersion: snapshot.vaultKeyVersion,
    });
    try {
      let entries = snapshot.entries;
      let envelopes = snapshot.envelopes;
      let pin: VaultRevision;
      if (snapshot.sealedManifest) {
        const verified = verifySnapshotManifest(
          snapshot.sealedManifest,
          { entries, envelopes },
          {
            vaultKey,
            vaultId: snapshot.vaultId,
            revision: snapshot.revision,
            vaultKeyVersion: snapshot.vaultKeyVersion,
          },
        );
        entries = verified.entries;
        envelopes = verified.envelopes;
        pin = revisionFromManifest(verified);
      } else {
        pin = {
          vaultId: snapshot.vaultId,
          revision: snapshot.revision,
          vaultKeyVersion: snapshot.vaultKeyVersion,
          cryptoProtocolVersion: snapshot.cryptoProtocolVersion,
        };
      }
      const masterForCheck = envelopes.find((envelope) => envelope.type === "master") ?? master;
      const items = verifySnapshot({
        vaultId: options.vaultId,
        vaultKey,
        vaultKeyVersion: snapshot.vaultKeyVersion,
        entries,
        crossCheckEnvelopes: [{ envelope: masterForCheck, wrappingKey: masterKey }],
      }).map((entry) => {
        try {
          return decodeItem(entry.id, entry.plaintext);
        } finally {
          zeroize(entry.plaintext);
        }
      });
      return { entries: items, pin };
    } finally {
      zeroize(vaultKey);
    }
  } finally {
    zeroize(masterKey);
  }
}

export async function unlockVault(options: {
  apiOrigin: string;
  deviceId: string;
  email: string;
  accountPassword: string;
  vaultPassword: string;
  pinStore?: PinStore;
}): Promise<{ token: string; vaultId: string; entries: VaultItem[] }> {
  const pins = options.pinStore ?? defaultPinStore();
  const auth = storageAuthRequest(options.email, options.accountPassword);
  const session = await apiRequest<{ token: string }>(
    options.apiOrigin,
    null,
    options.deviceId,
    "POST",
    auth.path,
    auth.body,
  );
  const vaults = await apiRequest<Array<{ vaultId: string }>>(
    options.apiOrigin,
    session.token,
    options.deviceId,
    "GET",
    "/vaults",
  );
  const vaultId = vaults[0]?.vaultId;
  if (!vaultId) throw new Error("no vault on this account");
  const wire = await apiRequest<unknown>(
    options.apiOrigin,
    session.token,
    options.deviceId,
    "GET",
    `/vaults/${vaultId}/snapshot`,
  );
  const opened = openUnlockedSnapshot(wire, {
    vaultId,
    vaultPassword: options.vaultPassword,
    pin: await pins.load(vaultId),
  });
  await pins.save(opened.pin);
  return { token: session.token, vaultId, entries: opened.entries };
}
