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
import {
  classifySignedWriteResponse,
  type SignedWriteBundle,
  type SignedWriteExpectation,
  type SignedWriteOutcome,
} from "@4allpass/crypto";

import { deviceId } from "./device-identity.ts";
import { OfflineTransportError, type SidecarOfflineCode } from "./snapshot-cache.ts";
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

export type SignedWriteTarget = Readonly<{
  transport: "sidecar" | "fetch";
  origin: string;
}>;

/** Capture the endpoint and transport together for one signed-write lifecycle. */
export function captureSignedWriteTarget(): SignedWriteTarget {
  const remote = typeof window !== "undefined" ? readStorageOrigin() : null;
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window && !remote) {
    return Object.freeze({ transport: "sidecar", origin: SIDECAR_API });
  }
  const origin = remote
    ? `${remote}/api/v1`
    : typeof window !== "undefined" && window.location?.origin
      ? `${window.location.origin}/api/v1`
      : "/api/v1";
  return Object.freeze({ transport: "fetch", origin });
}

function sameSignedWriteTarget(a: SignedWriteTarget, b: SignedWriteTarget): boolean {
  return a.transport === b.transport && a.origin === b.origin;
}
const TOKEN_KEY = "4allpass.session";

function tokenStore(): Storage {
  return "__TAURI_INTERNALS__" in window ? localStorage : sessionStorage;
}

export type SidecarErrorCode =
  | "offline_network"
  | "offline_timeout"
  | "offline_io"
  | "validation"
  | "protocol"
  | "capability"
  | "internal";

export class SidecarRequestError extends Error {
  readonly code: SidecarErrorCode;

  constructor(code: SidecarErrorCode) {
    super("desktop sidecar request failed");
    this.name = "SidecarRequestError";
    this.code = code;
  }
}

const OFFLINE_SIDECAR_CODES = new Set<SidecarErrorCode>([
  "offline_network",
  "offline_timeout",
  "offline_io",
]);
const SIDECAR_ERROR_CODES = new Set<SidecarErrorCode>([
  ...OFFLINE_SIDECAR_CODES,
  "validation",
  "protocol",
  "capability",
  "internal",
]);

function sidecarErrorCode(error: unknown): SidecarErrorCode | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && SIDECAR_ERROR_CODES.has(code as SidecarErrorCode)
    ? (code as SidecarErrorCode)
    : null;
}

function isOfflineSidecarCode(code: SidecarErrorCode | null): code is SidecarOfflineCode {
  return code !== null && OFFLINE_SIDECAR_CODES.has(code);
}

/** Map only the typed local transport codes to the offline/cache classifier. */
export function classifySidecarTransportRejection(error: unknown): OfflineTransportError | null {
  const code = sidecarErrorCode(error);
  return isOfflineSidecarCode(code) ? new OfflineTransportError(code) : null;
}

/** Preserve validation/protocol/capability; never classify them as offline. */
export function classifySidecarRequestError(error: unknown): SidecarRequestError {
  return new SidecarRequestError(sidecarErrorCode(error) ?? "capability");
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

/** One stored revision, metadata only. `entryCount` counts ciphertext rows. */
export interface VaultRevisionSummary {
  revision: number;
  vaultKeyVersion: number;
  createdAt: string;
  entryCount: number;
  isActive: boolean;
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
    let result: { status: number; body: string };
    try {
      result = await invoke<{ status: number; body: string }>("sidecar_http", {
        method,
        path: `/api/v1${path}`,
        headers,
        body: body !== undefined ? JSON.stringify(body) : null,
      });
    } catch (error) {
      const offline = classifySidecarTransportRejection(error);
      if (offline) throw offline;
      throw classifySidecarRequestError(error);
    }
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

/**
 * Send one v2 signed write and classify the answer without inventing success.
 * `bodyString` must be the exact bytes whose payloadDigest was signed. The
 * replay flag comes from the core header (sidecar) or the response (fetch);
 * a retry that cannot be proven stays UNKNOWN.
 */
export async function signedWriteRequest(
  method: string,
  path: string,
  bundle: SignedWriteBundle,
  bodyString: string,
  expected: SignedWriteExpectation,
  requestDeviceId = deviceId(),
  target = captureSignedWriteTarget(),
): Promise<SignedWriteOutcome> {
  return sendSignedWriteRequest(method, path, bundle.headers, bodyString, expected, requestDeviceId, target);
}

export interface ExactSignedWriteRequest {
  readonly method: string;
  readonly path: string;
  readonly bodyString: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly deviceId: string;
  readonly expected: Readonly<SignedWriteExpectation>;
  readonly target: SignedWriteTarget;
}

/** Resend a previously signed wire request; this never invokes a signer. */
export async function resumeSignedWriteRequest(
  request: ExactSignedWriteRequest,
): Promise<SignedWriteOutcome> {
  if (!sameSignedWriteTarget(request.target, captureSignedWriteTarget())) {
    return { kind: "unknown", reason: "request_target_changed" };
  }
  return sendSignedWriteRequest(
    request.method,
    request.path,
    request.headers,
    request.bodyString,
    request.expected,
    request.deviceId,
    request.target,
  );
}

async function sendSignedWriteRequest(
  method: string,
  path: string,
  signedHeaders: Readonly<Record<string, string>>,
  bodyString: string,
  expected: SignedWriteExpectation,
  requestDeviceId: string,
  target: SignedWriteTarget,
): Promise<SignedWriteOutcome> {
  const headers: Record<string, string> = { ...signedHeaders, "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  headers["X-Device-Id"] = requestDeviceId;
  let status: number;
  let text: string;
  let replayed: boolean;
  if (target.transport === "sidecar") {
    const { invoke } = await import("@tauri-apps/api/core");
    // Importing Tauri's invoke yields. Revalidate after that await and directly
    // before the irreversible IPC call so a changed endpoint/transport sends
    // nothing. Keep using the captured target; never follow the new target.
    if (!sameSignedWriteTarget(target, captureSignedWriteTarget())) {
      return { kind: "unknown", reason: "request_target_changed" };
    }
    let result: { status: number; body: string; replayed?: boolean };
    try {
      result = await invoke<{ status: number; body: string; replayed?: boolean }>("sidecar_http", {
        method,
        path: `/api/v1${path}`,
        headers,
        body: bodyString,
      });
    } catch (error) {
      const offline = classifySidecarTransportRejection(error);
      if (offline) throw offline;
      throw classifySidecarRequestError(error);
    }
    status = result.status;
    text = result.body;
    replayed = result.replayed === true;
  } else {
    // This is deliberately adjacent to fetch(): the endpoint may have changed
    // while the request was being signed, but the frozen target is never
    // replaced with that new endpoint.
    if (!sameSignedWriteTarget(target, captureSignedWriteTarget())) {
      return { kind: "unknown", reason: "request_target_changed" };
    }
    const response = await fetch(`${target.origin}${path}`, {
      method,
      headers,
      credentials: "omit",
      body: bodyString,
    });
    status = response.status;
    text = await response.text();
    replayed = response.headers.get("X-4AP-Write-Replayed") === "true";
  }
  const parsed: unknown = text ? JSON.parse(text) : {};
  const receiptHeaders = new Headers();
  if (replayed) receiptHeaders.set("X-4AP-Write-Replayed", "true");
  return classifySignedWriteResponse(status, receiptHeaders, parsed, expected);
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

  /**
   * Create a v2 (signed-write) vault. Additive and opt-in: the server issues a
   * one-time creation grant bound to vault/owner/purpose. Existing v1 vaults
   * are never migrated by this call.
   */
  createVaultV2(accountPassword: string): Promise<{ vaultId: string; creationGrant: string }> {
    return request("POST", "/vaults", { cryptoProtocolVersion: 2, accountPassword });
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

  listRevisions(vaultId: string): Promise<VaultRevisionSummary[]> {
    return request("GET", `/vaults/${vaultId}/revisions`);
  },

  /** A superseded revision. Reading one is not an advance — see openHistoricEntries. */
  getRevision(vaultId: string, revision: number): Promise<WireVaultSnapshot> {
    return request("GET", `/vaults/${vaultId}/revisions/${revision}`);
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
    localVaultId: string | null;
  }> {
    return request("GET", "/local/status");
  },

  adoptLocalVault(): Promise<{ vaultId: string | null; entries: number }> {
    return request("POST", "/local/adopt-local-vault");
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
