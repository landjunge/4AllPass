import { useState, type FormEvent, type ReactNode } from "react";
import { useApp } from "../../state/app-state.tsx";
import { useCopy } from "../../state/copy-mode.tsx";

export function PullLocalVaultBanner(): ReactNode {
  const { localStore, vaults, activeVaultId, lockState, pullLocalIntoOpenVault } = useApp();
  const { t } = useCopy();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const leftover = localStore?.hasLocalVault && (localStore.localEntries > 0 || Boolean(localStore.localVaultId));
  const otherVault = vaults.some((row) => row.vaultId !== activeVaultId);
  if (lockState !== "UNLOCKED" || (!leftover && !otherVault)) return null;

  const count = localStore?.localEntries ?? 0;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    try {
      await pullLocalIntoOpenVault(password);
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="banner notice" data-testid="pull-local-banner" onSubmit={(event) => void submit(event)}>
      <span>
        {t({
          de: `${count > 0 ? `${count} Einträge` : "Einträge"} auf diesem Mac gehören in diesen Tresor. Altes Tresor-Passwort einmal eingeben — nicht abmelden, Tresor bleibt offen.`,
          en: `${count > 0 ? `${count} entries` : "Entries"} on this Mac belong in this vault. Enter the old vault password once — do not sign out. This vault stays open.`,
        })}
      </span>
      <label className="sr-only" htmlFor="pull-local-password">
        {t({ de: "Altes Tresor-Passwort", en: "Old vault password" })}
      </label>
      <input
        id="pull-local-password"
        type="password"
        autoComplete="current-password"
        data-testid="pull-local-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
        minLength={1}
        placeholder={t({ de: "Altes Tresor-Passwort", en: "Old vault password" })}
      />
      <button type="submit" className="primary" disabled={busy || !password} data-testid="pull-local-submit">
        {busy
          ? t({ de: "Einen Moment…", en: "One moment…" })
          : t({ de: "Einträge übernehmen", en: "Pull entries in" })}
      </button>
    </form>
  );
}
