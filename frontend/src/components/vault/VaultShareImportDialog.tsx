import type { ReactNode } from "react";
import { useCopy } from "../../state/copy-mode.tsx";
import type { ShareImport } from "../../types/vault.ts";

export function VaultShareImportDialog({
  shareImport,
  onKeyChange,
  onOpen,
  onCancel,
}: {
  shareImport: ShareImport;
  onKeyChange: (key: string) => void;
  onOpen: () => void;
  onCancel: () => void;
}): ReactNode {
  const { t } = useCopy();
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="share-import-title">
      <div className="card kit">
        <h2 id="share-import-title">{t({ de: "Share-Datei öffnen", en: "Open share file" })}</h2>
        <p>
          {t({
            de: "Share-Schlüssel eingeben. Entschlüsseln bleibt auf diesem Gerät.",
            en: "Enter the share key. Decryption stays on this device.",
          })}
        </p>
        <label>
          {t({ de: "Share-Schlüssel", en: "Share key" })}
          <input
            value={shareImport.key}
            onChange={(event) => onKeyChange(event.target.value)}
            data-testid="share-import-key"
            autoComplete="off"
            placeholder={t({ de: "Schlüssel aus der Nachricht einfügen", en: "Paste the key from the message" })}
            title={t({
              de: "Ohne diesen Schlüssel bleibt die Datei unlesbar.",
              en: "Without this key the file stays unreadable.",
            })}
          />
        </label>
        <div className="actions">
          <button
            type="button"
            className="primary"
            data-testid="open-share"
            onClick={onOpen}
            disabled={!shareImport.key.trim()}
          >
            {t({ de: "Auf diesem Gerät entschlüsseln", en: "Decrypt on this device" })}
          </button>
          <button type="button" onClick={onCancel}>
            {t({ de: "Abbrechen", en: "Cancel" })}
          </button>
        </div>
      </div>
    </div>
  );
}
