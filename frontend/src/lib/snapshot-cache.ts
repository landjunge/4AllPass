/**
 * Last verified wire snapshot for a vault. Ciphertext only — never VK or
 * plaintext. The revision pin still gates what may be unlocked
 * (vault-revision.md §3). IndexedDB so a full snapshot fits; XSS on this
 * origin can read it the same way it can read a live GET.
 */
import type { WireVaultSnapshot } from "@4allpass/crypto";

export interface SnapshotCache {
  load(vaultId: string): Promise<WireVaultSnapshot | null>;
  save(vaultId: string, snapshot: WireVaultSnapshot): Promise<void>;
  remove(vaultId: string): Promise<void>;
}

export function memorySnapshotCache(
  initial: ReadonlyArray<readonly [string, WireVaultSnapshot]> = [],
): SnapshotCache {
  const records = new Map<string, WireVaultSnapshot>(initial);
  return {
    async load(vaultId) {
      return records.get(vaultId) ?? null;
    },
    async save(vaultId, snapshot) {
      if (snapshot.vaultId !== vaultId) {
        throw new Error("cached snapshot vaultId does not match key");
      }
      records.set(vaultId, snapshot);
    },
    async remove(vaultId) {
      records.delete(vaultId);
    },
  };
}

const DB_NAME = "4allpass-snapshot-cache";
const STORE_NAME = "wire";
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
  });
}

function transact<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = action(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB request failed"));
  });
}

export function indexedDbSnapshotCache(): SnapshotCache {
  return {
    async load(vaultId) {
      const db = await openDatabase();
      try {
        const value = await transact<WireVaultSnapshot | undefined>(db, "readonly", (store) =>
          store.get(vaultId) as IDBRequest<WireVaultSnapshot | undefined>,
        );
        if (!value || value.vaultId !== vaultId) return null;
        return value;
      } finally {
        db.close();
      }
    },
    async save(vaultId, snapshot) {
      if (snapshot.vaultId !== vaultId) {
        throw new Error("cached snapshot vaultId does not match key");
      }
      const db = await openDatabase();
      try {
        await transact(db, "readwrite", (store) => store.put(snapshot, vaultId));
      } finally {
        db.close();
      }
    },
    async remove(vaultId) {
      const db = await openDatabase();
      try {
        await transact(db, "readwrite", (store) => store.delete(vaultId));
      } finally {
        db.close();
      }
    },
  };
}

let override: SnapshotCache | null = null;
let memoryFallback = memorySnapshotCache();

export function setSnapshotCacheForTests(next: SnapshotCache | null): void {
  override = next;
  if (next === null) memoryFallback = memorySnapshotCache();
}

export function snapshotCache(): SnapshotCache {
  if (override) return override;
  if (typeof indexedDB === "undefined") return memoryFallback;
  return indexedDbSnapshotCache();
}

/** Network failed before an HTTP status existed. 4xx/5xx are not offline. */
export function isOfflineError(error: unknown): boolean {
  return error instanceof TypeError;
}
