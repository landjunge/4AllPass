import { useState, type ReactNode } from "react";
import {
  auditLine,
  decideAccess,
  issueGrant,
  readGrant,
  wipeGrant,
  type AccessAudit,
  type AccessGrant,
  type AccessRequest,
} from "../lib/access.ts";
import type { VaultEntry } from "../lib/entries.ts";

const DEMO_TTL = 15;

export function AccessPanel({ entries }: { entries: VaultEntry[] }): ReactNode {
  const [pending, setPending] = useState<AccessRequest | null>(null);
  const [grant, setGrant] = useState<AccessGrant | null>(null);
  const [audit, setAudit] = useState<AccessAudit[]>([]);
  const [flash, setFlash] = useState<string>("");
  const [nowTick, setNowTick] = useState(Date.now());

  function run(request: AccessRequest): void {
    const verdict = decideAccess(request, entries);
    if (verdict.status === "denied") {
      setPending(null);
      setFlash(`DENIED — ${verdict.reason.replaceAll("_", " ")}`);
      setAudit((rows) => [auditLine(request, "DENIED", verdict.reason), ...rows]);
      return;
    }
    setPending(request);
    setFlash("");
  }

  function allow(): void {
    if (!pending) return;
    const verdict = decideAccess(pending, entries);
    if (verdict.status !== "pending") return;
    const entry = entries.find((item) => item.id === verdict.entryId);
    if (!entry) return;
    setGrant(issueGrant(pending, entry));
    setAudit((rows) => [auditLine(pending, "APPROVED"), ...rows]);
    setPending(null);
    setFlash("ACCESS GRANTED");
    window.setTimeout(() => setNowTick(Date.now()), (DEMO_TTL + 1) * 1000);
  }

  const live = grant ? readGrant(grant, nowTick) : null;
  const expired = Boolean(grant && live && "status" in live && live.status === "denied");

  return (
    <div className="columns">
      <section className="card">
        <h3>n8n demo</h3>
        <p className="muted">
          Local policy only. The FastAPI server never sees this request or the secret. Unknown apps
          are denied. Auto-detect is not auto-approve — there is no detect in this panel.
        </p>
        <p className="hint">
          Agent page (same origin):{" "}
          <a href="/agent-request.html" target="_blank" rel="noreferrer">
            /agent-request.html
          </a>{" "}
          speaks POST /v1/access/request over BroadcastChannel.
        </p>
        <div className="device-actions">
          <button
            type="button"
            className="primary"
            data-testid="demo-n8n-read"
            onClick={() =>
              run({
                application: "n8n",
                provider: "GitHub",
                credential: "personal",
                scope: ["repository.read"],
                ttlSeconds: DEMO_TTL,
              })
            }
          >
            n8n asks GitHub repository.read ({DEMO_TTL}s)
          </button>
          <button
            type="button"
            data-testid="demo-n8n-delete"
            onClick={() =>
              run({
                application: "n8n",
                provider: "GitHub",
                credential: "personal",
                scope: ["repository.delete"],
                ttlSeconds: DEMO_TTL,
              })
            }
          >
            n8n asks repository.delete
          </button>
          <button
            type="button"
            data-testid="demo-unknown-app"
            onClick={() =>
              run({
                application: "malicious-agent",
                provider: "GitHub",
                credential: "personal",
                scope: ["repository.read"],
                ttlSeconds: DEMO_TTL,
              })
            }
          >
            unknown app asks GitHub
          </button>
        </div>
        {flash ? (
          <p className={flash.startsWith("DENIED") ? "error-text" : "ok"} data-testid="access-flash">
            {flash}
            {expired ? " Credential expired." : ""}
          </p>
        ) : null}
        {expired && grant ? (
          <button
            type="button"
            className="link"
            onClick={() => {
              setGrant(wipeGrant(grant));
              setAudit((rows) => [
                auditLine(
                  {
                    application: grant.application,
                    provider: grant.provider,
                    credential: "",
                    scope: grant.scope,
                    ttlSeconds: 0,
                  },
                  "EXPIRED",
                  "expired",
                ),
                ...rows,
              ]);
              setFlash("Credential expired.");
            }}
          >
            Mark expired
          </button>
        ) : null}
      </section>
      <section className="card">
        <h3>Audit</h3>
        <p className="hint">No secret is stored in these rows.</p>
        {audit.length === 0 ? (
          <p className="muted">No access events yet.</p>
        ) : (
          <ul className="devices" data-testid="access-audit">
            {audit.map((row) => (
              <li key={row.at + row.decision + row.application}>
                <strong>{row.decision}</strong>
                <span className="muted small">
                  {row.application} → {row.provider} {row.scope.join(", ")}
                  {row.reason ? ` · ${row.reason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {pending ? (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="card kit">
            <h2>Access request</h2>
            <p>
              <strong>{pending.application}</strong> requests <strong>{pending.provider}</strong>{" "}
              <code>{pending.scope.join(", ")}</code> for {pending.ttlSeconds} seconds.
            </p>
            {pending.scope.some((scope) => /write|delete|admin/i.test(scope)) ? (
              <p className="error-text">High-risk capability</p>
            ) : null}
            <div className="actions">
              <button type="button" className="primary" data-testid="access-allow" onClick={allow}>
                Allow
              </button>
              <button
                type="button"
                className="danger"
                data-testid="access-deny"
                onClick={() => {
                  setAudit((rows) => [auditLine(pending, "DENIED", "denied_by_user"), ...rows]);
                  setPending(null);
                  setFlash("DENIED — denied by user");
                }}
              >
                Deny
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
