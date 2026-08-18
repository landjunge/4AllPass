/**
 * Typed client for the 4AllPass API.
 *
 * Everything crossing this boundary is already encrypted or is metadata. The
 * session token lives in memory plus sessionStorage; it authenticates the
 * account, not the vault.
 */
import type { WireDeviceKeyEnvelope, WireKeyEnvelope, WireVaultSnapshot } from "@4allpass/crypto";

const API_BASE = "/api/v1";
const TOKEN_KEY = "4allpass.session";

export interface AccountSession {
  token: string;
  expiresIn: number;
  accountId: string;
  email: string;
}

export interface VaultSummary {
  vaultId: string;
  cryptoProtocolVersion: number;
  activeRevision: number | null;
  activeVaultKeyVersion: number | null;
  createdAt: string;
}

export interface CredentialSummary {
  id: string;
  credentialId: string;
  rpId: string;
  mechanism: "prf" | "large_blob" | "uv_gated_local";
  prfSupported: boolean;
  largeBlobSupported: boolean;
  userVerificationRequired: boolean;
  hasMirroredDeviceKeyEnvelope: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface DeviceSummary {
  deviceId: string;
  label: string;
  platform: string | null;
  userAgentSummary: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  hasDeviceEnvelope: boolean;
  credentials: CredentialSummary[];
}

export interface SnapshotCommit {
  expectedRevision?: number;
  revision: number;
  vaultKeyVersion: number;
  cryptoProtocolVersion: 1;
  envelopes: WireKeyEnvelope[];
  entries: WireVaultSnapshot["entries"];
}

export interface WebAuthnChallenge {
  challengeId: string;
  challenge: string;
  expiresIn: number;
  purpose: "create" | "assert";
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.detail === "string" ? body.detail : `request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  get currentRevision(): number | null {
    const value = this.body.currentRevision;
    return typeof value === "number" ? value : null;
  }
}

let token: string | null = sessionStorage.getItem(TOKEN_KEY);

export function getToken(): string | null {
  return token;
}

export function setToken(value: string | null): void {
  token = value;
  if (value) sessionStorage.setItem(TOKEN_KEY, value);
  else sessionStorage.removeItem(TOKEN_KEY);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers, credentials: "same-origin" };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(`${API_BASE}${path}`, init);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {},
    );
  }
  return parsed as T;
}

/** base64 → base64url without padding, for credential ids in URL paths. */
export function toPathId(base64: string): string {
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export const api = {
  async register(email: string, password: string): Promise<AccountSession> {
    const session = await request<AccountSession>("POST", "/auth/register", { email, password });
    setToken(session.token);
    return session;
  },

  async login(email: string, password: string): Promise<AccountSession> {
    const session = await request<AccountSession>("POST", "/auth/login", { email, password });
    setToken(session.token);
    return session;
  },

  async logout(): Promise<void> {
    try {
      await request<void>("POST", "/auth/logout");
    } finally {
      setToken(null);
    }
  },

  me(): Promise<{ id: string; email: string; createdAt: string }> {
    return request("GET", "/auth/me");
  },

  listVaults(): Promise<VaultSummary[]> {
    return request("GET", "/vaults");
  },

  createVault(): Promise<VaultSummary> {
    return request("POST", "/vaults");
  },

  getVault(vaultId: string): Promise<VaultSummary> {
    return request("GET", `/vaults/${vaultId}`);
  },

  getSnapshot(vaultId: string): Promise<WireVaultSnapshot> {
    return request("GET", `/vaults/${vaultId}/snapshot`);
  },

  commitSnapshot(vaultId: string, payload: SnapshotCommit): Promise<WireVaultSnapshot> {
    return request("POST", `/vaults/${vaultId}/snapshots`, payload);
  },

  listDevices(vaultId: string): Promise<DeviceSummary[]> {
    return request("GET", `/vaults/${vaultId}/devices`);
  },

  registerDevice(
    vaultId: string,
    device: { deviceId: string; label: string; platform?: string; userAgentSummary?: string },
  ): Promise<DeviceSummary> {
    return request("POST", `/vaults/${vaultId}/devices`, device);
  },

  registerCredential(
    vaultId: string,
    deviceId: string,
    credential: {
      credentialId: string;
      rpId: string;
      mechanism: CredentialSummary["mechanism"];
      prfSupported: boolean;
      largeBlobSupported: boolean;
    },
  ): Promise<CredentialSummary> {
    return request("POST", `/vaults/${vaultId}/devices/${deviceId}/credentials`, credential);
  },

  putDeviceKeyEnvelope(
    vaultId: string,
    deviceId: string,
    credentialIdBase64: string,
    envelope: WireDeviceKeyEnvelope,
  ): Promise<WireDeviceKeyEnvelope> {
    const path = `/vaults/${vaultId}/devices/${deviceId}/credentials/${toPathId(credentialIdBase64)}/device-key-envelope`;
    return request("PUT", path, envelope);
  },

  getDeviceKeyEnvelope(
    vaultId: string,
    deviceId: string,
    credentialIdBase64: string,
  ): Promise<WireDeviceKeyEnvelope> {
    const path = `/vaults/${vaultId}/devices/${deviceId}/credentials/${toPathId(credentialIdBase64)}/device-key-envelope`;
    return request("GET", path);
  },

  revokeDevice(vaultId: string, deviceId: string): Promise<DeviceSummary> {
    return request("DELETE", `/vaults/${vaultId}/devices/${deviceId}`);
  },

  issueWebAuthnChallenge(
    vaultId: string,
    body: { purpose: "create" | "assert"; deviceId?: string },
  ): Promise<WebAuthnChallenge> {
    return request("POST", `/vaults/${vaultId}/webauthn/challenges`, body);
  },

  consumeWebAuthnChallenge(
    vaultId: string,
    challengeId: string,
    body: { purpose: "create" | "assert"; challenge: string },
  ): Promise<void> {
    return request("POST", `/vaults/${vaultId}/webauthn/challenges/${challengeId}/consume`, body);
  },

  health(): Promise<{ status: string; database: boolean; redis: boolean; webauthn_rp_id: string }> {
    return request("GET", "/health");
  },
};
