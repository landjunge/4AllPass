import type { ReactNode } from "react";
import { useCopy } from "../../state/copy-mode.tsx";

export function VaultHeader({ count }: { count: number }): ReactNode {
  const { t } = useCopy();
  const countTip = t({
    de: "Anzahl der Einträge auf diesem Gerät. Der Server speichert nur Chiffretext.",
    en: "Number of entries on this device. The server only stores ciphertext.",
  });
  return (
    <header className="vault-hero">
      <h2>{t({ de: "Dein Tresor", en: "Your vault" })}</h2>
      <p className="muted">
        {t({ de: "Welchen Zugang suche ich?", en: "Which login am I looking for?" })}
      </p>
      <p className="muted" title={countTip}>
        <span className="entry-count" aria-label={countTip}>
          {t({
            de: `${count} Einträge · geschützt auf diesem Gerät`,
            en: `${count} entries · protected on this device`,
          })}
        </span>
      </p>
    </header>
  );
}
