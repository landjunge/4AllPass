import type { ReactNode } from "react";
import { shareWarning, type BuiltShare } from "../../lib/share.ts";
import { downloadShareFile } from "../../services/vault/share.ts";
import { useCopy } from "../../state/copy-mode.tsx";

export function VaultShareDialog({
  share,
  copied,
  shareKeyLabel,
  clipboardClearSeconds,
  onCopyKey,
  onDone,
}: {
  share: BuiltShare;
  copied: string | null;
  shareKeyLabel: string;
  clipboardClearSeconds: number;
  onCopyKey: () => void;
  onDone: () => void;
}): ReactNode {
  const { t } = useCopy();
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title">
      <div className="card kit">
        <h2 id="share-dialog-title">{t({ de: "Diesen Login teilen", en: "Share this login" })}</h2>
        <p>{shareWarning()}</p>
        <p className="muted small">{t({ de: "Share-Schlüssel", en: "Share key" })}</p>
        <code className="mono block key" data-testid="share-key">
          {share.shareKey}
        </code>
        <div className="device-actions">
          <button
            type="button"
            className="primary"
            data-testid="download-share"
            title={t({
              de: "Verschlüsselte Datei lokal speichern. Ohne Schlüssel unlesbar.",
              en: "Save the encrypted file locally. Unreadable without the key.",
            })}
            onClick={() => downloadShareFile(share)}
          >
            {t({ de: "Verschlüsselte Datei herunterladen", en: "Download encrypted file" })}
          </button>
          <button
            type="button"
            onClick={onCopyKey}
            title={t({
              de: "Schlüssel kopieren. Die Zwischenablage wird später überschrieben.",
              en: "Copy the key. The clipboard is overwritten later.",
            })}
          >
            {t({ de: "Share-Schlüssel kopieren", en: "Copy share key" })}
          </button>
        </div>
        {copied === shareKeyLabel ? (
          <p className="hint">
            {t({
              de: `Schlüssel kopiert. Die Zwischenablage wird in ${clipboardClearSeconds} Sekunden überschrieben, wenn sie ihn noch hält.`,
              en: `Key copied. The clipboard is overwritten in ${clipboardClearSeconds} seconds if it still holds this value.`,
            })}
          </p>
        ) : null}
        <button type="button" className="link" onClick={onDone}>
          {t({ de: "Fertig", en: "Done" })}
        </button>
      </div>
    </div>
  );
}
