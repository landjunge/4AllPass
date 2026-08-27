import type { ReactNode } from "react";
import { useCopy } from "../../state/copy-mode.tsx";
import type { VaultTab } from "../../types/vault.ts";

const TABS: Array<{ id: VaultTab; testId: string; label: { de: string; en: string } }> = [
  { id: "entries", testId: "tab-entries", label: { de: "Tresor", en: "Vault" } },
  { id: "browser", testId: "tab-browser", label: { de: "Browser", en: "Browser" } },
  { id: "access", testId: "tab-access", label: { de: "Zugriff", en: "Access" } },
  { id: "settings", testId: "tab-settings", label: { de: "Einstellungen", en: "Settings" } },
];

export function VaultTabs({
  tab,
  revision,
  vaultKeyVersion,
  onChange,
}: {
  tab: VaultTab;
  revision: number;
  vaultKeyVersion: number;
  onChange: (tab: VaultTab) => void;
}): ReactNode {
  const { t } = useCopy();
  return (
    <nav className="tabs" aria-label={t({ de: "Hauptbereiche", en: "Main" })}>
      {TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={tab === item.id ? "active" : ""}
          onClick={() => onChange(item.id)}
          data-testid={item.testId}
          title={t(item.label)}
        >
          {t(item.label)}
        </button>
      ))}
      <span className="sr-only" data-testid="revision">
        revision {revision} · vault key v{vaultKeyVersion}
      </span>
    </nav>
  );
}
