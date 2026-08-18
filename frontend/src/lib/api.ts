/**
 * Typed client for the 4AllPass API.
 *
 * Everything crossing this boundary is already encrypted or is metadata.
 *
 * The account session is an HttpOnly cookie the browser attaches on its own,
 * so no token is stored here and none is reachable from JavaScript. What this
 * module does hold is the CSRF token, which the server requires on unsafe
 * requests; it is not a credential on its own and is only accepted alongside
 * the session cookie. See docs/backend-security.md §3.
 *
 * Authenticating an account is not unlocking a vault. Nothing in this file
 * ever sees the Master Password, the Vault Key, or plaintext entries — those
 * stay in vault-session.ts, client-side.
 */
import type { WireDeviceKeyEnvelope, WireKeyEnvelope, WireVaultSnapshot } from "@4allpass/crypto";

const API_BASE = "/api/v1";
const CSRF_COOKIE = "4allpass_csrf";
const CSRF_HEADER = "X-CSRF-Token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface AccountSession {
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

/** Read the CSRF cookie, which the server deliberately leaves script-readable. */
function csrfToken(): string | null {
  const prefix = `${CSRF_COOKIE}=`;
  for (const entry of document.cookie.split(";")) {
    const trimmed = entry.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return null;
}

/**
 * Whether a session cookie is plausibly present.
 *
 * It cannot be read — that is the point of HttpOnly — so this only reports
 * that a sign-in happened in this browser. `GET /auth/me` is the real check.
 */
export function hasSession(): boolean {
  return csrfToken() !== null;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (!SAFE_METHODS.has(method)) {
    const csrf = csrfToken();
    if (csrf) headers[CSRF_HEADER] = csrf;
  }
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
  // register/login return no token: the session arrives as an HttpOnly cookie
  // on the same response, and the browser attaches it from then on.
  register(email: string, password: string): Promise<AccountSession> {
    return request<AccountSession>("POST", "/auth/register", { email, password });
  },

  login(email: string, password: string): Promise<AccountSession> {
    return request<AccountSession>("POST", "/auth/login", { email, password });
  },

  logout(): Promise<void> {
    // The server revokes the session and clears both cookies; there is no
    // client-side copy left to forget.
    return request<void>("POST", "/auth/logout");
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

  health(): Promise<{ status: string; database: boolean; redis: boolean; webauthn_rp_id: string }> {
    return request("GET", "/health");
  },
};
