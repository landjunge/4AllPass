import type { ReactNode } from "react";
import type { VaultEntry } from "../lib/entries.ts";
import { useCopy } from "../state/copy-mode.tsx";

/** The old practice UI could imply that a raw-secret Allow was safe. */
export function AccessPanel(_props: {
  entries: VaultEntry[];
  onSeedDemo?: () => Promise<void>;
}): ReactNode {
  const { t } = useCopy();
  return (
    <section className="card" data-testid="access-security-status" aria-labelledby="access-heading">
      <h3 id="access-heading">{t({ de: "Geschützter Programmzugriff", en: "Protected program access" })}</h3>
      <p role="status">{t({
        de: "Der Maschinenzugriff ist gesperrt: Es ist noch kein geschützter Nutzungsweg verbunden.",
        en: "Machine access is blocked: no protected execution path is connected yet.",
      })}</p>
      <p className="hint">{t({
        de: "Eine Freigabe darf Passwörter, API-Schlüssel oder Sitzungsgeheimnisse nicht an eine KI weitergeben. Der bisherige Rohmaterialweg wird deshalb auch nach Erlauben abgewiesen. Es gibt keinen Ersatzweg über n8n oder eine allgemeine Toolantwort.",
        en: "An approval must not disclose passwords, API keys or session secrets to an AI. The previous raw-material path is therefore denied even after Allow. There is no fallback through n8n or a general tool response.",
      })}</p>
      <p>{t({
        de: "Dein menschlicher Tresorzugriff, Import, Autofill und Wiederherstellung bleiben verfügbar. Frühere Schlüsselkopien oder Anbietersitzungen werden durch diese Sperre nicht zurückgerufen.",
        en: "Your human vault access, import, autofill and recovery remain available. This block does not recall previous key copies or provider sessions.",
      })}</p>
    </section>
  );
}
