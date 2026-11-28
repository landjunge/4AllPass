import { useEffect, type ReactNode } from "react";
import type { Line } from "../../lib/copy-mode.ts";
import { useCopy } from "../../state/copy-mode.tsx";
import { keyCreateProviderName } from "../../lib/provider-key-create.ts";
import { rotatableProviderFor } from "../../lib/key-rotation.ts";
import type { KeyCreateCaptureApi } from "../../hooks/vault/useKeyCreateCapture.ts";
import type { VaultEntry } from "../../types/vault.ts";
import { entryDisplayTitle } from "../../utils/vault/labels.ts";

/**
 * "Schlüsselrotation" (issue #279 Punkt 5): accompany renewing/exchanging an
 * existing API key at its provider — never an automated rotation API (the
 * issue defers that explicitly: "unterstützte Rotations-APIs später
 * anbinden"). Reuses the #278 clipboard-capture flow (`capture`, the same
 * `KeyCreateCaptureApi`) unchanged, just pointed at *this* entry's own
 * provider instead of a provider picker, and the captured value lands back
 * on the open draft (not a new entry). Nothing here saves anything — the
 * existing Save button does that, which both updates this entry in place
 * and writes a new vault revision, so the pre-rotation key stays reachable
 * under "Frühere Stände" without any separate history code.
 *
 * Shown only while editing an *existing* API entry (`VaultEntryForm` mounts
 * this only when `selectedId` is set and `draft.kind === "api"`) — the
 * create flow's own panel stays the only place a brand-new entry gets made.
 */
export function VaultKeyRotatePanel({
  entry,
  draftProvider,
  capture,
  notice,
}: {
  entry: VaultEntry;
  /** The *open draft's* current provider text — may already differ from
   * `entry.provider` while the user is mid-edit (e.g. switched the Provider
   * field or applied a different provider template) before ever saving. */
  draftProvider: string;
  capture: KeyCreateCaptureApi;
  /** Issue #279 Punkt 5: set when the just-captured value turned out to be
   * byte-for-byte identical to the entry's current key — never blocks
   * anything, just an honest heads-up next to the capture's own message. */
  notice: Line | null;
}): ReactNode {
  const { t } = useCopy();
  const untitled = t({ de: "Ohne Titel", en: "Untitled" });
  // Rotation renews *this entry's saved key* — if the still-unsaved draft's
  // provider no longer matches it, the capture callback would merge a
  // credential for the old provider into a draft now describing a different
  // one (#279 review finding). Disable the whole flow rather than only the
  // capture button, so there is never a question of which provider a
  // running capture belongs to.
  const providerMismatch = draftProvider !== entry.provider;
  const providerId = providerMismatch ? null : rotatableProviderFor(entry.provider);

  // Always locked to this entry's own provider — never a free picker like
  // the create flow's, because rotation is not "which provider" but "renew
  // the one this entry already has". Re-synced whenever the entry (or its
  // provider text) changes, e.g. switching which entry is open, or the draft
  // provider diverging from the saved entry's.
  useEffect(() => {
    capture.setProviderId(providerId ?? "");
    // Only the identity of what should be selected matters here, not the
    // capture object's own identity (a new instance every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, providerId]);

  // Belt-and-suspenders: `setProviderId("")` above already ends a running
  // capture via its own provider-change handling, but that depends on
  // `providerId` changing identity, not on `capturing` being read here. Stop
  // explicitly too, so a mismatch is never silently left running.
  useEffect(() => {
    if (providerMismatch && capture.capturing) capture.cancelCapture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerMismatch]);

  if (providerMismatch) {
    return (
      <section className="card" data-testid="key-rotate-panel">
        <h4>{t({ de: "Schlüsselrotation", en: "Key rotation" })}</h4>
        <p className="muted" data-testid="key-rotate-provider-mismatch">
          {t({
            de: "Anbieter wurde geändert und noch nicht gespeichert. Erst speichern oder den ursprünglichen Anbieter wiederherstellen, dann ist die Rotation wieder verfügbar.",
            en: "Provider was changed and not saved yet. Save first, or restore the original provider, to use rotation again.",
          })}
        </p>
      </section>
    );
  }

  return (
    <section className="card" data-testid="key-rotate-panel">
      <h4>{t({ de: "Schlüsselrotation", en: "Key rotation" })}</h4>
      <p className="hint">
        {t({
          de: "Begleitet den Austausch beim Anbieter — 4AllPass ruft dafür keine Rotations-API auf und tauscht nichts automatisch aus. Nach der Übernahme unten bleibt der jetzige Wert erhalten, bis du speicherst; danach ist der alte Schlüssel weiterhin unter Einstellungen → Sicherheit → Frühere Stände abrufbar.",
          en: "Accompanies the exchange at the provider — 4AllPass calls no rotation API for this and swaps nothing automatically. After taking over below, the current value stays until you save; afterwards the old key stays reachable under Settings → Security → Earlier states.",
        })}
      </p>
      {providerId ? (
        <>
          <p className="muted small">
            {t({
              de: `Anbieter: ${keyCreateProviderName(providerId)} (aus dem Eintrag „${entryDisplayTitle(entry, untitled)}“).`,
              en: `Provider: ${keyCreateProviderName(providerId)} (from "${entryDisplayTitle(entry, untitled)}").`,
            })}
          </p>
          <div className="actions">
            <button type="button" data-testid="key-rotate-open-page" onClick={() => void capture.openProviderPage()}>
              {t({ de: "Seite beim Anbieter öffnen", en: "Open the provider's page" })}
            </button>
            {capture.capturing ? (
              <button type="button" data-testid="key-rotate-cancel" onClick={capture.cancelCapture}>
                {t({
                  de: `Erfassung abbrechen (${capture.remainingSeconds}s)`,
                  en: `Cancel capture (${capture.remainingSeconds}s)`,
                })}
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                data-testid="key-rotate-start-capture"
                onClick={capture.startCapture}
              >
                {t({ de: "Neuen Schlüssel aus Zwischenablage übernehmen", en: "Take over new key from clipboard" })}
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="muted" data-testid="key-rotate-manual">
          {t({
            de: `Für „${entry.provider || t({ de: "diesen Anbieter", en: "this provider" })}“ gibt es keine automatische Seiten-Verknüpfung. Beim Anbieter anmelden, dort einen neuen Schlüssel erzeugen und ihn dann oben im Feld „API-Key / Token“ einfügen — danach wie gewohnt speichern.`,
            en: `There is no automatic page link for "${entry.provider || t({ de: "diesen Anbieter", en: "this provider" })}". Sign in at the provider, create a new key there, then paste it into the "API key / token" field above — and save as usual.`,
          })}
        </p>
      )}
      {capture.message ? (
        <p className="hint" data-testid="key-rotate-message">
          {t(capture.message)}
        </p>
      ) : null}
      {notice ? (
        <p className="notice" data-testid="key-rotate-unchanged">
          {t(notice)}
        </p>
      ) : null}
      {capture.duplicate ? (
        <div className="issue-pill" data-testid="key-rotate-duplicate">
          <p>
            {capture.duplicate.kind === "exact"
              ? t({
                  de: `Dieser Schlüssel ist schon unter „${entryDisplayTitle(capture.duplicate.entry, untitled)}“ gespeichert. Wurde wirklich ein neuer Schlüssel beim Anbieter erzeugt?`,
                  en: `This key is already saved under "${entryDisplayTitle(capture.duplicate.entry, untitled)}". Was a new key actually created at the provider?`,
                })
              : t({
                  de: `„${entryDisplayTitle(capture.duplicate.entry, untitled)}“ nutzt schon dieses Konto bei diesem Anbieter.`,
                  en: `"${entryDisplayTitle(capture.duplicate.entry, untitled)}" already uses this account at this provider.`,
                })}
          </p>
          <div className="actions">
            <button type="button" data-testid="key-rotate-duplicate-anyway" onClick={capture.keepDuplicateAnyway}>
              {t({ de: "Trotzdem für diesen Eintrag übernehmen", en: "Take over for this entry anyway" })}
            </button>
            <button type="button" data-testid="key-rotate-duplicate-dismiss" onClick={capture.dismissDuplicate}>
              {t({ de: "Verwerfen", en: "Discard" })}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
