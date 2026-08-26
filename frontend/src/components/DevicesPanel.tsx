import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../state/app-state.tsx";
import { useCopy } from "../state/copy-mode.tsx";
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
  const { t } = useCopy();
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
        <h3>{t({ de: "Dieses Gerät", en: "This device" })}</h3>
        <p className="muted mono">{thisDeviceId}</p>
        {deviceUnlockAvailable ? (
          <p className="ok" data-testid="device-unlock-state">
            {t({
              de: "Dieses Gerät kann den Tresor hier öffnen.",
              en: "Device unlock is enabled in this browser profile.",
            })}
          </p>
        ) : (
          <p className="muted">
            {t({
              de: "Geräte-Entsperren ist hier noch nicht eingerichtet.",
              en: "Device unlock is not set up here yet.",
            })}
          </p>
        )}
        <button
          type="button"
          className="primary"
          onClick={() => void enable()}
          disabled={busy}
          data-testid="enable-biometrics"
        >
          {busy
            ? t({ de: "Warten auf dieses Gerät…", en: "Waiting for the authenticator…" })
            : t({ de: "Geräte-Entsperren einschalten", en: "Enable device unlock" })}
        </button>
        {mechanism ? (
          <p className="ok" data-testid="enabled-mechanism">
            {t({ de: "Eingeschaltet über", en: "Enabled via" })}{" "}
            {MECHANISM_LABEL[mechanism] ?? mechanism}
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
          {t(
            {
              de: "Dieses Gerät merkt sich den Tresor. Das Tresor-Passwort gilt weiter.",
              en: "This device can remember the vault. The vault password still works.",
            },
            {
              de: "WebAuthn gibt einen Device-Wrapping-Key frei, der den Device Key und damit den Vault Key öffnet. PRF-Ausgabe ist nie der AES-Schlüssel und wird sofort gelöscht.",
              en: "WebAuthn unlocks a Device Wrapping Key, which unwraps a random Device Key, which unwraps the Vault Key. The PRF output is never used as a key and is wiped straight after use. The master password keeps working either way.",
            },
          )}
        </p>
      </section>

      <section className="card">
        <h3>
          {t({
            de: "Welche Geräte dürfen diesen Tresor öffnen?",
            en: "Which devices may open this vault?",
          })}
        </h3>
        {devices.length === 0 ? (
          <p className="muted">{t({ de: "Noch keine Geräte.", en: "No devices registered." })}</p>
        ) : (
          <ul className="devices">
            {devices.map((device) => (
              <li key={device.deviceId}>
                <div>
                  <strong>{device.label}</strong>
                  {device.deviceId === thisDeviceId ? (
                    <span className="badge">{t({ de: "dieses Gerät", en: "this device" })}</span>
                  ) : null}
                  <span className="muted mono small">{device.deviceId}</span>
                  <span className={device.hasDeviceEnvelope ? "ok small" : "muted small"}>
                    {device.hasDeviceEnvelope
                      ? t(
                          {
                            de: "kann diesen Tresor öffnen",
                            en: "can open this vault",
                          },
                          {
                            de: "Geräte-Umschlag in der aktiven Revision",
                            en: "device envelope in the active revision",
                          },
                        )
                      : t(
                          {
                            de: "kann den Tresor nicht öffnen",
                            en: "cannot open this vault",
                          },
                          {
                            de: "kein Geräte-Umschlag — Vault Key nicht erhältlich",
                            en: "no device envelope — cannot obtain the Vault Key",
                          },
                        )}
                  </span>
                  {device.credentials.map((credential) => (
                    <span key={credential.id} className="muted small">
                      {MECHANISM_LABEL[credential.mechanism] ?? credential.mechanism}
                      {credential.hasMirroredDeviceKeyEnvelope
                        ? t({ de: " · Umschlag gespiegelt", en: " · envelope mirrored" })
                        : ""}
                      {credential.revokedAt ? t({ de: " · entzogen", en: " · revoked" }) : ""}
                    </span>
                  ))}
                </div>
                {device.revokedAt ? (
                  <span className="muted small">{t({ de: "entzogen", en: "revoked" })}</span>
                ) : (
                  <div className="device-actions">
                    <button
                      type="button"
                      className="danger"
                      onClick={() => void revoke(device.deviceId)}
                      disabled={busy}
                    >
                      {t({ de: "Aus Sync nehmen", en: "Remove from sync" })}
                    </button>
                    <button
                      type="button"
                      className="danger"
                      data-testid={`rotate-key-${device.deviceId}`}
                      onClick={() => setRotateTarget(device.deviceId)}
                      disabled={busy}
                    >
                      {t({ de: "Tresor-Schlüssel wechseln", en: "Rotate vault key" })}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          {t(
            {
              de: "„Aus Sync nehmen“ nimmt diesem Gerät den nächsten Stand. Ein Gerät, das den Schlüssel schon hat, kann alte Stände noch lesen. Bei Verdacht: Tresor-Schlüssel wechseln. Andere Geräte mit dem Tresor-Passwort neu anmelden.",
              en: "“Remove from sync” drops this device from the next revision. A device that already holds this vault key can still read snapshots sealed under it. Suspected compromise needs “Rotate vault key”. Other devices re-enrol with the vault password.",
            },
            {
              de: "Soft-Revoke löscht den Geräte-Umschlag in N+1. Das ist kein kryptografisches Löschen. Kompromissverdacht braucht vaultKeyVersion++.",
              en: "“Remove from sync” drops the device envelope in the next revision. That is not cryptographic erase. Suspected compromise needs “Rotate vault key”: new random vault key, re-encrypt, then metadata revoke.",
            },
          )}
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
            <h4>{t({ de: "Tresor-Schlüssel wechseln", en: "Rotate vault key" })}</h4>
            <p className="muted small mono">{rotateTarget}</p>
            <label>
              {t({ de: "Tresor-Passwort", en: "Vault password" })}
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
                {t({ de: "Recovery-Schlüssel", en: "Recovery key" })}
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
              {t({
                de: "Bestätigt, dass du Passwort und Schlüssel noch kennst, und versiegelt den nächsten Stand unter einem neuen Schlüssel. Entziehen läuft erst danach.",
                en: "Confirms you still know the unwrap secrets, then seals revision N+1 under a new vault key. DELETE runs only after that commit succeeds.",
              })}
            </p>
            <div className="device-actions">
              <button type="submit" className="danger" disabled={busy} data-testid="confirm-rotate">
                {busy
                  ? t({ de: "Wird gewechselt…", en: "Rotating…" })
                  : t({ de: "Wechsel bestätigen", en: "Confirm rotation" })}
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
                {t({ de: "Abbrechen", en: "Cancel" })}
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
                  {t({ de: "Abbrechen", en: "Cancel" })}
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
                {t({ de: "Tresor-Passwort", en: "Vault password" })}
                <input>
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
                  {busy
                    ? t({ de: "Wird gewechselt…", en: "Rotating…" })
                    : t({ de: "Tresor-Schlüssel wechseln", en: "Rotate vault key" })}
                </button>
                <button type="button" className="link" onClick={() => setKitAction("none")}>
                  {t({ de: "Abbrechen", en: "Cancel" })}
                </button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
