import { useState, type ReactNode } from "react";
import { CLIPBOARD_CLEAR_MS, copySecret } from "../lib/clipboard.ts";
import { useApp } from "../state/app-state.tsx";

function kitText(vaultId: string, recoveryKey: string): string {
  return [
    "4AllPass emergency kit",
    "",
    `Vault ID: ${vaultId}`,
    "",
    "Recovery key:",
    recoveryKey,
    "",
    "This is the only other way into the vault. There is no e-mail reset and the",
    "server cannot recover it for you. Store this offline. Do not screenshot it",
    "into a cloud album.",
    "",
  ].join("\n");
}

function downloadKit(vaultId: string, recoveryKey: string): void {
  const blob = new Blob([kitText(vaultId, recoveryKey)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `4allpass-emergency-kit-${vaultId.slice(0, 8)}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function printKit(vaultId: string, recoveryKey: string): void {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.append(frame);
  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    window.print();
    return;
  }
  doc.open();
  doc.write(`<!doctype html><title>4AllPass emergency kit</title>
    <pre style="font:16px/1.6 ui-monospace,monospace;white-space:pre-wrap;padding:24px">${kitText(vaultId, recoveryKey).replaceAll("<", "&lt;")}</pre>`);
  doc.close();
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  window.setTimeout(() => frame.remove(), 1000);
}

/** Emergency Kit (crypto-protocol.md §6). Shown once, never stored anywhere. */
export function RecoveryKitDialog(): ReactNode {
  const { recoveryKey, activeVaultId, dismissRecoveryKey } = useApp();
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!recoveryKey || !activeVaultId) return null;

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="card kit">
        <h2>Save your recovery key</h2>
        <p>
          Write this down or keep an offline copy. If you lose both the vault password and this
          key, the vault cannot be opened. There is no e-mail recovery.
        </p>
        <p className="muted small">Vault ID</p>
        <code className="mono block">{activeVaultId}</code>
        <p className="muted small">Recovery key</p>
        <code className="mono block key" data-testid="recovery-key">
          {recoveryKey}
        </code>
        <div className="device-actions">
          <button type="button" onClick={() => downloadKit(activeVaultId, recoveryKey)}>
            Download
          </button>
          <button type="button" onClick={() => printKit(activeVaultId, recoveryKey)}>
            Print
          </button>
          <button
            type="button"
            data-testid="copy-recovery-key"
            onClick={() => {
              void copySecret(recoveryKey).then(() => setCopied(true));
            }}
          >
            Copy key
          </button>
        </div>
        {copied ? (
          <p className="hint">
            Key copied. The clipboard is overwritten in {CLIPBOARD_CLEAR_MS / 1000} seconds if it
            still holds this value. Prefer download or print for the offline kit.
          </p>
        ) : null}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          I stored this recovery key offline.
        </label>
        <button
          type="button"
          className="primary"
          disabled={!confirmed}
          onClick={dismissRecoveryKey}
          data-testid="dismiss-kit"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
