import { useState, type ReactNode } from "react";
import { useApp } from "../state/app-state.tsx";

/** Emergency Kit (crypto-protocol.md §6). Shown once, never stored anywhere. */
export function RecoveryKitDialog(): ReactNode {
  const { recoveryKey, activeVaultId, dismissRecoveryKey } = useApp();
  const [confirmed, setConfirmed] = useState(false);
  if (!recoveryKey) return null;

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="card kit">
        <h2>Emergency Kit</h2>
        <p>
          This recovery key is the only other way into your vault. There is no server-side reset and
          no e-mail recovery.
        </p>
        <p className="muted small">Vault ID</p>
        <code className="mono block">{activeVaultId}</code>
        <p className="muted small">Recovery key</p>
        <code className="mono block key" data-testid="recovery-key">
          {recoveryKey}
        </code>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          I stored this offline.
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
