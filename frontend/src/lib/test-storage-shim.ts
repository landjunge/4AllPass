/** Must be imported before `./api.ts` so module init can read sessionStorage. */
const memory = new Map<string, string>();

function storage(): Storage {
  return {
    get length() {
      return memory.size;
    },
    clear() {
      memory.clear();
    },
    getItem(key: string) {
      return memory.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      memory.set(key, String(value));
    },
    removeItem(key: string) {
      memory.delete(key);
    },
    key(index: number) {
      return [...memory.keys()][index] ?? null;
    },
  };
}

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage(),
});

Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: storage(),
});

export function clearTestStorage(): void {
  memory.clear();
}
