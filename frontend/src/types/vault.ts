/**
 * Vault page types. Domain entry schema stays in lib/entries.ts — that is the
 * plaintext shape sealed by packages/crypto. This file is UI and orchestration.
 */
import type { Line } from "../lib/copy-mode.ts";
import type { EntryDraft, EntryKind, VaultEntry } from "../lib/entries.ts";
import type { BuiltShare } from "../lib/share.ts";

export type { BuiltShare, EntryDraft, EntryKind, VaultEntry };

export type Translate = (plain: Line, expert?: Line) => string;

export type VaultTab = "entries" | "browser" | "access" | "settings";
export type VaultListFilter = "all" | EntryKind | "weak";
export type SettingsPane = "general" | "devices" | "security";
export type ImportSource = "plaintext" | "share" | "browser";

export interface ImportPending {
  count: number;
  entries: VaultEntry[];
  source: ImportSource;
  picked: string[];
}

export interface ShareImport {
  text: string;
  key: string;
}

export interface VaultCopyFeedback {
  label: string;
}
