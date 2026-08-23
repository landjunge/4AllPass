import { useEffect, useState, type ReactNode } from "react";
import {
  auditLine,
  decideAccess,
  explainAccess,
  explainDenyReason,
  formatAuditClock,
  issueGrant,
  readGrant,
  wipeGrant,
  type AccessAudit,
  type AccessGrant,
  type AccessRequest,
} from "../lib/access.ts";
import { LocalBrokerConnect } from "./LocalBrokerConnect.tsx";
import { N8nHttpRecipe } from "./N8nHttpRecipe.tsx";
import {
  DEMO_TTL_SECONDS,
  demoDeleteRequest,
  demoReadRequest,
  demoSceneCopy,
  demoUnknownRequest,
  hasGithubReadCredential,
  nextDemoScene,
  grantHandoffCopy,
  remainingSeconds,
  startingScene,
  type DemoSceneId,
} from "../lib/access-demo.ts";
import type { VaultEntry } from "../lib/entries.ts";

export function AccessPanel({
  entries,
  onSeedDemo,
}: {
  entries: VaultEntry[];
  onSeedDemo?: () => Promise<void>;
}): ReactNode {
  const ready = hasGithubReadCredential(entries);
  const [scene, setScene] = useState<DemoSceneId>(() => startingScene(entries));
  const [pending, setPending] = useState<AccessRequest | null>(null);
  const [grant, setGrant] = useState<AccessGrant | null>(null);
  const [audit, setAudit] = useState<AccessAudit[]>([]);
  const [flash, setFlash] = useState("");
  const [why, setWhy] = useState("");
  const [nowTick, setNowTick] = useState(Date.now());
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    if (scene === "setup" && ready) setScene("read");
  }, [ready, scene]);

  useEffect(() => {
    if (scene !== "read" && scene !== "expire") return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [scene]);

  const live = grant ? readGrant(grant, nowTick) : null;
  const expired = Boolean(grant && live && "status" in live && live.status === "denied");
  const left = grant && live && "material" in live ? remainingSeconds(grant.expiresAt, nowTick) : 0;
  const copy = demoSceneCopy(scene);

  function run(request: AccessRequest): void {
    const verdict = decideAccess(request, entries);
    if (verdict.status === "denied") {
      setPending(null);
      setFlash(`DENIED — ${verdict.reason.replaceAll("_", " ")}`);
      setWhy(explainAccess(verdict).why);
      setAudit((rows) => [auditLine(request, "DENIED", verdict.reason), ...rows]);
      return;
    }
    setPending(request);
    setFlash("");
    setWhy(explainAccess(verdict).why);
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
    setWhy(
      "Allow erteilt einen zeitlich begrenzten Grant. Das Passwort bleibt im Tresor. / Allow issues a time-boxed grant. The password stays in the vault.",
    );
    setNowTick(Date.now());
    window.setTimeout(() => setNowTick(Date.now()), (DEMO_TTL_SECONDS + 1) * 1000);
  }

  function expireNow(): void {
    if (!grant) return;
    setGrant(wipeGrant(grant));
    setNowTick(Date.now());
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
    setWhy(explainDenyReason("expired"));
  }

  function reset(): void {
    setGrant(null);
    setPending(null);
    setAudit([]);
    setFlash("");
    setWhy("");
    setScene(startingScene(entries));
  }

  return (
    <div className="columns">
      <section className="card">
        <h3>Access simulator</h3>
        <p className="muted">
          Same policy as the loopback broker. FastAPI never sees this request or the secret. Access
          is not the first screen.
        </p>
        <ol className="demo-steps" data-testid="demo-steps">
          {(["read", "delete", "expire", "unknown"] as const).map((id) => (
            <li key={id} className={scene === id ? "active" : ""}>
              {demoSceneCopy(id).title}
            </li>
          ))}
        </ol>
        <p className="hint" data-testid="demo-scene">
          {copy.step} — {copy.title}
        </p>
        <p>{copy.body}</p>
        {scene === "setup" ? (
          <div className="device-actions">
            <button
              type="button"
              className="primary"
              data-testid="demo-seed"
              disabled={!onSeedDemo || seeding}
              onClick={() => {
                if (!onSeedDemo) return;
                setSeeding(true);
                void onSeedDemo().finally(() => setSeeding(false));
              }}
            >
              {seeding ? "Encrypting…" : copy.action}
            </button>
          </div>
        ) : null}
        {scene === "read" ? (
          <div className="device-actions">
            <button
              type="button"
              className="primary"
              data-testid="demo-n8n-read"
              onClick={() => run(demoReadRequest())}
            >
              {copy.action}
            </button>
          </div>
        ) : null}
        {scene === "delete" ? (
          <div className="device-actions">
            <button
              type="button"
              className="primary"
              data-testid="demo-n8n-delete"
              onClick={() => run(demoDeleteRequest())}
            >
              {copy.action}
            </button>
          </div>
        ) : null}
        {scene === "expire" ? (
          <div className="device-actions">
            <button
              type="button"
              className="primary"
              data-testid="demo-expire-now"
              disabled={!grant}
              onClick={expireNow}
            >
              {copy.action}
            </button>
          </div>
        ) : null}
        {scene === "unknown" ? (
          <div className="device-actions">
            <button
              type="button"
              className="primary"
              data-testid="demo-unknown-app"
              onClick={() => run(demoUnknownRequest())}
            >
              {copy.action}
            </button>
          </div>
        ) : null}
        {scene === "done" ? (
          <div className="device-actions">
            <button type="button" className="primary" data-testid="demo-replay" onClick={reset}>
              {copy.action}
            </button>
          </div>
        ) : null}
        {flash ? (
          <p className={flash.startsWith("DENIED") ? "error-text" : "ok"} data-testid="access-flash">
            {flash}
            {expired && scene !== "expire" ? " Credential expired." : ""}
          </p>
        ) : null}
        {why ? (
          <p className="hint" data-testid="access-why">
            Why: {why}
          </p>
        ) : null}
        {grant && live && "material" in live ? (
          <p className="hint" data-testid="demo-grant-status">
            {grantHandoffCopy(grant.application, left)}
          </p>
        ) : null}
        {expired && grant ? (
          <p className="hint" data-testid="demo-expired">
            Future handoffs stop. Rotate the upstream secret to revoke a leak.
          </p>
        ) : null}
        {scene !== "setup" && scene !== "done" ? (
          <button
            type="button"
            className="link"
            data-testid="demo-next"
            onClick={() => setScene(nextDemoScene(scene))}
          >
            Next scene
          </button>
        ) : null}
        <p className="hint">
          Same-origin agent page:{" "}
          <a href="/agent-request.html" target="_blank" rel="noreferrer">
            /agent-request.html
          </a>{" "}
          speaks POST /v1/access/request over BroadcastChannel. Walkthrough:{" "}
          <code>docs/two-minute-demo.md</code>.
        </p>
      </section>
      <section className="card" data-testid="access-security-status">
        <h3>Security status</h3>
        <ul className="hint">
          <li>Unknown application = DENY</li>
          <li>Loopback broker only (127.0.0.1). Browser Origin on the grant path = 403</li>
          <li>FastAPI mints no tokens and never sees plaintext</li>
          <li>Policy allow means human Allow, not auto-handoff</li>
          <li>TTL stops future handoffs. A copy already given is not un-known</li>
        </ul>
      </section>
      <N8nHttpRecipe />
      <LocalBrokerConnect />
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
                  {formatAuditClock(row.at)} · {row.application} → {row.provider} ·{" "}
                  {row.scope.join(", ")} · {row.ttlSeconds}s
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
            <p className="hint" data-testid="access-why-pending">
              Why: {explainAccess({ status: "pending", entryId: "", risk: false }).why}
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
                  setWhy(explainDenyReason("denied_by_user"));
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
