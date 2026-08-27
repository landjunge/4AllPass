import type { ReactNode } from "react";
import { useCopy } from "../../state/copy-mode.tsx";
import type { VaultEntry } from "../../types/vault.ts";
import { HEALTH_MIN_ENTRIES, type EntryHealth, type HealthIssue } from "../../utils/vault/health.ts";
import { entryDisplayTitle } from "../../utils/vault/labels.ts";

export function VaultHeader({
  count,
  score,
  health,
  entries,
  onShowWeak,
}: {
  count: number;
  score: number | null;
  health: EntryHealth[];
  entries: VaultEntry[];
  onShowWeak: () => void;
}): ReactNode {
  const { t } = useCopy();
  const countTip = t({
    de: "Anzahl der Einträge auf diesem Gerät. Der Server speichert nur Chiffretext.",
    en: "Number of entries on this device. The server only stores ciphertext.",
  });
  const advice = firstAdvice(entries, health, t);
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
      {count >= HEALTH_MIN_ENTRIES && score !== null ? (
        <div className="health-score" title={t({ de: "Lokal gewichtet. HIBP nur k-anonym.", en: "Weighted locally. HIBP is k-anonymous only." })}>
          <p className="health-number">
            <strong>{score}</strong>
            <span> / 100</span>
          </p>
          {advice ? (
            <button type="button" className="link health-weak" onClick={onShowWeak}>
              {advice}
            </button>
          ) : (
            <p className="ok">{t({ de: "Keine bekannten Probleme in der Liste.", en: "No known issues in the list." })}</p>
          )}
        </div>
      ) : count > 0 ? (
        <p className="muted small">
          {t({
            de: `Health-Score ab ${HEALTH_MIN_ENTRIES} Einträgen.`,
            en: `Health score from ${HEALTH_MIN_ENTRIES} entries.`,
          })}
        </p>
      ) : null}
    </header>
  );
}

function firstAdvice(
  entries: VaultEntry[],
  health: EntryHealth[],
  t: ReturnType<typeof useCopy>["t"],
): string | null {
  const untitled = t({ de: "Ohne Titel", en: "Untitled" });
  const ranked = [...health].sort((a, b) => {
    const rank = (issues: HealthIssue[]) =>
      issues.includes("leaked") ? 3 : issues.includes("reused") ? 2 : issues.includes("weak") ? 1 : 0;
    return rank(b.issues) * b.weight - rank(a.issues) * a.weight;
  });
  const top = ranked.find((row) => row.issues.length > 0);
  if (!top) return null;
  const entry = entries.find((item) => item.id === top.id);
  const name = entry ? entryDisplayTitle(entry, untitled) : top.category;
  if (top.issues.includes("leaked") && top.category === "bank") {
    return t({
      de: `Dieses Bankpasswort wurde geleakt — ändere es (${name}).`,
      en: `This bank password was leaked — change it (${name}).`,
    });
  }
  if (top.issues.includes("leaked")) {
    return t({ de: `${name} wurde geleakt — ändern.`, en: `${name} was leaked — change it.` });
  }
  if (top.issues.includes("reused")) {
    return t({ de: `${name} ist zu ähnlich zu einem anderen Secret.`, en: `${name} is too similar to another secret.` });
  }
  return t({ de: `${name} ist schwach nach ZXCVBN.`, en: `${name} is weak by ZXCVBN.` });
}
