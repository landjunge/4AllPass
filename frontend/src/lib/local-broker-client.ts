/**
 * Unlocked UI talks to the local-process relay (same origin :8788) or the
 * Node Vite helper on :8787. Pairing token required. FastAPI does not mint
 * provider tokens.
 */
import type { AccessApiResponse, AccessWireRequest } from "./access.ts";

export const DEFAULT_BROKER_URL = "http://127.0.0.1:8788";

export type BrokerStatus = "off" | "connecting" | "live" | "error";

type Incoming = (msg: AccessWireRequest) => void;

let stop: (() => void) | null = null;
let incoming: Incoming | null = null;
let status: BrokerStatus = "off";
let lastError = "";
let session: { url: string; token: string } | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function getBrokerClientState(): {
  status: BrokerStatus;
  error: string;
  url: string;
  token: string;
} {
  return { status, error: lastError, url: session?.url ?? "", token: session?.token ?? "" };
}

export function subscribeBrokerClient(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function onBrokerRequest(fn: Incoming | null): void {
  incoming = fn;
}

export function disconnectLocalBroker(): void {
  stop?.();
  stop = null;
  session = null;
  status = "off";
  lastError = "";
  emit();
}

export function connectLocalBroker(url: string, token: string): void {
  disconnectLocalBroker();
  const base = url.replace(/\/$/, "");
  const trimmed = token.trim();
  if (!trimmed) {
    status = "error";
    lastError = "pairing token required";
    emit();
    return;
  }
  let cancelled = false;
  stop = () => {
    cancelled = true;
  };
  session = { url: base, token: trimmed };
  status = "live";
  lastError = "";
  emit();

  async function loop(): Promise<void> {
    while (!cancelled) {
      try {
        const res = await fetch(`${base}/v1/broker/poll`, {
          method: "GET",
          headers: { Authorization: `Bearer ${trimmed}` },
        });
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          status = "error";
          lastError = "broker rejected the pairing token or origin";
          emit();
          return;
        }
        if (res.status === 204) continue;
        const msg = (await res.json()) as AccessWireRequest;
        if (msg && msg.v === 1 && msg.method === "POST /v1/access/request") {
          incoming?.(msg);
        }
      } catch (error) {
        if (cancelled) return;
        status = "error";
        lastError = error instanceof Error ? error.message : String(error);
        emit();
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  }

  void loop();
}

export async function decideLocalBroker(id: string, body: AccessApiResponse): Promise<void> {
  if (!session) return;
  await fetch(`${session.url}/v1/broker/decide`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ v: 1, id, body }),
  });
}
