/** Extension idle window. The desk no longer auto-locks. */

export const AUTO_LOCK_MS = 5 * 60 * 1000;
export const AUTO_LOCK_MINUTES = 5;

export interface IdleLock {
  touch(): void;
  stop(): void;
}

export function createIdleLock(
  onIdle: () => void,
  options: {
    ms?: number;
    schedule?: (fn: () => void, ms: number) => unknown;
    cancel?: (handle: unknown) => void;
  } = {},
): IdleLock {
  const ms = options.ms ?? AUTO_LOCK_MS;
  const schedule = options.schedule ?? ((fn, delay) => globalThis.setTimeout(fn, delay));
  const cancel = options.cancel ?? ((handle) => globalThis.clearTimeout(handle as number));
  let handle: unknown = null;
  return {
    touch() {
      if (handle !== null) cancel(handle);
      handle = schedule(() => {
        handle = null;
        onIdle();
      }, ms);
    },
    stop() {
      if (handle !== null) cancel(handle);
      handle = null;
    },
  };
}
