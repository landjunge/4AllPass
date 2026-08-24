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
        setPrfLine("Passkey/PRF seems available in this window. Vault password still works.");
        return;
      }
      if (state === "unavailable") {
        setPrfLine(
          "Passkey/PRF ist in diesem Fenster nicht nutzbar. Unlock mit Tresor-Passwort. / Passkey/PRF is not available in this window. Unlock with the vault password.",
        );
        return;
      }
      setPrfLine(
        "Passkey/PRF in this window is unconfirmed. Unlock with the vault password until a ceremony succeeds.",
      );
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
          Recovery-Schlüssel — niemand kann ihn zurücksetzen.
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
