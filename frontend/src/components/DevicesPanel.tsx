import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../state/app-state.tsx";
import { webauthnPrfAvailable } from "../lib/webauthnCapabilities.ts";

const MECHANISM_LABEL: Record<string, string> = {
  prf: "WebAuthn PRF (rank 1)",
  large_blob: "WebAuthn largeBlob (rank 2)",
  uv_gated_local: "UV-gated local store (rank 3)",
};

export function DevicesPanel(): ReactNode {
  const { devices, refreshDevices, enableBiometrics, revoke, thisDeviceId, deviceUnlockAvailable } =
    useApp();
  const [busy, setBusy] = useState(false);
  const [mechanism, setMechanism] = useState<string | null>(null);
  const [prfAvailable] = useState(() => webauthnPrfAvailable());

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  async function enable(): Promise<void> {
    setBusy(true);
    setMechanism(null);
    try {
      setMechanism(await enableBiometrics());
    } catch {
      // The banner shows the reason.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="columns">
      <section className="card">
        <h3>This device</h3>
        <p className="muted mono">{thisDeviceId}</p>
        {deviceUnlockAvailable ? (
          <p className="ok" data-testid="device-unlock-state">
            Device unlock is enabled in this browser profile.
          </p>
        ) : (
          <p className="muted">Device unlock is not set up here yet.</p>
        )}
        <button
          type="button"
          className="primary"
          onClick={() => void enable()}
          disabled={busy}
          data-testid="enable-biometrics"
        >
          {busy ? "Waiting for the authenticator…" : "Enable device unlock"}
        </button>
        {mechanism ? (
          <p className="ok" data-testid="enabled-mechanism">
            Enabled via {MECHANISM_LABEL[mechanism] ?? mechanism}
          </p>
        ) : null}
        {prfAvailable ? null : (
          <p className="hint" data-testid="no-prf-hint">
            This browser reports no WebAuthn PRF support, so enabling falls back to largeBlob or a
            UV-gated local store (rank 2 or 3).
          </p>
        )}
        <p className="hint">
          WebAuthn unlocks a Device Wrapping Key, which unwraps a random Device Key, which unwraps
          the Vault Key. The PRF output is never used as a key and is wiped straight after use. The
          master password keeps working either way.
        </p>
      </section>

      <section className="card">
        <h3>Authorized devices</h3>
        {devices.length === 0 ? (
          <p className="muted">No devices registered.</p>
        ) : (
          <ul className="devices">
            {devices.map((device) => (
              <li key={device.deviceId}>
                <div>
                  <strong>{device.label}</strong>
                  {device.deviceId === thisDeviceId ? <span className="badge">this device</span> : null}
                  <span className="muted mono small">{device.deviceId}</span>
                  <span className={device.hasDeviceEnvelope ? "ok small" : "muted small"}>
                    {device.hasDeviceEnvelope
                      ? "device envelope in the active revision"
                      : "no device envelope — cannot obtain the Vault Key"}
                  </span>
                  {device.credentials.map((credential) => (
                    <span key={credential.id} className="muted small">
                      {MECHANISM_LABEL[credential.mechanism] ?? credential.mechanism}
                      {credential.serverVerified
                        ? " · server-verified assertion"
                        : " · client-attested metadata only"}
                      {credential.hasMirroredDeviceKeyEnvelope ? " · envelope mirrored" : ""}
                      {credential.revokedAt ? " · revoked" : ""}
                    </span>
                  ))}
                </div>
                {device.revokedAt ? (
                  <span className="muted small">revoked</span>
                ) : (
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void revoke(device.deviceId)}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          Revoking drops the device envelope in the next revision. A device that already knows this
          Vault Key still knows it, so a suspected compromise needs a key rotation.
        </p>
      </section>
    </div>
  );
}
