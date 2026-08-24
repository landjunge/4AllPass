import type { AccessRequest } from "./types.ts";

export function parseAccessBody(
  input: unknown,
): AccessRequest | { status: "denied"; reason: "malformed_request" } {
  if (!input || typeof input !== "object") return { status: "denied", reason: "malformed_request" };
  const body = input as Record<string, unknown>;
  if (typeof body.application !== "string" || typeof body.provider !== "string") {
    return { status: "denied", reason: "malformed_request" };
  }
  if (!Array.isArray(body.scope) || body.scope.some((item) => typeof item !== "string")) {
    return { status: "denied", reason: "malformed_request" };
  }
  const ttl = body.ttl ?? body.ttlSeconds;
  if (typeof ttl !== "number" || !Number.isFinite(ttl) || ttl <= 0) {
    return { status: "denied", reason: "malformed_request" };
  }
  return {
    application: body.application,
    provider: body.provider,
    credential: typeof body.credential === "string" ? body.credential : "personal",
    scope: body.scope as string[],
    ttlSeconds: ttl,
    ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
  };
}

export function applicationRef(request: AccessRequest): { id: string; name: string } {
  const name = request.application.trim();
  return { id: name.toLowerCase(), name };
}
