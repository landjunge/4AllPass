import { useEffect, useState, type ReactNode } from "react";
import { prfCapabilityState, probeWebviewWebauthn } from "../lib/webauthnCapabilities.ts";

export function WelcomePage({
  onCreate,
  onRestore,
}: {
  onCreate: () => void;
  onRestore: () => void;
}): ReactNode {
  const [prfLine, setPrfLine] = useState<string | null>(null);

  useEffect(() => {
    void probeWebviewWebauthn().then((caps) => {
      const state = prfCapabilityState(caps);
      if (state === "available") {
        setPrfLine(
          "Dieses Fenster kann Geräte-Entsperren. Das Tresor-Passwort gilt weiter. / This window can unlock with this device. The vault password still works.",
        );
        return;
      }
      setPrfLine(null);
    });
  }, []);

  return (
    <div className="centered">
      <div className="card auth">
        <img className="logo" src="/logo.png" alt="4AllPass" />
        <h2>Deine Zugangsdaten. Unter deiner Kontrolle.</h2>
        <p className="muted">Your credentials. Under your control.</p>
        <p className="hint">
          Als Nächstes nur das Tresor-Passwort — oder eine Share-Datei, wenn du schon einen Tresor
          hast. Kein Konto, keine E-Mail. Wenn du das Passwort vergisst, hilft nur der
          Recovery-Schlüssel — niemand kann ihn zurücksetzen. / Next: vault password, or a share
          file if you already have a vault. No account. If you forget the password, only the
          recovery key helps — nobody can reset it.
        </p>
        {prfLine ? (
          <p className="hint" data-testid="webview-prf">
            {prfLine}
          </p>
        ) : null}
        <div className="stack-actions">
          <button type="button" className="primary" data-testid="welcome-create" onClick={onCreate}>
            Tresor anlegen / Create vault
          </button>
          <button type="button" data-testid="welcome-restore" onClick={onRestore}>
            Ich habe einen Tresor / I have a vault
          </button>
        </div>
      </div>
    </div>
  );
}
