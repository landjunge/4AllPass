import {
  assertFreshSnapshot,
  decodeVaultSnapshot,
  deriveMasterKeyFromEnvelope,
  IntegrityError,
  revisionFromManifest,
  sealedManifestDigest,
  unwrapVaultKey,
  verifySnapshot,
  verifySnapshotManifest,
  zeroize,
  type KeyEnvelope,
} from "@4allpass/crypto";
import { memoryPinStore, type PinStore } from "./revision-pin.ts";

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

/**
 * Master-password unlock for the extension.
 *
 * The extension gets its snapshot from the same server the PWA does, so it runs
 * the same two checks before anything is filled into a page: the pin refuses a
 * replayed older snapshot, and the sealed manifest proves *which* records belong
 * to this revision. Skipping them meant a server could serve a pre-rotation
 * snapshot and the extension would autofill a password the user had already
 * changed.
 */
export async function unlockVault(options: {
  apiOrigin: string;
  deviceId: string;
  email: string;
  accountPassword: string;
  vaultPassword: string;
  /** Defaults to a per-call memory store, which is no protection; pass a real one. */
  pins?: PinStore;
}): Promise<{ token: string; vaultId: string; entries: VaultItem[] }> {
  const pins = options.pins ?? memoryPinStore();
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
  const snapshot = decodeVaultSnapshot(wire);
  if (snapshot.vaultId !== vaultId) {
    throw new IntegrityError("server returned a snapshot for a different vault");
  }
  // Refuse a replay before any key material is derived.
  assertFreshSnapshot(await pins.load(vaultId), {
    vaultId: snapshot.vaultId,
    revision: snapshot.revision,
    vaultKeyVersion: snapshot.vaultKeyVersion,
    cryptoProtocolVersion: snapshot.cryptoProtocolVersion,
    ...(snapshot.sealedManifest
      ? { manifestDigest: sealedManifestDigest(snapshot.sealedManifest) }
      : {}),
  });
  const master = snapshot.envelopes.find((envelope: KeyEnvelope) => envelope.type === "master");
  if (!master) throw new Error("snapshot has no master envelope");
  const masterKey = deriveMasterKeyFromEnvelope(options.vaultPassword, master);
  try {
    const vaultKey = unwrapVaultKey(master, {
      wrappingKey: masterKey,
      vaultId,
      expectType: "master",
      expectVaultKeyVersion: snapshot.vaultKeyVersion,
    });
    try {
      let records = snapshot.entries;
      if (snapshot.sealedManifest) {
        const verified = verifySnapshotManifest(
          snapshot.sealedManifest,
          { entries: snapshot.entries, envelopes: snapshot.envelopes },
          {
            vaultKey,
            vaultId,
            revision: snapshot.revision,
            vaultKeyVersion: snapshot.vaultKeyVersion,
          },
        );
        records = verified.entries;
        // Only a verified manifest is pinnable; the server's own numbers are a
        // claim, and pinning those is how the pin gets poisoned.
        await pins.save(revisionFromManifest(verified));
      }
      const entries = verifySnapshot({
        vaultId,
        vaultKey,
        vaultKeyVersion: snapshot.vaultKeyVersion,
        entries: records,
        crossCheckEnvelopes: [{ envelope: master, wrappingKey: masterKey }],
      }).map((entry) => {
        try {
          return decodeItem(entry.id, entry.plaintext);
        } finally {
          zeroize(entry.plaintext);
        }
      });
      return { token: session.token, vaultId, entries };
    } finally {
      zeroize(vaultKey);
    }
  } finally {
    zeroize(masterKey);
  }
}
