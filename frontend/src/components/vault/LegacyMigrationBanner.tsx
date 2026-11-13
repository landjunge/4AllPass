import { useState, type ReactNode } from "react";
import { useApp } from "../../state/app-state.tsx";
import { useCopy } from "../../state/copy-mode.tsx";
import {
  isLegacyVault,
  LegacyMigrationError,
  type LegacyMigrationOutcome,
} from "../../lib/vault-session.ts";
import { VaultLockedError } from "../../lib/vault-liveness.ts";

/**
 * Explicit, per-vault opt-in for migrating a pre-manifest vault. Never runs
 * automatically at unlock/install. The technical contract and the "old server
 * state is not retroactively provable" warning are in docs/vault-revision.md.
 */
export function LegacyMigrationBanner(): ReactNode {
  const { vault, lockState, migrateLegacyVault } = useApp();
  const { t } = useCopy();
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (lockState !== "UNLOCKED" || !vault || dismissed) return null;
  const legacy = isLegacyVault(vault);
  if (!legacy && !message) return null;

  function outcomeText(outcome: LegacyMigrationOutcome): string | null {
    if (outcome.status === "migrated") {
      return t({ de: "Tresor aktualisiert. Der neue Stand ist versiegelt.", en: "Vault updated. The new state is sealed." });
    }
    if (outcome.status === "conflict") {
      return outcome.vault
        ? t({ de: "Ein anderes Gerät hat den Tresor geändert. Der neue Stand wurde geladen.", en: "Another device changed the vault. The new state was loaded." })
        : t({ de: "Der Tresor wurde inzwischen geändert. Bitte neu laden und erneut prüfen.", en: "The vault changed. Reload and check again." });
    }
    if (outcome.status === "unknown") {
      return t({
        de: "Der Ausgang ist unklar. Es wurde nichts weiter gesendet. Bitte später erneut prüfen.",
        en: "The outcome is unknown. Nothing further was sent. Please check again later.",
      });
    }
    if (outcome.status === "already") {
      return t({ de: "Der Tresor ist bereits aktuell.", en: "The vault is already up to date." });
    }
    return null;
  }

  function errorText(error: unknown): string {
    if (error instanceof VaultLockedError) {
      return t({ de: "Der Tresor wurde gesperrt. Bitte erneut öffnen.", en: "The vault was locked. Please open it again." });
    }
    if (error instanceof LegacyMigrationError) {
      if (error.code.startsWith("legacy_backup")) {
        return t({
          de: "Die lokale Sicherung konnte nicht bestätigt werden. Es wurde nichts geändert.",
          en: "The local backup could not be confirmed. Nothing was changed.",
        });
      }
      if (error.code === "legacy_migration_rejected") {
        return t({
          de: "Der Server hat die Aktualisierung abgelehnt. Der Tresor bleibt lesbar.",
          en: "The server rejected the update. The vault remains readable.",
        });
      }
      return t({
        de: "Der Tresorstand konnte nicht verlustfrei geprüft werden. Es wurde nichts geändert.",
        en: "The vault state could not be verified losslessly. Nothing was changed.",
      });
    }
    return t({ de: "Die Aktualisierung wurde nicht abgeschlossen. Der Tresor bleibt lesbar.", en: "The update did not complete. The vault remains readable." });
  }

  async function migrate(): Promise<void> {
    if (busy || blocked) return;
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await migrateLegacyVault();
      setMessage(outcomeText(outcome));
      if (outcome.status === "unknown") setBlocked(true);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="banner notice" data-testid="legacy-migration-banner" role="status">
      <span>
        {legacy
          ? t({
              de: "Dieser Tresor ist älter und noch nicht als Ganzes versiegelt. Beim Aktualisieren wird der aktuell geöffnete Inhalt für die Zukunft mit einer Integritätsprüfung versehen. Der bisherige Serverstand lässt sich nicht nachträglich beweisen. Eine verschlüsselte Sicherung wird vorher lokal abgelegt.",
              en: "This vault is older and not yet sealed as a whole. Updating seals the currently opened content with an integrity check for the future. The previous server state cannot be proven retroactively. An encrypted backup is stored locally first.",
            })
          : null}
        {message ? <span data-testid="legacy-migration-message"> {message}</span> : null}
      </span>
      {legacy ? (
        <button
          type="button"
          className="secondary"
          data-testid="legacy-migration-now"
          disabled={busy || blocked}
          onClick={() => void migrate()}
        >
          {busy
            ? t({ de: "Einen Moment…", en: "One moment…" })
            : t({ de: "Jetzt aktualisieren", en: "Update now" })}
        </button>
      ) : null}
      <button
        type="button"
        className="link"
        data-testid="legacy-migration-later"
        onClick={() => setDismissed(true)}
      >
        {t({ de: "Später", en: "Later" })}
      </button>
    </div>
  );
}
