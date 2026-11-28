import type { ReactNode } from "react";
import { useCopy } from "../../state/copy-mode.tsx";
import type { LeakCheckStatus } from "../../hooks/vault/useVaultHealth.ts";
import type { EntryHealth } from "../../utils/vault/health.ts";
import { findExactPasswordReuseGroups } from "../../utils/vault/password-reuse.ts";
import { entryDisplayTitle } from "../../utils/vault/labels.ts";
import type { VaultEntry } from "../../types/vault.ts";

/**
 * Sicherheitsprüfung (issue #279 #8): one place that collects findings this
 * vault already detects client-side — identical passwords reused across
 * different services, and passwords HaveIBeenPwned's k-anonymous range check
 * flagged as leaked — and offers a concrete, one-click action ("edit now")
 * for each one instead of a read-only list.
 *
 * Deliberately does not duplicate what already exists:
 * - the exact-match reuse grouping below is new (health.ts's `reused` flag
 *   is a fuzzy, per-entry similarity signal feeding the health score, not a
 *   list of which entries share a secret);
 * - "leaked" comes straight from `health` (already computed by
 *   `useVaultHealth` via the existing HIBP range lookup — no new network call);
 * - API-key scope information (GitHub's `X-OAuth-Scopes`) is already shown,
 *   purely informationally, in the "API-Schlüssel prüfen" panel below this
 *   one. 4AllPass cannot know what scopes a key *should* have, so this panel
 *   does not repeat or score that — it only points at it, honestly.
 */
export function VaultSecurityReviewPanel({
  entries,
  health,
  leakCheckStatus,
  onEdit,
}: {
  entries: VaultEntry[];
  health: EntryHealth[];
  leakCheckStatus: LeakCheckStatus;
  onEdit: (entry: VaultEntry) => void;
}): ReactNode {
  const { t } = useCopy();
  const untitled = t({ de: "Ohne Titel", en: "Untitled" });
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  const reuseGroups = findExactPasswordReuseGroups(entries);
  const leakedIds = new Set(health.filter((row) => row.issues.includes("leaked")).map((row) => row.id));
  const leakedEntries = entries.filter((entry) => leakedIds.has(entry.id));
  const apiEntryCount = entries.filter((entry) => entry.kind === "api").length;

  const hasFindings = reuseGroups.length > 0 || leakedEntries.length > 0;

  return (
    <section className="card" data-testid="settings-security-review">
      <h3>{t({ de: "Sicherheitsprüfung", en: "Security review" })}</h3>
      <p className="hint">
        {t({
          de: "Prüft nur, was bereits entschlüsselt im Speicher dieses Geräts liegt. Kein Passwort-Wert wird hier angezeigt oder verschickt — außer dem bereits bestehenden k-anonymen HIBP-Abgleich oben im Health-Score.",
          en: "Only checks what is already decrypted in this device's memory. No password value is shown or sent here — except the existing k-anonymous HIBP lookup already behind the health score.",
        })}
      </p>

      {leakCheckStatus === "unavailable" ? (
        <p className="hint" data-testid="security-review-leak-check-unavailable">
          {t({
            de: "Leak-Abgleich (HIBP) war in diesem Durchlauf nicht erreichbar — nicht geprüft, nicht als unauffällig zu werten.",
            en: "The leak check (HIBP) could not be reached this pass — not checked, not to be read as clean.",
          })}
        </p>
      ) : leakCheckStatus === "checking" ? (
        <p className="hint" data-testid="security-review-leak-check-pending">
          {t({ de: "Leak-Abgleich läuft noch …", en: "Leak check still running …" })}
        </p>
      ) : null}

      {!hasFindings && leakCheckStatus === "complete" ? (
        <p className="ok" data-testid="security-review-empty">
          {t({
            de: "Keine Doppelverwendung und keine bekannten Leaks gefunden.",
            en: "No reused passwords and no known leaks found.",
          })}
        </p>
      ) : null}
      {!hasFindings && leakCheckStatus !== "complete" ? (
        <p className="hint" data-testid="security-review-reuse-only-clean">
          {t({
            de: "Keine Doppelverwendung gefunden (Leak-Status siehe oben).",
            en: "No reused passwords found (see leak status above).",
          })}
        </p>
      ) : null}

      {reuseGroups.length > 0 ? (
        <div>
          <h4>{t({ de: "Doppelverwendung", en: "Reused passwords" })}</h4>
          <p className="hint">
            {t({
              de: "Diese Einträge verwenden exakt dasselbe Passwort bei unterschiedlichen Diensten. Ein Leak bei einem Dienst gefährdet dann auch die anderen.",
              en: "These entries use the exact same password on different services. A leak at one service then also endangers the others.",
            })}
          </p>
          <ul className="cleanup-list" data-testid="security-review-reused">
            {reuseGroups.map((group, index) => (
              <li key={group.entryIds.join(",")} data-testid={`security-review-reused-${index}`}>
                <span className="muted">
                  {t({ de: "Gleiches Passwort bei:", en: "Same password at:" })}
                </span>
                {group.entryIds.map((entryId, memberIndex) => {
                  const entry = byId.get(entryId);
                  const title = group.titles[memberIndex] || (entry ? entryDisplayTitle(entry, untitled) : untitled);
                  return (
                    <div key={entryId} className="field-actions">
                      <strong>{title}</strong>
                      {entry ? (
                        <button
                          type="button"
                          className="link"
                          data-testid={`security-review-edit-${entryId}`}
                          onClick={() => onEdit(entry)}
                        >
                          {t({ de: "Jetzt bearbeiten", en: "Edit now" })}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {leakedEntries.length > 0 ? (
        <div>
          <h4>{t({ de: "Mögliche Offenlegung", en: "Possible exposure" })}</h4>
          <p className="hint">
            {t({
              de: "Diese Passwörter wurden in bekannten Datenlecks gefunden (k-anonymer HIBP-Abgleich).",
              en: "These passwords were found in known data breaches (k-anonymous HIBP lookup).",
            })}
          </p>
          <ul className="cleanup-list" data-testid="security-review-leaked">
            {leakedEntries.map((entry) => (
              <li key={entry.id} data-testid={`security-review-leaked-${entry.id}`}>
                <span className="issue-pill leaked">{t({ de: "geleakt", en: "leaked" })}</span>{" "}
                <strong>{entryDisplayTitle(entry, untitled)}</strong>
                <div className="field-actions">
                  <button
                    type="button"
                    className="link"
                    data-testid={`security-review-edit-${entry.id}`}
                    onClick={() => onEdit(entry)}
                  >
                    {t({ de: "Jetzt bearbeiten", en: "Edit now" })}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h4>{t({ de: "Unnötige Rechte", en: "Unnecessary permissions" })}</h4>
        <p className="hint">
          {t({
            de: apiEntryCount > 0
              ? "4AllPass kann automatisch nicht wissen, welche Rechte ein API-Key tatsächlich braucht — das wäre eine vorgetäuschte Bewertung. Was ehrlich möglich ist: „API-Schlüssel prüfen“ unten zeigt bei GitHub-Keys den vom Anbieter gemeldeten Scope an (aus dem X-OAuth-Scopes-Header), rein informativ und ungewertet."
              : "4AllPass kann automatisch nicht wissen, welche Rechte ein API-Key tatsächlich braucht — das wäre eine vorgetäuschte Bewertung. Bei GitHub-Keys zeigt „API-Schlüssel prüfen“ unten den vom Anbieter gemeldeten Scope rein informativ an, sobald ein API-Key-Eintrag angelegt ist.",
            en: apiEntryCount > 0
              ? "4AllPass cannot automatically know what permissions an API key actually needs — claiming otherwise would be a faked judgement. What is honestly possible: \"Check API keys\" below shows GitHub keys' provider-reported scope (from the X-OAuth-Scopes header), purely informational and unscored."
              : "4AllPass cannot automatically know what permissions an API key actually needs — claiming otherwise would be a faked judgement. For GitHub keys, \"Check API keys\" below shows the provider-reported scope purely informationally, once an API key entry exists.",
          })}
        </p>
      </div>
    </section>
  );
}
