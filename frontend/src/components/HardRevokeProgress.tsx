import type { ReactNode } from "react";
import { useCopy } from "../state/copy-mode.tsx";
import type { RevokeProgress } from "../modules/device-management/index.ts";

/** Remains visible after self-revocation locks the vault. Contains no key material. */
export function HardRevokeProgress({ progress, reconcile }: {
  progress: RevokeProgress;
  reconcile(): Promise<void>;
}): ReactNode {
  const { t } = useCopy();
  return <div className="banner notice" role="status" data-testid="hard-revoke-progress">
    <span>{t(progress.phase === "revoke_pending" ? {
      de: "Tresor-Schlüssel bereits gewechselt. Der Geräteentzug beim Dienst ist noch nicht bestätigt. Alte Kopien bleiben lesbar. Nur den Geräteentzug erneut prüfen.",
      en: "Vault key already rotated. Device revocation at the service is not confirmed yet. Old copies remain readable. Retry only the device revocation check.",
    } : {
      de: "Tresor-Schlüssel gewechselt und Geräteentzug beim Dienst bestätigt. Die Geräteliste konnte noch nicht aktualisiert werden. Alte Kopien bleiben lesbar.",
      en: "Vault key rotated and device revocation at the service confirmed. The device list has not been refreshed yet. Old copies remain readable.",
    })}</span>
    <button type="button" className="link" disabled={progress.busy}
      data-testid="reconcile-hard-revoke" onClick={() => void reconcile()}>
      {t({ de: "Geräteentzug prüfen", en: "Check device revocation" })}
    </button>
  </div>;
}
