/**
 * Loopback access client. POSTs to the local relay, never to FastAPI.
 * Policy and plaintext stay in the unlocked app. This package does not decrypt.
 */
import { AccessClientError } from "./errors.ts";
import { redactSecrets } from "./redact.ts";

export const DEFAULT_BROKER_URL = "http://127.0.0.1:8788";
export const DEFAULT_TIMEOUT_MS = 70_000;

export interface ClientOptions {
  token?: string;
  url?: string;
  application?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface AccessRequestInput {
  provider: string;
  ttl: number;
  capability?: string;
  capabilities?: readonly string[];
  credential?: string;
  application?: string;
}

export type AccessResult =
  | { status: "approved"; accessToken: string; expiresIn: number }
  | { status: "denied"; reason: string };

export interface FourAllPassClient {
  request(input: AccessRequestInput): Promise<AccessResult>;
  requestOrThrow(
    input: AccessRequestInput,
  ): Promise<{ accessToken: string; expiresIn: number }>;
}

function readToken(explicit: string | undefined): string {
  const fromEnv = typeof process !== "undefined" ? process.env.FOURALLPASS_BROKER_TOKEN : undefined;
  return (explicit ?? fromEnv ?? "").trim();
}

function readUrl(explicit: string | undefined): string {
  const fromEnv = typeof process !== "undefined" ? process.env.FOURALLPASS_BROKER_URL : undefined;
  const raw = (explicit ?? fromEnv ?? DEFAULT_BROKER_URL).replace(/\/$/, "");
  return assertLoopbackUrl(raw).origin;
}

export function assertLoopbackUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AccessClientError("not_loopback", "broker URL is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AccessClientError("not_loopback", "broker URL must be http(s) on loopback");
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]" && host !== "::1") {
    throw new AccessClientError(
      "not_loopback",
      "broker URL must be 127.0.0.1 (this client does not call FastAPI)",
    );
  }
  // Sidecar binds 127.0.0.1 only. localhost can be ::1 on macOS.
  parsed.hostname = "127.0.0.1";
  return parsed;
}

function scopeOf(input: AccessRequestInput): string[] {
  if (input.capabilities && input.capabilities.length > 0) return [...input.capabilities];
  if (input.capability && input.capability.trim()) return [input.capability.trim()];
  throw new AccessClientError("malformed_request", "capability or capabilities is required");
}

function parseBody(value: unknown): AccessResult {
  if (!value || typeof value !== "object") {
    throw new AccessClientError("malformed_response", "broker returned a non-object body");
  }
  const row = value as Record<string, unknown>;
  if (row.status === "approved") {
    if (typeof row.access_token !== "string" || typeof row.expires_in !== "number") {
      throw new AccessClientError("malformed_response", "approved response missing grant fields");
    }
    return { status: "approved", accessToken: row.access_token, expiresIn: row.expires_in };
  }
  if (row.status === "denied") {
    const reason = typeof row.reason === "string" && row.reason ? row.reason : "denied";
    return { status: "denied", reason };
  }
  throw new AccessClientError("malformed_response", "broker returned an unknown status");
}

export function fourAllPass(options: ClientOptions = {}): FourAllPassClient {
  const token = readToken(options.token);
  const base = readUrl(options.url);
  const application = (options.application ?? "n8n").trim() || "n8n";
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request(input: AccessRequestInput): Promise<AccessResult> {
    if (!token) {
      throw new AccessClientError(
        "missing_token",
        "FOURALLPASS_BROKER_TOKEN is required (pairing token, not a vault key)",
      );
    }
    if (typeof input.ttl !== "number" || !Number.isFinite(input.ttl) || input.ttl <= 0) {
      throw new AccessClientError("malformed_request", "ttl must be a positive number of seconds");
    }
    const provider = input.provider.trim();
    if (!provider) throw new AccessClientError("malformed_request", "provider is required");
    const scope = scopeOf(input);
    const app = (input.application ?? application).trim();
    const body = {
      application: app,
      provider,
      credential: (input.credential ?? "personal").trim() || "personal",
      scope,
      ttl: input.ttl,
    };
    let response: Response;
    try {
      response = await fetchImpl(`${base}/v1/access/request`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error), [
        token,
      ]);
      throw new AccessClientError("network", message);
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (response.status === 401) return { status: "denied", reason: "malformed_request" };
    if (response.status === 403) return { status: "denied", reason: "malformed_request" };
    if (json == null) {
      throw new AccessClientError("malformed_response", `broker HTTP ${response.status}`);
    }
    try {
      return parseBody(json);
    } catch (error) {
      if (error instanceof AccessClientError) {
        throw new AccessClientError(error.code, redactSecrets(error.message, [token]));
      }
      throw error;
    }
  }

  async function requestOrThrow(
    input: AccessRequestInput,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const result = await request(input);
    if (result.status !== "approved") {
      throw new AccessClientError("denied", `access denied (${result.reason})`, result.reason);
    }
    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  return { request, requestOrThrow };
}
