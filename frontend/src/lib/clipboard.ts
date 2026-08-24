/**
 * OS clipboard is outside the lock state machine. We still treat a copy as a
 * secret we own: overwrite it after a short delay if it still matches, and
 * try again on lock. If we cannot read the clipboard, we do not clobber it.
 */
export const CLIPBOARD_CLEAR_MS = 30_000;

export interface SecretClipboard {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
}

export interface CopySecretOptions {
  clipboard?: SecretClipboard;
  clearAfterMs?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

const defaultClipboard = (): SecretClipboard => {
  const clip = globalThis.navigator?.clipboard;
  if (!clip) throw new Error("clipboard is not available");
  return clip;
};

let pending: unknown = null;
let lastCopied: string | null = null;
let cancelPending: ((handle: unknown) => void) | null = null;

async function overwriteIfOurs(clipboard: SecretClipboard): Promise<void> {
  const expected = lastCopied;
  if (expected === null) return;
  try {
    const current = await clipboard.readText();
    if (current === expected) await clipboard.writeText("");
  } catch {
    // No clipboard-read permission: leave whatever is there.
  }
}

/** One click, one read. Not a background watcher. */
export async function readClipboardText(
  clipboard?: SecretClipboard,
): Promise<string> {
  const clip = clipboard ?? defaultClipboard();
  return clip.readText();
}

export async function copySecret(text: string, options: CopySecretOptions = {}): Promise<void> {
  const clipboard = options.clipboard ?? defaultClipboard();
  const clearAfterMs = options.clearAfterMs ?? CLIPBOARD_CLEAR_MS;
  const schedule = options.schedule ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const cancel = options.cancel ?? ((handle) => globalThis.clearTimeout(handle as number));
  if (pending !== null && cancelPending) cancelPending(pending);
  await clipboard.writeText(text);
  lastCopied = text;
  cancelPending = cancel;
  pending = schedule(() => {
    pending = null;
    void overwriteIfOurs(clipboard).finally(() => {
      lastCopied = null;
    });
  }, clearAfterMs);
}

export async function clearCopiedSecret(clipboard?: SecretClipboard): Promise<void> {
  if (pending !== null && cancelPending) cancelPending(pending);
  pending = null;
  cancelPending = null;
  if (lastCopied === null) return;
  await overwriteIfOurs(clipboard ?? defaultClipboard());
  lastCopied = null;
}

/** Test-only: drop timer state without touching a clipboard. */
export function resetCopiedSecretForTests(): void {
  pending = null;
  lastCopied = null;
  cancelPending = null;
}
