import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ACCESS_CHANNEL,
  auditLine,
  decideAccess,
  deniedResponse,
  issueGrant,
  parseAccessBody,
  approvedResponse,
  type AccessApiResponse,
  type AccessAudit,
  type AccessRequest,
  type AccessWireReply,
  type AccessWireRequest,
} from "../lib/access.ts";
import { decideLocalBroker, onBrokerRequest } from "../lib/local-broker-client.ts";
import type { VaultEntry } from "../lib/entries.ts";

function isWireRequest(value: unknown): value is AccessWireRequest {
  if (!value || typeof value !== "object") return false;
  const row = value as AccessWireRequest;
  return row.v === 1 && row.method === "POST /v1/access/request" && typeof row.id === "string";
}

export function AccessBrokerHost({ entries }: { entries: VaultEntry[] }): ReactNode {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [pending, setPending] = useState<{
    id: string;
    request: AccessRequest;
    via: "channel" | "loopback";
  } | null>(null);
  const [audit, setAudit] = useState<AccessAudit[]>([]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  function sendReply(id: string, body: AccessApiResponse, via: "channel" | "loopback"): void {
    if (via === "loopback") {
      void decideLocalBroker(id, body);
      return;
    }
    if (channelRef.current) {
      const message: AccessWireReply = { v: 1, id, body };
      channelRef.current.postMessage(message);
    }
  }

  function handleIncoming(msg: AccessWireRequest, via: "channel" | "loopback"): void {
    const parsed = parseAccessBody(msg.body);
    if ("status" in parsed && parsed.status === "denied") {
      void sendReply(msg.id, deniedResponse("malformed_request"), via);
      return;
    }
    const request = parsed as AccessRequest;
    const verdict = decideAccess(request, entriesRef.current);
    if (verdict.status === "denied") {
      setAudit((rows) => [auditLine(request, "DENIED", verdict.reason), ...rows]);
      void sendReply(msg.id, deniedResponse(verdict.reason), via);
      return;
    }
    setPending({ id: msg.id, request, via });
  }

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(ACCESS_CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!isWireRequest(event.data)) return;
      handleIncoming(event.data, "channel");
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    onBrokerRequest((msg) => handleIncoming(msg, "loopback"));
    return () => onBrokerRequest(null);
  }, []);

  function finish(body: AccessApiResponse): void {
    if (!pending) return;
    if (pending.via === "loopback") void decideLocalBroker(pending.id, body);
    else if (channelRef.current) {
      const message: AccessWireReply = { v: 1, id: pending.id, body };
      channelRef.current.postMessage(message);
    }
    setPending(null);
  }

  return (
    <>
      {audit.length > 0 ? (
        <p className="hint" data-testid="broker-last">
          Last broker call: {audit[0]?.decision} {audit[0]?.application}
        </p>
      ) : null}
      {pending ? (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="card kit">
            <h2>Access request</h2>
            <p>
              <strong>{pending.request.application}</strong> requests{" "}
              <strong>{pending.request.provider}</strong>{" "}
              <code>{pending.request.scope.join(", ")}</code> for {pending.request.ttlSeconds}{" "}
              seconds.
            </p>
            <p className="hint">
              POST /v1/access/request — {pending.via === "loopback" ? "127.0.0.1 broker" : "local channel"},
              not FastAPI.
            </p>
            <div className="actions">
              <button
                type="button"
                className="primary"
                data-testid="broker-allow"
                onClick={() => {
                  const verdict = decideAccess(pending.request, entriesRef.current);
                  if (verdict.status !== "pending") {
                    finish(deniedResponse(verdict.status === "denied" ? verdict.reason : "no_credential"));
                    return;
                  }
                  const entry = entriesRef.current.find((item) => item.id === verdict.entryId);
                  if (!entry) {
                    finish(deniedResponse("no_credential"));
                    return;
                  }
                  const grant = issueGrant(pending.request, entry);
                  setAudit((rows) => [auditLine(pending.request, "APPROVED"), ...rows]);
                  finish(approvedResponse(grant));
                }}
              >
                Allow
              </button>
              <button
                type="button"
                className="danger"
                data-testid="broker-deny"
                onClick={() => {
                  setAudit((rows) => [auditLine(pending.request, "DENIED", "denied_by_user"), ...rows]);
                  finish(deniedResponse("denied_by_user"));
                }}
              >
                Deny
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
