import { useCallback, useEffect, useState } from "react";
import { randomBytes, zeroize } from "@4allpass/crypto";
import {
  classifyCredential,
  describeMechanism,
  isPlatformAuthenticatorAvailable,
  type UnlockCapability,
} from "./unlock/capability";
import {
  PrfUnavailableError,
  registerPrfUnlock,
  unlockWithPrf,
} from "./unlock/webauthn-prf";
import {
  addEntry,
  biometricRegistration,
  createVault,
  deleteVault,
  listEntries,
  storeBiometricRegistration,
  unlockWithMasterPassword,
  vaultMeta,
  type EntryPlaintext,
} from "./vault/local-vault";

type Screen = "create" | "locked" | "unlocked";

const RP_NAME = "4AllPass";

function rpId(): string {
  return window.location.hostname;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => (vaultMeta() ? "locked" : "create"));
  const [vaultKey, setVaultKey] = useState<Uint8Array | null>(null);
  const [entries, setEntries] = useState<Array<{ id: string } & EntryPlaintext>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [biometricReady, setBiometricReady] = useState(false);
  const [platformAuth, setPlatformAuth] = useState(false);
  const [capability, setCapability] = useState<UnlockCapability | null>(null);

  useEffect(() => {
    setBiometricReady(!!vaultMeta()?.hasBiometric);
    isPlatformAuthenticatorAvailable().then(setPlatformAuth);
  }, [screen]);

  const lock = useCallback(() => {
    if (vaultKey) zeroize(vaultKey);
    setVaultKey(null);
    setEntries([]);
    setScreen("locked");
    setNotice(null);
  }, [vaultKey]);

  const openVault = useCallback((vk: Uint8Array) => {
    setVaultKey(vk);
    setEntries(listEntries(vk));
    setScreen("unlocked");
    setError(null);
  }, []);

  async function handleCreate(form: FormData) {
    const name = String(form.get("name") || "Mein Vault");
    const password = String(form.get("password") || "");
    if (password.length < 8) {
      setError("Master-Passwort braucht mindestens 8 Zeichen.");
      return;
    }
    setBusy("Argon2id läuft (mobile_safe: 32 MiB)…");
    setError(null);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const vk = createVault(name, password);
      openVault(vk);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleMasterUnlock(form: FormData) {
    const password = String(form.get("password") || "");
    setBusy("Argon2id läuft…");
    setError(null);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const vk = unlockWithMasterPassword(password);
      openVault(vk);
    } catch {
      setError("Entsperren fehlgeschlagen: falsches Master-Passwort.");
    } finally {
      setBusy(null);
    }
  }

  async function handleRegisterBiometrics() {
    const meta = vaultMeta();
    if (!meta || !vaultKey) return;
    setBusy("WebAuthn-Registrierung…");
    setError(null);
    try {
      const result = await registerPrfUnlock({
        ctx: { rpId: rpId(), vaultId: meta.vaultId, deviceId: meta.deviceId },
        rpName: RP_NAME,
        vaultKey,
        challenge: randomBytes(32),
        userHandle: new TextEncoder().encode(meta.vaultId),
        userName: meta.name,
      });
      storeBiometricRegistration(
        result.credentialId,
        result.deviceKeyEnvelope,
        result.deviceEnvelope,
      );
      setBiometricReady(true);
      setCapability({ mechanism: "prf", cryptographicBind: true });
      setNotice("Biometrie eingerichtet (WebAuthn PRF).");
    } catch (e) {
      if (e instanceof PrfUnavailableError) {
        setCapability(classifyCredential({}));
        setError(
          "PRF nicht verfügbar – Fallback-Hierarchie: largeBlob > UV-gated local store. " +
            "Master-Passwort bleibt immer möglich.",
        );
      } else {
        setError(String(e));
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleBiometricUnlock() {
    const meta = vaultMeta();
    const reg = biometricRegistration();
    if (!meta || !reg) return;
    setBusy("WebAuthn-Assertion…");
    setError(null);
    try {
      const vk = await unlockWithPrf({
        ctx: { rpId: rpId(), vaultId: meta.vaultId, deviceId: meta.deviceId },
        credentialId: reg.credentialId,
        challenge: randomBytes(32),
        deviceKeyEnvelope: reg.deviceKeyEnvelope,
        deviceEnvelope: reg.deviceEnvelope,
      });
      openVault(vk);
    } catch (e) {
      if (e instanceof PrfUnavailableError) {
        setError("PRF fehlgeschlagen – bitte Master-Passwort verwenden.");
      } else {
        setError(String(e));
      }
    } finally {
      setBusy(null);
    }
  }

  function handleAddEntry(form: FormData) {
    if (!vaultKey) return;
    addEntry(vaultKey, {
      title: String(form.get("title") || ""),
      username: String(form.get("username") || ""),
      password: String(form.get("entrypassword") || ""),
    });
    setEntries(listEntries(vaultKey));
  }

  const meta = vaultMeta();

  return (
    <div className="shell">
      <header>
        <div className="logo">🔐 4AllPass</div>
        <div className="tagline">Self-hosted · Zero-Knowledge · Crypto Protocol v1</div>
      </header>

      {error && <div className="banner error">{error}</div>}
      {notice && <div className="banner notice">{notice}</div>}
      {busy && <div className="banner busy">{busy}</div>}

      {screen === "create" && (
        <section className="card">
          <h2>Vault erstellen</h2>
          <p className="muted">
            Der Vault Key ist pure random; das Master-Passwort umhüllt ihn nur
            (Argon2id → Master Envelope). Nichts verlässt dieses Gerät.
          </p>
          <form
            action={(fd: FormData) => {
              void handleCreate(fd);
            }}
          >
            <label>
              Vault-Name
              <input name="name" defaultValue="Mein Vault" />
            </label>
            <label>
              Master-Passwort
              <input name="password" type="password" autoComplete="new-password" required />
            </label>
            <button type="submit" disabled={!!busy}>Vault erstellen</button>
          </form>
        </section>
      )}

      {screen === "locked" && meta && (
        <section className="card">
          <h2>{meta.name} entsperren</h2>
          <form
            action={(fd: FormData) => {
              void handleMasterUnlock(fd);
            }}
          >
            <label>
              Master-Passwort
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button type="submit" disabled={!!busy}>Mit Master-Passwort entsperren</button>
          </form>
          <div className="divider">oder</div>
          <button
            className="secondary"
            disabled={!biometricReady || !!busy}
            onClick={() => void handleBiometricUnlock()}
          >
            🖐 Biometrisch entsperren (WebAuthn PRF)
          </button>
          {!biometricReady && (
            <p className="muted small">
              Biometrie ist auf diesem Gerät noch nicht eingerichtet. Das
              Master-Passwort ist immer verfügbar.
            </p>
          )}
          <button className="linklike" onClick={() => { deleteVault(); setScreen("create"); }}>
            Vault löschen und neu beginnen
          </button>
        </section>
      )}

      {screen === "unlocked" && meta && (
        <>
          <section className="card">
            <div className="row">
              <h2>{meta.name}</h2>
              <button className="secondary" onClick={lock}>Sperren</button>
            </div>
            <p className="muted small">
              Vault-ID <code>{meta.vaultId.slice(0, 8)}…</code> · Device-ID{" "}
              <code>{meta.deviceId.slice(0, 8)}…</code>
            </p>
            {!biometricReady ? (
              <button
                className="secondary"
                disabled={!platformAuth || !!busy}
                onClick={() => void handleRegisterBiometrics()}
                title={platformAuth ? "" : "Kein Platform-Authenticator verfügbar"}
              >
                🖐 Biometrie einrichten (WebAuthn PRF)
              </button>
            ) : (
              <p className="ok small">✓ Biometrie eingerichtet – PRF → HKDF → DWK → DK → VK</p>
            )}
            {capability && (
              <p className="muted small">Mechanismus: {describeMechanism(capability)}</p>
            )}
          </section>

          <section className="card">
            <h3>Einträge ({entries.length})</h3>
            <ul className="entries">
              {entries.map((e) => (
                <li key={e.id}>
                  <strong>{e.title}</strong>
                  <span>{e.username}</span>
                  <code>{e.password}</code>
                </li>
              ))}
              {entries.length === 0 && <li className="muted">Noch keine Einträge.</li>}
            </ul>
            <form
              action={(fd: FormData) => {
                handleAddEntry(fd);
              }}
            >
              <div className="grid3">
                <input name="title" placeholder="Titel" required />
                <input name="username" placeholder="Benutzername" />
                <input name="entrypassword" placeholder="Passwort" required />
              </div>
              <button type="submit">Eintrag verschlüsselt speichern</button>
            </form>
          </section>
        </>
      )}

      <footer className="muted small">
        AES-256-GCM mit Pflicht-AAD · Argon2id · WebAuthn PRF (userVerification: required) ·
        Fallback: PRF &gt; largeBlob &gt; UV-gated local store &gt; Master-Passwort
      </footer>
    </div>
  );
}
