import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../state/app-state.tsx";
import {
  prfCapabilityState,
  probeWebviewWebauthn,
  type PrfCapabilityState,
} from "../lib/webauthnCapabilities.ts";

const MECHANISM_LABEL: Record<string, string> = {
  prf: "WebAuthn PRF (rank 1)",
  large_blob: "WebAuthn largeBlob (rank 2)",
  uv_gated_local: "UV-gated local store (rank 3 — policy only)",
};

export function DevicesPanel(): ReactNode {
  const {
    devices,
    refreshDevices,
    enableBiometrics,
    revoke,
    hardRevoke,
    replaceTrustedRecovery,
    rotateCompromisedRecovery,
    thisDeviceId,
    deviceUnlockAvailable,
    vault,
  } = useApp();
  const [busy, setBusy] = useState(false);
  const [mechanism, setMechanism] = useState<string | null>(null);
  const [prfState, setPrfState] = useState<PrfCapabilityState | null>(null);
  const [rotateTarget, setRotateTarget] = useState<string | null>(null);
  const [masterPassword, setMasterPassword] = useState("");
  const [recoveryKeyText, setRecoveryKeyText] = useState("");
  const [kitAction, setKitAction] = useState<"none" | "trusted" | "compromised">("none");
  const [oldKitText, setOldKitText] = useState("");
  const [compromisePassword, setCompromisePassword] = useState("");
  const needsRecoveryKey = Boolean(vault?.envelopes.some((env) => env.type === "recovery"));

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    void probeWebviewWebauthn().then((caps) => {
      setPrfState(prfCapabilityState(caps));
    });
  }, []);

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
        {prfState && prfState !== "available" ? (
          <p className="hint" data-testid="no-prf-hint">
            Dieses Fenster hat WebAuthn-PRF nicht bewiesen (Desktop-WebView oft null). Enable fällt
            auf largeBlob oder einen UV-gated lokalen Store zurück (Rang 2 oder 3). / This window
            has not proven WebAuthn PRF (desktop WebView often reports none). Enabling falls back to
            largeBlob or a UV-gated local store (rank 2 or 3).
          </p>
        ) : null}
        {mechanism === "uv_gated_local" ? (
          <p className="hint" data-testid="rank3-warning">
            Rang 3 ist nur ein Policy-Tor, keine kryptografische Authenticator-Bindung. Face ID /
            Touch ID gibt den Wrapping-Key in diesem Browser-Profil frei — das ist nicht PRF. / Rank
            3 is a policy gate, not a cryptographic authenticator bind. Face ID / Touch ID releases
            a wrapping key stored in this browser profile. That is not PRF.
          </p>
        ) : null}
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
                      {credential.hasMirroredDeviceKeyEnvelope ? " · envelope mirrored" : ""}
                      {credential.revokedAt ? " · revoked" : ""}
                    </span>
                  ))}
                </div>
                {device.revokedAt ? (
                  <span className="muted small">revoked</span>
                ) : (
                  <div className="device-actions">
                    <button
                      type="button"
                      className="danger"
                      onClick={() => void revoke(device.deviceId)}
                      disabled={busy}
                    >
                      Remove from sync
                    </button>
                    <button
                      type="button"
                      className="danger"
                      data-testid={`rotate-key-${device.deviceId}`}
                      onClick={() => setRotateTarget(device.deviceId)}
                      disabled={busy}
                    >
                      Rotate vault key
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          “Remove from sync” drops the device envelope in the next revision. That is not cryptographic
          erase — a device that already holds this vault key can still read snapshots sealed under it.
          Suspected compromise needs “Rotate vault key”: new random vault key, re-encrypt, then
          metadata revoke. Other devices re-enrol with the master password.
        </p>
        {rotateTarget ? (
          <form
            className="rotate-form"
            onSubmit={(event) => {
              event.preventDefault();
              const target = rotateTarget;
              setBusy(true);
              void hardRevoke(target, masterPassword, recoveryKeyText || undefined)
                .then(() => {
                  setRotateTarget(null);
                  setMasterPassword("");
                  setRecoveryKeyText("");
                })
                .finally(() => setBusy(false));
            }}
          >
            <h4>Rotate vault key</h4>
            <p className="muted small mono">{rotateTarget}</p>
            <label>
              Vault password
              <input
                type="password"
                autoComplete="current-password"
                value={masterPassword}
                onChange={(event) => setMasterPassword(event.target.value)}
                required
                minLength={10}
                data-testid="rotate-vault-password"
              />
            </label>
            {needsRecoveryKey ? (
              <label>
                Recovery key
                <textarea
                  value={recoveryKeyText}
                  onChange={(event) => setRecoveryKeyText(event.target.value)}
                  rows={3}
                  placeholder="XXXXX-XXXXX-XXXXX-…"
                  required
                  data-testid="rotate-recovery-key"
                />
              </label>
            ) : null}
            <p className="hint">
              Confirms you still know the unwrap secrets, then seals revision N+1 under a new vault
              key. DELETE runs only after that commit succeeds.
            </p>
            <div className="device-actions">
              <button type="submit" className="danger" disabled={busy} data-testid="confirm-rotate">
                {busy ? "Rotating…" : "Confirm rotation"}
              </button>
              <button
                type="button"
                className="link"
                disabled={busy}
                onClick={() => {
                  setRotateTarget(null);
                  setMasterPassword("");
                  setRecoveryKeyText("");
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </section>

      {needsRecoveryKey ? (
        <section className="card">
          <h3>Notfall-Schlüssel / Emergency kit</h3>
          <p className="hint">
            Ein gestohlener Recovery Key ist vollständiger Vault-Zugriff. Nur ersetzen, wenn der
            alte Schlüssel noch bei dir ist. Wenn er kompromittiert sein kann: Vault-Key rotieren.
            / A stolen recovery key is full vault access. Replace the print only while you still
            hold the old kit. If it may be stolen: rotate the vault key.
          </p>
          {kitAction === "none" ? (
            <div className="device-actions">
              <button type="button" onClick={() => setKitAction("trusted")} data-testid="replace-recovery-trusted">
                Neuen Schlüssel drucken / Print a new kit
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => setKitAction("compromised")}
                data-testid="rotate-recovery-compromised"
              >
                Kit gestohlen / Kit may be stolen
              </button>
            </div>
          ) : null}
          {kitAction === "trusted" ? (
            <form
              className="rotate-form"
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                void replaceTrustedRecovery(oldKitText)
                  .then(() => {
                    setKitAction("none");
                    setOldKitText("");
                  })
                  .finally(() => setBusy(false));
              }}
            >
              <label>
                Bisheriger Recovery Key / Current recovery key
                <textarea
                  value={oldKitText}
                  onChange={(event) => setOldKitText(event.target.value)}
                  rows={3}
                  required
                  data-testid="trusted-recovery-current"
                />
              </label>
              <p className="hint">
                Gleiche Vault-Key-Generation, neuer Druck. / Same vault-key generation, new print.
              </p>
              <div className="device-actions">
                <button type="submit" disabled={busy} data-testid="confirm-trusted-recovery">
                  {busy ? "…" : "Neuen Schlüssel erzeugen / Mint new kit"}
                </button>
                <button type="button" className="link" onClick={() => setKitAction("none")}>
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
          {kitAction === "compromised" ? (
            <form
              className="rotate-form"
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                void rotateCompromisedRecovery(compromisePassword, oldKitText || undefined)
                  .then(() => {
                    setKitAction("none");
                    setOldKitText("");
                    setCompromisePassword("");
                  })
                  .finally(() => setBusy(false));
              }}
            >
              <label>
                Vault password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={compromisePassword}
                  onChange={(event) => setCompromisePassword(event.target.value)}
                  required
                  minLength={10}
                  data-testid="compromised-recovery-password"
                />
              </label>
              <label>
                Alter Recovery Key, falls noch da / Previous kit if you still have it
                <textarea
                  value={oldKitText}
                  onChange={(event) => setOldKitText(event.target.value)}
                  rows={3}
                  data-testid="compromised-recovery-old"
                />
              </label>
              <p className="hint">
                Erzwingt eine neue Vault-Key-Generation. Der alte Druck öffnet VK₂ nicht. / Forces a
                new vault-key generation. The stolen print cannot open VK₂.
              </p>
              <div className="device-actions">
                <button type="submit" className="danger" disabled={busy} data-testid="confirm-compromised-recovery">
                  {busy ? "Rotating…" : "Vault-Key rotieren / Rotate vault key"}
                </button>
                <button type="button" className="link" onClick={() => setKitAction("none")}>
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
