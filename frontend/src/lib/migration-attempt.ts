/**
 * Durable, atomic metadata for one explicit legacy-manifest migration attempt.
 *
 * No keys, plaintext or server truth: only the vault identity, base revision,
 * prepared sealed-manifest digest, operation id and a local state. The record is
 * claimed *before* the backup await, so two independent tabs/modules cannot both
 * pass the empty-state check and later overwrite each other's receipt.
 *
 * The production store is IndexedDB: read-check-write happens inside one
 * readwrite transaction, which the browser serializes per origin. There is
 * deliberately no localStorage fallback; when IndexedDB is unavailable the
 * migration fails closed before any POST.
 */
export type MigrationAttemptState =
  | "reserved"
  | "prepared"
  | "unknown"
  | "resolved"
  | "rejected";

export interface MigrationAttempt {
  schema: 1;
  vaultId: string;
  vaultKeyVersion: number;
  baseRevision: number;
  operationID: string;
  /** Empty while `reserved`; set by `onPrepared` immediately before the POST. */
  preparedManifestDigest: string;
  state: MigrationAttemptState;
  createdAt: string;
}

export interface MigrationAttemptStore {
  load(vaultId: string): Promise<MigrationAttempt | null>;
  /**
   * Atomically claim the slot. Returns the existing blocking record instead of
   * writing when another live attempt owns the same vault/keyVersion/revision.
   */
  claim(next: MigrationAttempt): Promise<
    { ok: true } | { ok: false; existing: MigrationAttempt }
  >;
  /**
   * Owner-checked update: only the operation that owns the current record may
   * change it. Returns false instead of clobbering a foreign receipt.
   */
  transition(next: MigrationAttempt): Promise<boolean>;
}

export class MigrationAttemptUnavailableError extends Error {
  constructor(message = "legacy migration reservation storage unavailable") {
    super(message);
    this.name = "MigrationAttemptUnavailableError";
  }
}

const BLOCKING: readonly MigrationAttemptState[] = ["reserved", "prepared", "unknown"];

export function newOperationId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") return webCrypto.randomUUID();
  return `mig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function isMigrationAttempt(value: unknown): value is MigrationAttempt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const attempt = value as Partial<MigrationAttempt>;
  return (
    attempt.schema === 1 &&
    typeof attempt.vaultId === "string" &&
    typeof attempt.vaultKeyVersion === "number" &&
    typeof attempt.baseRevision === "number" &&
    typeof attempt.operationID === "string" &&
    typeof attempt.preparedManifestDigest === "string" &&
    typeof attempt.state === "string" &&
    ["reserved", "prepared", "unknown", "resolved", "rejected"].includes(attempt.state) &&
    typeof attempt.createdAt === "string"
  );
}

export function migrationAttemptBlocks(
  attempt: MigrationAttempt | null,
  vault: { vaultId: string; revision: number; vaultKeyVersion: number },
): boolean {
  return Boolean(
    attempt &&
      BLOCKING.includes(attempt.state) &&
      attempt.vaultId === vault.vaultId &&
      attempt.baseRevision === vault.revision &&
      attempt.vaultKeyVersion === vault.vaultKeyVersion,
  );
}

/** In-memory CAS for unit tests; two instances over one Map share the slot. */
export function memoryMigrationAttemptStore(
  records: Map<string, MigrationAttempt> = new Map(),
): MigrationAttemptStore {
  return {
    async load(vaultId) {
      const value = records.get(vaultId);
      return value ? { ...value } : null;
    },
    async claim(next) {
      const existing = records.get(next.vaultId);
      if (
        existing &&
        migrationAttemptBlocks(existing, {
          vaultId: next.vaultId,
          revision: next.baseRevision,
          vaultKeyVersion: next.vaultKeyVersion,
        })
      ) {
        return { ok: false, existing: { ...existing } };
      }
      records.set(next.vaultId, { ...next });
      return { ok: true };
    },
    async transition(next) {
      const existing = records.get(next.vaultId);
      if (!existing || existing.operationID !== next.operationID) return false;
      records.set(next.vaultId, { ...next });
      return true;
    },
  };
}

/** Fails closed instead of falling back to a non-atomic store. */
const unavailableStore: MigrationAttemptStore = {
  async load() {
    throw new MigrationAttemptUnavailableError();
  },
  async claim() {
    throw new MigrationAttemptUnavailableError();
  },
  async transition() {
    throw new MigrationAttemptUnavailableError();
  },
};

const DB_NAME = "4allpass-legacy-migration";
const STORE_NAME = "attempts";
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
    request.onblocked = () => reject(new Error("indexedDB upgrade blocked"));
  });
}

export function indexedDbMigrationAttemptStore(): MigrationAttemptStore {
  async function run<T>(
    mode: IDBTransactionMode,
    vaultId: string,
    decide: (store: IDBObjectStore, existing: MigrationAttempt | null) => T,
  ): Promise<T> {
    const db = await openDatabase();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const get = store.get(vaultId);
        let value: T;
        get.onsuccess = () => {
          const raw = get.result as unknown;
          const existing = isMigrationAttempt(raw) ? raw : null;
          try {
            value = decide(store, existing);
          } catch (error) {
            tx.abort();
            reject(error);
          }
        };
        get.onerror = () => reject(get.error ?? new Error("migration reservation read failed"));
        tx.oncomplete = () => resolve(value);
        tx.onabort = () => reject(tx.error ?? new Error("migration reservation aborted"));
        tx.onerror = () => reject(tx.error ?? new Error("migration reservation failed"));
      });
    } finally {
      db.close();
    }
  }

  return {
    async load(vaultId) {
      const db = await openDatabase();
      try {
        return await new Promise<MigrationAttempt | null>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const get = tx.objectStore(STORE_NAME).get(vaultId);
          get.onsuccess = () => {
            const raw = get.result as unknown;
            resolve(isMigrationAttempt(raw) ? raw : null);
          };
          get.onerror = () => reject(get.error ?? new Error("migration reservation read failed"));
          tx.onabort = () => reject(tx.error ?? new Error("migration reservation aborted"));
        });
      } finally {
        db.close();
      }
    },
    async claim(next) {
      return run("readwrite", next.vaultId, (store, existing) => {
        if (
          existing &&
          migrationAttemptBlocks(existing, {
            vaultId: next.vaultId,
            revision: next.baseRevision,
            vaultKeyVersion: next.vaultKeyVersion,
          })
        ) {
          return { ok: false as const, existing };
        }
        store.put({ ...next }, next.vaultId);
        return { ok: true as const };
      });
    },
    async transition(next) {
      return run("readwrite", next.vaultId, (store, existing) => {
        if (!existing || existing.operationID !== next.operationID) return false;
        store.put({ ...next }, next.vaultId);
        return true;
      });
    },
  };
}

let override: MigrationAttemptStore | null = null;

export function setMigrationAttemptStoreForTests(next: MigrationAttemptStore | null): void {
  override = next;
}

export function migrationAttemptStore(): MigrationAttemptStore {
  if (override) return override;
  if (typeof indexedDB === "undefined") return unavailableStore;
  return indexedDbMigrationAttemptStore();
}
