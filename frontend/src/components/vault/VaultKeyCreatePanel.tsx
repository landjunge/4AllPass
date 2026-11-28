import type { ReactNode } from "react";
import { useCopy } from "../../state/copy-mode.tsx";
import { KEY_CREATE_PROVIDERS, type KeyCreateProviderId } from "../../lib/provider-key-create.ts";
import type { KeyCreateCaptureApi } from "../../hooks/vault/useKeyCreateCapture.ts";
import { entryDisplayTitle } from "../../utils/vault/labels.ts";

/**
 * "Neuen Schlüssel erstellen" (issue #278): pick a provider, open its real
 * key-creation page in the external browser, then start a short, explicit
 * clipboard-capture window. Shown only while creating a *new* API entry
 * (`VaultEntryForm` mounts this only when `draft.kind === "api"` and no
 * entry is selected) — never for an existing entry, so there is never a
 * question of which entry a captured key would silently replace.
 */
export function VaultKeyCreatePanel({ capture }: { capture: KeyCreateCaptureApi }): ReactNode {
  const { t } = useCopy();
  const untitled = t({ de: "Ohne Titel", en: "Untitled" });
  return (
    <section className="card" data-testid="key-create-panel">
      <h4>{t({ de: "Neuen Schlüssel erstellen", en: "Create a new key" })}</h4>
      <p className="hint">
        {t({
          de: "Öffnet die offizielle Seite des Anbieters im externen Browser. Nach dem Kopieren beim Anbieter wird die Zwischenablage nur für die gewählte Zeit und nur für diesen einen Vorgang gelesen — kein dauerhaftes Mithören.",
          en: "Opens the provider's official page in the external browser. After copying it there, the clipboard is read only for the chosen window and only for this one operation — never a standing watcher.",
        })}
      </p>
      <label>
        {t({ de: "Anbieter", en: "Provider" })}
        <select
          value={capture.providerId}
          data-testid="key-create-provider"
          disabled={capture.capturing}
          onChange={(event) => capture.setProviderId(event.target.value as KeyCreateProviderId | "")}
        >
          <option value="">{t({ de: "Anbieter wählen", en: "Choose provider" })}</option>
          {KEY_CREATE_PROVIDERS.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button
          type="button"
          data-testid="key-create-open-page"
          disabled={!capture.providerId}
          onClick={() => void capture.openProviderPage()}
        >
          {t({ de: "Seite beim Anbieter öffnen", en: "Open the provider's page" })}
        </button>
        {capture.capturing ? (
          <button type="button" data-testid="key-create-cancel" onClick={capture.cancelCapture}>
            {t({
              de: `Erfassung abbrechen (${capture.remainingSeconds}s)`,
              en: `Cancel capture (${capture.remainingSeconds}s)`,
            })}
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            data-testid="key-create-start-capture"
            disabled={!capture.providerId}
            onClick={capture.startCapture}
          >
            {t({
              de: "Jetzt aus Zwischenablage übernehmen",
              en: "Take over from clipboard now",
            })}
          </button>
        )}
      </div>
      {capture.message ? (
        <p className="hint" data-testid="key-create-message">
          {t(capture.message)}
        </p>
      ) : null}
      {capture.duplicate ? (
        <div className="issue-pill" data-testid="key-create-duplicate">
          <p>
            {capture.duplicate.kind === "exact"
              ? t({
                  de: `Dieser Schlüssel ist schon unter „${entryDisplayTitle(capture.duplicate.entry, untitled)}“ gespeichert.`,
                  en: `This key is already saved under "${entryDisplayTitle(capture.duplicate.entry, untitled)}".`,
                })
              : t({
                  de: `„${entryDisplayTitle(capture.duplicate.entry, untitled)}“ nutzt schon dieses Konto bei diesem Anbieter.`,
                  en: `"${entryDisplayTitle(capture.duplicate.entry, untitled)}" already uses this account at this provider.`,
                })}
          </p>
          <div className="actions">
            <button type="button" data-testid="key-create-duplicate-anyway" onClick={capture.keepDuplicateAnyway}>
              {t({ de: "Trotzdem als neuen Eintrag übernehmen", en: "Take over as a new entry anyway" })}
            </button>
            <button type="button" data-testid="key-create-duplicate-dismiss" onClick={capture.dismissDuplicate}>
              {t({ de: "Verwerfen", en: "Discard" })}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
