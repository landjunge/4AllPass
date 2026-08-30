import { parseHandoff } from "./handoff.ts";
import { ACCESS_TTL_SECONDS_MAX, ttlIsAllowed } from "./limits.ts";
import type { AccessRequest } from "./types.ts";

export function parseAccessBody(
  input: unknown,
): AccessRequest | { status: "denied"; reason: "malformed_request" | "ttl_too_large" } {
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
  if (!ttlIsAllowed(ttl, ACCESS_TTL_SECONDS_MAX)) {
    return { status: "denied", reason: "ttl_too_large" };
  }
  const handoff = parseHandoff(body.handoff);
  if (handoff === "invalid") return { status: "denied", reason: "malformed_request" };
  const requesterId =
    typeof body.requesterId === "string" && body.requesterId.trim()
      ? body.requesterId.trim()
      : undefined;
  return {
    application: body.application,
    provider: body.provider,
    credential: typeof body.credential === "string" ? body.credential : "personal",
    scope: body.scope as string[],
    ttlSeconds: ttl,
    handoff,
    ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
    ...(requesterId ? { requesterId } : {}),
  };
}

export function applicationRef(request: AccessRequest): { id: string; name: string } {
  const name = request.application.trim();
  return { id: name.toLowerCase(), name };
}
