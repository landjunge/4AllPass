/**
 * Typed client for the 4AllPass API.
 *
 * Everything crossing this boundary is already encrypted or is metadata. The
 * session token lives in memory plus sessionStorage; it authenticates the
 * account, not the vault.
 */
import type {
  WireDeviceKeyEnvelope,
  WireKeyEnvelope,
  WireSealedManifest,
  WireVaultSnapshot,
} from "@4allpass/crypto";

import { deviceId } from "./device-identity.ts";
import { readStorageOrigin } from "./storage-origin.ts";

const SIDECAR_API = "http://127.0.0.1:8788/api/v1";

function apiBase(): string {
  const remote = typeof window !== "undefined" ? readStorageOrigin() : null;
  if (remote) return `${remote}/api/v1`;
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    return SIDECAR_API;
  }
  return "/api/v1";
}

/** Not a React hook — name must not start with `use` (oxlint rules-of-hooks). */
function sidecarHttpEnabled(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window &&
    !readStorageOrigin()
  );
}
const TOKEN_KEY = "4allpass.session";

function tokenStore(): Storage {
  return "__TAURI_INTERNALS__" in window ? localStorage : sessionStorage;
}

export interface AccountSession {
  token: string;
  expiresIn: number;
  accountId: string;
  email: string;
  deviceId: string;
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
  serverVerified?: boolean;
  verification?: "client_asserted" | "cose_verified";
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
  revocation?: "none" | "metadata_only";
  credentials: CredentialSummary[];
}

export interface SnapshotCommit {
  expectedRevision?: number;
  revision: number;
  vaultKeyVersion: number;
  cryptoProtocolVersion: 1;
  envelopes: WireKeyEnvelope[];
  entries: WireVaultSnapshot["entries"];
  sealedManifest?: WireSealedManifest;
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

let token: string | null = null;

export function getToken(): string | null {
  if (token) return token;
  try {
    token = tokenStore().getItem(TOKEN_KEY);
  } catch {
    token = null;
  }
  return token;
}

export function setToken(value: string | null): void {
  token = value;
  const store = tokenStore();
  if (value) store.setItem(TOKEN_KEY, value);
  else store.removeItem(TOKEN_KEY);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  headers["X-Device-Id"] = deviceId();
  let status: number;
  let text: string;
  if (sidecarHttpEnabled()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<{ status: number; body: string }>("sidecar_http", {
      method,
      path: `/api/v1${path}`,
      headers,
      body: body !== undefined ? JSON.stringify(body) : null,
    });
    status = result.status;
    text = result.body;
  } else {
    const init: RequestInit = { method, headers, credentials: "omit" };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetch(`${apiBase()}${path}`, init);
    status = response.status;
    text = await response.text();
  }
  if (status === 204) return undefined as T;
  const parsed: unknown = text ? JSON.parse(text) : {};
  if (status < 200 || status >= 300) {
    throw new ApiError(
      status,
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
      challengeId?: string;
      challenge?: string;
      clientDataJSON?: string;
      attestationObject?: string;
    },
  ): Promise<CredentialSummary> {
    return request("POST", `/vaults/${vaultId}/devices/${deviceId}/credentials`, credential);
  },

  putDeviceKeyEnvelope(
    vaultId: string,
    deviceId: string,
    credentialIdBase64: string,
    envelope: WireDeviceKeyEnvelope,
    expectedRevision: number,
  ): Promise<WireDeviceKeyEnvelope> {
    const path = `/vaults/${vaultId}/devices/${deviceId}/credentials/${toPathId(credentialIdBase64)}/device-key-envelope?expectedRevision=${expectedRevision}`;
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
    body: {
      purpose: "create" | "assert";
      challenge: string;
      deviceId?: string;
      credentialId?: string;
      clientDataJSON?: string;
      authenticatorData?: string;
      signature?: string;
    },
  ): Promise<void> {
    return request("POST", `/vaults/${vaultId}/webauthn/challenges/${challengeId}/consume`, body);
  },

  health(): Promise<{
    status: string;
    database: boolean;
    redis: boolean;
    webauthn_rp_id: string;
    profile: string;
  }> {
    return request("GET", "/health");
  },

  /**
   * Sidecar binds after the window paints. One failed fetch is not a hung
   * server — retry until 8788 answers or the deadline.
   */
  async waitForHealth(timeoutMs = 20_000): Promise<{
    status: string;
    database: boolean;
    redis: boolean;
    webauthn_rp_id: string;
    profile: string;
  }> {
    const started = Date.now();
    let last: unknown;
    while (Date.now() - started < timeoutMs) {
      try {
        return await api.health();
      } catch (error) {
        last = error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    throw last instanceof Error ? last : new Error("Load failed");
  },

  async localSession(): Promise<AccountSession> {
    const session = await request<AccountSession>("POST", "/auth/local");
    setToken(session.token);
    return session;
  },

  localStatus(): Promise<{
    hasLocalVault: boolean;
    localEntries: number;
    hasOtherAccounts: boolean;
  }> {
    return request("GET", "/local/status");
  },

  localBroker(): Promise<{ url: string; token: string }> {
    return request("GET", "/local/broker");
  },

  reportWebviewCaps(caps: {
    publicKeyCredential: boolean;
    credentialsCreate: boolean;
    platformAuthenticator: boolean | null;
    prf: boolean | null;
  }): Promise<typeof caps> {
    return request("POST", "/local/webview-caps", caps);
  },
};
