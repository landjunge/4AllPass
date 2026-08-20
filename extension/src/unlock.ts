import {
  decodeVaultSnapshot,
  deriveMasterKeyFromEnvelope,
  unwrapVaultKey,
  verifySnapshot,
  zeroize,
  type KeyEnvelope,
} from "@4allpass/crypto";

export interface VaultItem {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
}

function decodeItem(id: string, plaintext: Uint8Array): VaultItem {
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<VaultItem>;
  return {
    id,
    title: parsed.title ?? "",
    username: parsed.username ?? "",
    password: parsed.password ?? "",
    url: parsed.url ?? "",
    notes: parsed.notes ?? "",
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

export async function unlockVault(options: {
  apiOrigin: string;
  deviceId: string;
  email: string;
  accountPassword: string;
  vaultPassword: string;
}): Promise<{ token: string; vaultId: string; entries: VaultItem[] }> {
  const session = await apiRequest<{ token: string }>(
    options.apiOrigin,
    null,
    options.deviceId,
    "POST",
    "/auth/login",
    { email: options.email, password: options.accountPassword },
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
      const entries = verifySnapshot({
        vaultId,
        vaultKey,
        vaultKeyVersion: snapshot.vaultKeyVersion,
        entries: snapshot.entries,
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
