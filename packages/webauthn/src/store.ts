/**
 * Local storage for the device unlock record.
 *
 * Rank 3 keeps a wrapping key here, which is explicitly a policy-only
 * protection (webauthn-prf.md §5): anything that can run in this origin after
 * a successful UV can read it. The server never receives this record — the
 * only part it may mirror is the opaque PRF Device-Key Envelope.
 */
import type { DeviceUnlockRecord, DeviceUnlockStore } from "./types.ts";

function key(vaultId: string, deviceId: string): string {
  return `${vaultId}\u0000${deviceId}`;
}

export function memoryDeviceUnlockStore(
  initial: readonly DeviceUnlockRecord[] = [],
): DeviceUnlockStore {
  const records = new Map<string, DeviceUnlockRecord>();
  for (const record of initial) {
    records.set(key(record.vaultId, record.deviceId), record);
  }
  return {
    async load(vaultId, deviceId) {
      return records.get(key(vaultId, deviceId)) ?? null;
    },
    async save(record) {
      records.set(key(record.vaultId, record.deviceId), record);
    },
    async remove(vaultId, deviceId) {
      records.delete(key(vaultId, deviceId));
    },
  };
}

const DB_NAME = "4allpass";
const STORE_NAME = "device-unlock";
const DB_VERSION = 1;

function openDatabase(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);
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

export function indexedDbDeviceUnlockStore(dbName: string = DB_NAME): DeviceUnlockStore {
  return {
    async load(vaultId, deviceId) {
      const db = await openDatabase(dbName);
      try {
        const value = await transact<DeviceUnlockRecord | undefined>(db, "readonly", (store) =>
          store.get(key(vaultId, deviceId)) as IDBRequest<DeviceUnlockRecord | undefined>,
        );
        return value ?? null;
      } finally {
        db.close();
      }
    },
    async save(record) {
      const db = await openDatabase(dbName);
      try {
        await transact(db, "readwrite", (store) =>
          store.put(record, key(record.vaultId, record.deviceId)),
        );
      } finally {
        db.close();
      }
    },
    async remove(vaultId, deviceId) {
      const db = await openDatabase(dbName);
      try {
        await transact(db, "readwrite", (store) => store.delete(key(vaultId, deviceId)));
      } finally {
        db.close();
      }
    },
  };
}
