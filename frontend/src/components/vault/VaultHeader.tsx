import type { ReactNode } from "react";
import { useCopy } from "../../state/copy-mode.tsx";

export function VaultHeader({
  count,
  weakCount,
  onShowWeak,
}: {
  count: number;
  weakCount: number;
  onShowWeak: () => void;
}): ReactNode {
  const { t } = useCopy();
  const countTip = t({
    de: "Anzahl der Einträge auf diesem Gerät. Der Server speichert nur Chiffretext.",
    en: "Number of entries on this device. The server only stores ciphertext.",
  });
  const healthTip = t({
    de: "Nur Länge und Zeichenklassen auf diesem Gerät. Kein Server-Score.",
    en: "Length and character classes on this device only. Not a server score.",
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
      {count > 0 ? (
        <p className="vault-health" title={healthTip}>
          {weakCount > 0 ? (
            <button type="button" className="link health-weak" onClick={onShowWeak}>
              {t({
                de: `${weakCount} kurze Passwörter — anzeigen`,
                en: `${weakCount} short passwords — show`,
              })}
            </button>
          ) : (
            <span className="ok">
              {t({
                de: "Keine kurzen Passwörter in der Liste.",
                en: "No short passwords in the list.",
              })}
            </span>
          )}
        </p>
      ) : null}
    </header>
  );
}
