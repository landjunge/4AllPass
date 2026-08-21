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
import { api } from "../lib/api.ts";
import {
  dismissDesktopAccess,
  listenDesktopAccessDecision,
  promptDesktopAccess,
} from "../lib/desktop.ts";
import { connectLocalBroker, decideLocalBroker, disconnectLocalBroker, onBrokerRequest } from "../lib/local-broker-client.ts";
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
  const [desktopPrompt, setDesktopPrompt] = useState(false);
  const [audit, setAudit] = useState<AccessAudit[]>([]);
  const entriesRef = useRef(entries);
  const pendingRef = useRef(pending);
  entriesRef.current = entries;
  pendingRef.current = pending;

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
    void promptDesktopAccess({
      requestId: msg.id,
      application: request.application,
      provider: request.provider,
      scope: request.scope,
      ttlSeconds: request.ttlSeconds,
    }).then((shown) => setDesktopPrompt(shown));
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const info = await api.localBroker();
        if (cancelled || !info.token) return;
        connectLocalBroker(info.url, info.token);
      } catch {
        // Server profile, or local core without a broker process.
      }
    })();
    return () => {
      cancelled = true;
      disconnectLocalBroker();
    };
  }, []);

  function finish(body: AccessApiResponse, from = pendingRef.current): void {
    if (!from) return;
    if (from.via === "loopback") void decideLocalBroker(from.id, body);
    else if (channelRef.current) {
      const message: AccessWireReply = { v: 1, id: from.id, body };
      channelRef.current.postMessage(message);
    }
    pendingRef.current = null;
    setPending(null);
    setDesktopPrompt(false);
    void dismissDesktopAccess();
  }

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listenDesktopAccessDecision((decision) => {
      const current = pendingRef.current;
      if (!current || current.id !== decision.requestId) return;
      if (decision.allow) {
        const verdict = decideAccess(current.request, entriesRef.current);
        if (verdict.status !== "pending") {
          finish(
            deniedResponse(verdict.status === "denied" ? verdict.reason : "no_credential"),
            current,
          );
          return;
        }
        const entry = entriesRef.current.find((item) => item.id === verdict.entryId);
        if (!entry) {
          finish(deniedResponse("no_credential"), current);
          return;
        }
        const grant = issueGrant(current.request, entry);
        setAudit((rows) => [auditLine(current.request, "APPROVED"), ...rows]);
        finish(approvedResponse(grant), current);
        return;
      }
      setAudit((rows) => [auditLine(current.request, "DENIED", "denied_by_user"), ...rows]);
      finish(deniedResponse("denied_by_user"), current);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <>
      {audit.length > 0 ? (
        <p className="hint" data-testid="broker-last">
          Last broker call: {audit[0]?.decision} {audit[0]?.application}
        </p>
      ) : null}
      {pending && !desktopPrompt ? (
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
