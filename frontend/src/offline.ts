import { api, type Item, type Bootstrap } from "./api";

export type OfflineCreateOperation = {
  id: string;
  kind: "create_item";
  createdAt: string;
  payload: Record<string, unknown>;
  imageUrl?: string;
  photo?: Blob;
  photoWidth?: number;
  photoHeight?: number;
  item?: Item;
  imageApplied?: boolean;
  photoApplied?: boolean;
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
const ENTITY_STORE = "items";
const META_STORE = "metadata";
const SNAPSHOT_KEY = "bootstrap";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("Offline storage is unavailable in this browser"));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ENTITY_STORE)) database.createObjectStore(ENTITY_STORE, { keyPath: "public_id" });
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
    request.onsuccess = () => undefined;
    request.onerror = () => reject(request.error || new Error("Offline storage failed"));
    transaction.oncomplete = () => { database.close(); resolve(request.result); };
    transaction.onabort = () => { database.close(); reject(transaction.error || new Error("Offline storage write was aborted")); };
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

export async function saveOfflineSnapshot(snapshot: Bootstrap, complete = false): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction([ENTITY_STORE, META_STORE], "readwrite");
    const entities = tx.objectStore(ENTITY_STORE);
    const metadata = tx.objectStore(META_STORE);
    if (complete) entities.clear();
    for (const item of snapshot.items) entities.put(item);
    const existing = metadata.get(SNAPSHOT_KEY);
    existing.onsuccess = () => {
      // Migrate legacy snapshots without losing records on the first search.
      for (const item of existing.result?.value?.items || []) if (!complete && !snapshot.items.some((entry) => entry.public_id === item.public_id)) entities.put(item);
      metadata.put({ key: SNAPSHOT_KEY, value: { ...snapshot, items: [] },
        savedAt: new Date().toISOString(), completeAt: complete ? new Date().toISOString() : existing.result?.completeAt || null });
    };
    tx.oncomplete = () => { database.close(); resolve(); };
    tx.onerror = tx.onabort = () => { database.close(); reject(tx.error || new Error("Could not save offline inventory")); };
  });
}

export async function loadOfflineSnapshot(): Promise<{ value: Bootstrap; savedAt: string; completeAt: string | null } | null> {
  const record = await transact<{ value: Bootstrap; savedAt: string; completeAt?: string } | undefined>(META_STORE, "readonly", (store) => store.get(SNAPSHOT_KEY));
  if (!record) return null;
  const entities = await transact<Item[]>(ENTITY_STORE, "readonly", (store) => store.getAll());
  const items = new Map((record.value.items || []).map((item) => [item.public_id, item]));
  entities.forEach((item) => items.set(item.public_id, item));
  return { value: { ...record.value, items: [...items.values()], items_next_cursor: null, items_has_more: false }, savedAt: record.savedAt, completeAt: record.completeAt || null };
}

async function performInventoryDownload(progress: (count: number) => void): Promise<number> {
  const snapshot = await api.bootstrap("", undefined, true);
  const items = new Map(snapshot.items.map((item) => [item.public_id, item]));
  let cursor = snapshot.items_next_cursor;
  progress(items.size);
  while (cursor) {
    const page = await api.itemPage("", cursor, undefined, { includeZero: true });
    page.items.forEach((item) => items.set(item.public_id, item));
    cursor = page.next_cursor;
    progress(items.size);
  }
  await saveOfflineSnapshot({ ...snapshot, items: [...items.values()], items_next_cursor: null, items_has_more: false }, true);
  return items.size;
}

window.addEventListener("findstuff:item-removed", (event) => {
  const id = (event as CustomEvent<string>).detail;
  if (typeof id === "string") void transact(ENTITY_STORE, "readwrite", (store) => store.delete(id)).catch(() => undefined);
});

let inventoryDownload: Promise<number> | null = null;
const downloadListeners = new Set<(count: number) => void>();
export function downloadOfflineInventory(progress: (count: number) => void): Promise<number> {
  downloadListeners.add(progress);
  if (!inventoryDownload) inventoryDownload = performInventoryDownload((count) => {
    downloadListeners.forEach((listener) => listener(count));
    window.dispatchEvent(new CustomEvent('findstuff:cache-progress', { detail: count }));
  }).finally(() => {
    inventoryDownload = null;
    window.dispatchEvent(new Event('findstuff:cache-updated'));
  });
  return inventoryDownload.finally(() => downloadListeners.delete(progress));
}

export async function readDeviceDraft<T>(key: string): Promise<T | null> {
  const row = await transact<{ key: string; value: T } | undefined>(META_STORE, "readonly", (store) => store.get(`draft:${key}`));
  return row?.value ?? null;
}
export async function writeDeviceDraft<T>(key: string, value: T): Promise<void> {
  await transact(META_STORE, "readwrite", (store) => store.put({ key: `draft:${key}`, value }));
}
export async function removeDeviceDraft(key: string): Promise<void> {
  await transact(META_STORE, "readwrite", (store) => store.delete(`draft:${key}`));
}
