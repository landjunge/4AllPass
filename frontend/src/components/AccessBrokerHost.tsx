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
import type { VaultEntry } from "../lib/entries.ts";

function isWireRequest(value: unknown): value is AccessWireRequest {
  if (!value || typeof value !== "object") return false;
  const row = value as AccessWireRequest;
  return row.v === 1 && row.method === "POST /v1/access/request" && typeof row.id === "string";
}

export function AccessBrokerHost({ entries }: { entries: VaultEntry[] }): ReactNode {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [pending, setPending] = useState<{ id: string; request: AccessRequest } | null>(null);
  const [audit, setAudit] = useState<AccessAudit[]>([]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(ACCESS_CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!isWireRequest(event.data)) return;
      const parsed = parseAccessBody(event.data.body);
      if ("status" in parsed && parsed.status === "denied") {
        reply(channel, event.data.id, deniedResponse("malformed_request"));
        return;
      }
      const request = parsed as AccessRequest;
      const verdict = decideAccess(request, entriesRef.current);
      if (verdict.status === "denied") {
        setAudit((rows) => [auditLine(request, "DENIED", verdict.reason), ...rows]);
        reply(channel, event.data.id, deniedResponse(verdict.reason));
        return;
      }
      setPending({ id: event.data.id, request });
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, []);

  function finish(body: AccessApiResponse): void {
    if (!pending || !channelRef.current) return;
    reply(channelRef.current, pending.id, body);
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
            <p className="hint">POST /v1/access/request — local channel, not FastAPI.</p>
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

function reply(channel: BroadcastChannel, id: string, body: AccessApiResponse): void {
  const message: AccessWireReply = { v: 1, id, body };
  channel.postMessage(message);
}
