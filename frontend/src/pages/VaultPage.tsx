import type { ReactNode } from "react";
import { AccessBrokerHost } from "../components/AccessBrokerHost.tsx";
import { AccessPanel } from "../components/AccessPanel.tsx";
import { BrowserCards } from "../components/BrowserCards.tsx";
import { OnboardingWizard } from "../components/OnboardingWizard.tsx";
import {
  VaultDetailEmpty,
  VaultEntryForm,
  VaultHeader,
  VaultImportReview,
  VaultList,
  VaultSearchAndFilters,
  VaultSettings,
  VaultShareDialog,
  VaultShareImportDialog,
  VaultTabs,
} from "../components/vault/index.ts";
import { useVaultSearch, useVaultState } from "../hooks/vault/index.ts";

export function VaultPage(): ReactNode {
  const vault = useVaultState();
  const search = useVaultSearch(vault.entries);

  if (!vault.vault) return null;

  return (
    <div className="vault">
      <AccessBrokerHost entries={vault.entries} />
      <VaultTabs
        tab={vault.tab}
        revision={vault.vault.revision}
        vaultKeyVersion={vault.vault.vaultKeyVersion}
        onChange={vault.setTab}
      />

      {vault.tab === "settings" ? (
        <VaultSettings
          pane={vault.settingsPane}
          onPaneChange={vault.setSettingsPane}
          revision={vault.vault.revision}
          vaultKeyVersion={vault.vault.vaultKeyVersion}
        />
      ) : vault.tab === "access" ? (
        <AccessPanel entries={vault.entries} onSeedDemo={() => vault.seedAccessDemo()} />
      ) : (
        <>
          {vault.tab === "browser" || (vault.tab === "entries" && vault.onboarding) ? (
            vault.tab === "entries" && vault.onboarding ? (
              <OnboardingWizard
                vaultId={vault.vault.vaultId}
                onLogins={vault.ingestBrowserLogins}
                onEnsureDemoLogin={() => vault.ensureDemoLogin()}
                onDone={vault.finishOnboarding}
              />
            ) : (
              <section className="browser-area" data-testid="browser-area">
                <BrowserCards
                  vaultId={vault.vault.vaultId}
                  onLogins={vault.ingestBrowserLogins}
                  onEnsureDemoLogin={() => vault.ensureDemoLogin()}
                />
              </section>
            )
          ) : null}
          {vault.tab === "entries" && !vault.onboarding ? (
            <div className="columns vault-desk">
              <section className="card list">
                <VaultHeader
                  count={vault.entries.length}
                  weakCount={search.weakCount}
                  onShowWeak={() => search.setKind("weak")}
                />
                <VaultSearchAndFilters
                  query={search.query}
                  kind={search.kind}
                  onQueryChange={search.setQuery}
                  onKindChange={search.setKind}
                  onAdd={vault.startNew}
                  onImportFile={(file) => void vault.onImportFile(file)}
                />
                <VaultList
                  entries={vault.entries}
                  filtered={search.filtered}
                  selectedId={vault.selectedId}
                  query={search.query}
                  onSelect={vault.startEdit}
                  onAdd={() => vault.startNew("web")}
                />
              </section>
              <section className="card detail">
                {vault.draft ? (
                  <VaultEntryForm
                    draft={vault.draft}
                    selected={vault.selected}
                    selectedId={vault.selectedId}
                    busy={vault.busy}
                    showMore={vault.showMore}
                    revealPassword={vault.revealPassword}
                    copied={vault.copied}
                    paste={vault.paste}
                    detectedLabel={vault.detectedLabel}
                    customTemplate={vault.customTemplate}
                    clipboardClearSeconds={vault.clipboardClearSeconds}
                    onChange={vault.setDraft}
                    onShowMoreChange={vault.setShowMore}
                    onToggleReveal={() => vault.setRevealPassword((open) => !open)}
                    onCopyField={vault.copyField}
                    onPasteChange={vault.setPaste}
                    onDetectClipboard={vault.detectFromClipboard}
                    onDetectApply={() => vault.applyDetect(vault.paste)}
                    onCustomTemplateChange={vault.setCustomTemplate}
                    onApplyCustomTemplate={vault.applyCustomTemplate}
                    onApplyBuiltinTemplate={vault.applyBuiltinTemplate}
                    onSave={() => void vault.save()}
                    onCancel={() => vault.setDraft(null)}
                    onShare={vault.startShare}
                    onRemove={() => vault.selected && void vault.remove(vault.selected)}
                    onGeneratePassword={vault.generateDraftPassword}
                  />
                ) : (
                  <VaultDetailEmpty onAdd={vault.startNew} />
                )}
              </section>
            </div>
          ) : null}
        </>
      )}

      {vault.importPending ? (
        <VaultImportReview
          pending={vault.importPending}
          busy={vault.busy}
          onToggle={vault.toggleImportPick}
          onPickAll={vault.pickAllImport}
          onPickNone={vault.pickNoneImport}
          onConfirm={() => void vault.confirmImport()}
          onCancel={() => vault.setImportPending(null)}
        />
      ) : null}
      {vault.share ? (
        <VaultShareDialog
          share={vault.share}
          copied={vault.copied}
          shareKeyLabel={vault.t({ de: "Share-Schlüssel", en: "Share key" })}
          clipboardClearSeconds={vault.clipboardClearSeconds}
          onCopyKey={vault.copyShareKey}
          onDone={() => vault.setShare(null)}
        />
      ) : null}
      {vault.shareImport ? (
        <VaultShareImportDialog
          shareImport={vault.shareImport}
          onKeyChange={(key) => {
            const current = vault.shareImport;
            if (current) vault.setShareImport({ ...current, key });
          }}
          onOpen={vault.openShare}
          onCancel={() => vault.setShareImport(null)}
        />
      ) : null}
    </div>
  );
}
