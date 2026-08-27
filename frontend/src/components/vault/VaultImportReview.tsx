import type { ReactNode } from "react";
import { importReviewRows, plaintextImportWarning } from "../../lib/import.ts";
import { useCopy } from "../../state/copy-mode.tsx";
import type { ImportPending } from "../../types/vault.ts";

export function VaultImportReview({
  pending,
  busy,
  onToggle,
  onPickAll,
  onPickNone,
  onConfirm,
  onCancel,
}: {
  pending: ImportPending;
  busy: boolean;
  onToggle: (id: string) => void;
  onPickAll: () => void;
  onPickNone: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactNode {
  const { t } = useCopy();
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="import-review-title">
      <div className="card kit">
        <h2 id="import-review-title">
          {pending.source === "share"
            ? t({ de: "Geteilte Logins übernehmen", en: "Import shared logins" })
            : pending.source === "browser"
              ? t({
                  de: "Browser-Passwörter in den Tresor",
                  en: "Browser passwords into the vault",
                })
              : t({ de: "Klartextdatei übernehmen", en: "Import plaintext file" })}
        </h2>
        <p>
          {pending.source === "share"
            ? t({
                de: "Die Share-Datei ist auf diesem Gerät schon entschlüsselt. Bestätigen legt die Logins verschlüsselt in deinen Tresor. Der Server sieht nur Chiffretext.",
                en: "The share file is already decrypted on this device. Confirming encrypts the logins into your vault. The server only stores ciphertext.",
              })
            : pending.source === "browser"
              ? t({
                  de: "macOS hat den Zugriff erlaubt. Bestätigen legt die Logins verschlüsselt in deinen Tresor. Der Server sieht sie nicht.",
                  en: "macOS granted access. Confirm encrypts into your vault. The server never sees them.",
                })
              : plaintextImportWarning()}
        </p>
        <div className="import-review" data-testid="import-review">
          <p className="muted">
            {t({
              de: `${pending.picked.length} / ${pending.entries.length} gewählt. Keine Passwörter in dieser Liste.`,
              en: `${pending.picked.length} / ${pending.entries.length} selected. No passwords in this list.`,
            })}
          </p>
          <div className="actions">
            <button type="button" onClick={onPickAll} title={t({ de: "Alle Zeilen übernehmen", en: "Import every row" })}>
              {t({ de: "Alle", en: "All" })}
            </button>
            <button type="button" onClick={onPickNone} title={t({ de: "Auswahl leeren", en: "Clear selection" })}>
              {t({ de: "Keine", en: "None" })}
            </button>
          </div>
          <ul>
            {importReviewRows(pending.entries).map((row) => (
              <li key={row.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={pending.picked.includes(row.id)}
                    onChange={() => onToggle(row.id)}
                  />
                  <span>
                    <strong>{row.title || row.url}</strong>
                    <span className="muted">
                      {" "}
                      {row.username}
                      {row.provider ? ` · ${row.provider}${row.confidence >= 0.95 ? "" : " ?"}` : ""}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={busy || pending.picked.length === 0}
            data-testid="confirm-import"
            onClick={() => void onConfirm()}
            title={t({
              de: "Gewählte Einträge auf diesem Gerät verschlüsseln und speichern",
              en: "Encrypt the selected entries on this device and save",
            })}
          >
            {t({ de: "Verschlüsseln und übernehmen", en: "Encrypt and import" })}
          </button>
          <button type="button" disabled={busy} onClick={onCancel}>
            {t({ de: "Abbrechen", en: "Cancel" })}
          </button>
        </div>
      </div>
    </div>
  );
}
