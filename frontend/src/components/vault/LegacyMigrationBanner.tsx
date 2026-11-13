import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../../state/app-state.tsx";
import { useCopy } from "../../state/copy-mode.tsx";
import {
  isLegacyVault,
  LegacyMigrationError,
  type LegacyMigrationOutcome,
} from "../../lib/vault-session.ts";
import {
  MigrationAttemptUnavailableError,
  migrationAttemptBlocks,
  migrationAttemptStore,
} from "../../lib/migration-attempt.ts";
import { VaultLockedError } from "../../lib/vault-liveness.ts";
import { BLOCKED, LegacyMigrationBannerView } from "./LegacyMigrationBannerView.ts";

/**
 * Explicit, per-vault opt-in for migrating a pre-manifest vault. Never runs
 * automatically at unlock/install. Technical contract and the warning are in
 * docs/vault-revision.md; the durable attempt record blocks a reload retry.
 */
export function LegacyMigrationBanner(): ReactNode {
  const { vault, lockState, migrateLegacyVault } = useApp();
  const { t } = useCopy();
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [blockedState, setBlockedState] = useState(false);
  const [persistedBlocked, setPersistedBlocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Authoritative state lives in IndexedDB; a reload must keep UNKNOWN blocked.
  useEffect(() => {
    if (lockState !== "UNLOCKED" || !vault) {
      setPersistedBlocked(false);
      return;
    }
    let cancelled = false;
    const identity = {
      vaultId: vault.vaultId,
      revision: vault.revision,
      vaultKeyVersion: vault.vaultKeyVersion,
    };
    void migrationAttemptStore().load(identity.vaultId).then(
      (record) => {
        if (!cancelled) setPersistedBlocked(migrationAttemptBlocks(record, identity));
      },
      () => {
        // Fail closed: without a readable reservation, never offer a POST.
        if (!cancelled) setPersistedBlocked(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [lockState, vault?.vaultId, vault?.revision, vault?.vaultKeyVersion]);

  if (lockState !== "UNLOCKED" || !vault || dismissed) return null;
  const legacy = isLegacyVault(vault);
  const blocked = blockedState || persistedBlocked;
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
    if (outcome.status === "retry_blocked") return t(BLOCKED);
    if (outcome.status === "already") {
      return t({ de: "Der Tresor ist bereits aktuell.", en: "The vault is already up to date." });
    }
    return null;
  }

  function errorText(error: unknown): string {
    if (error instanceof VaultLockedError) {
      return t({ de: "Der Tresor wurde gesperrt. Bitte erneut öffnen.", en: "The vault was locked. Please open it again." });
    }
    if (error instanceof MigrationAttemptUnavailableError) {
      return t({
        de: "Die lokale Sperre konnte nicht sicher gesetzt werden. Es wurde nichts geändert.",
        en: "The local reservation could not be set safely. Nothing was changed.",
      });
    }
    if (error instanceof LegacyMigrationError) {
      if (error.code.startsWith("legacy_backup")) {
        return t({
          de: "Die lokale Sicherung konnte nicht bestätigt werden. Es wurde nichts geändert.",
          en: "The local backup could not be confirmed. Nothing was changed.",
        });
      }
      if (error.code === "legacy_wire_unsupported_metadata") {
        return t({
          de: "Der Tresor enthält Metadaten, die diese Version nicht verlustfrei übernehmen kann. Es wurde nichts geändert.",
          en: "The vault contains metadata this version cannot carry over losslessly. Nothing was changed.",
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
      if (outcome.status === "unknown" || outcome.status === "retry_blocked") setBlockedState(true);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <LegacyMigrationBannerView
      legacy={legacy}
      blocked={blocked}
      busy={busy}
      message={message}
      t={t}
      onMigrate={() => void migrate()}
      onLater={() => setDismissed(true)}
    />
  );
}
