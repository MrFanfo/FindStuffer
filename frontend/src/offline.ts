import type { Bootstrap } from "./api";

export type OfflineCreateOperation = {
  id: string;
  kind: "create_item";
  createdAt: string;
  payload: Record<string, unknown>;
  imageUrl?: string;
  photo?: Blob;
  photoWidth?: number;
  photoHeight?: number;
  error?: string;
};

export type OfflineAdjustOperation = {
  id: string;
  kind: "adjust_quantity";
  createdAt: string;
  payload: {
    item_public_id: string;
    item_name: string;
    delta: number;
  };
  error?: string;
};

export type OfflineOperation = OfflineCreateOperation | OfflineAdjustOperation;

const DATABASE_NAME = "findstuff-offline-v1";
const QUEUE_STORE = "operations";
const META_STORE = "metadata";
const SNAPSHOT_KEY = "bootstrap";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("Offline storage is unavailable in this browser"));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(QUEUE_STORE)) {
        database.createObjectStore(QUEUE_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open offline storage"));
  });
}

async function transact<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Offline storage failed"));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error("Offline storage transaction failed"));
    };
  });
}

export function offlineOperationId(): string {
  const value = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `offline:${value}`;
}

export async function putOfflineOperation(operation: OfflineOperation): Promise<void> {
  await transact(QUEUE_STORE, "readwrite", (store) => store.put(operation));
}

export async function listOfflineOperations(): Promise<OfflineOperation[]> {
  const operations = await transact<OfflineOperation[]>(
    QUEUE_STORE,
    "readonly",
    (store) => store.getAll(),
  );
  return operations.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function deleteOfflineOperation(id: string): Promise<void> {
  await transact(QUEUE_STORE, "readwrite", (store) => store.delete(id));
}

export async function setOfflineOperationError(id: string, error: string): Promise<void> {
  const operations = await listOfflineOperations();
  const operation = operations.find((entry) => entry.id === id);
  if (operation) await putOfflineOperation({ ...operation, error });
}

export async function saveOfflineSnapshot(snapshot: Bootstrap): Promise<void> {
  await transact(META_STORE, "readwrite", (store) => store.put({
    key: SNAPSHOT_KEY,
    value: snapshot,
    savedAt: new Date().toISOString(),
  }));
}

export async function loadOfflineSnapshot(): Promise<{
  value: Bootstrap;
  savedAt: string;
} | null> {
  const record = await transact<{ key: string; value: Bootstrap; savedAt: string } | undefined>(
    META_STORE,
    "readonly",
    (store) => store.get(SNAPSHOT_KEY),
  );
  return record ? { value: record.value, savedAt: record.savedAt } : null;
}
