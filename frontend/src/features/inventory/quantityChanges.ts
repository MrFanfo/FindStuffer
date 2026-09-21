import { api, type Item } from "../../api";
import { deleteOfflineOperation, listOfflineOperations, offlineOperationId, putOfflineOperation, type OfflineAdjustOperation } from "../../offline";

const running = new Map<string, Promise<Item>>();
let lastTimestamp = 0;

/** Persist the intention before sending it, including when the device is online. */
export async function persistQuantityChange(item: Item, delta: number): Promise<OfflineAdjustOperation> {
  lastTimestamp = Math.max(Date.now(), lastTimestamp + 1);
  const operation: OfflineAdjustOperation = {
    id: offlineOperationId(), kind: "adjust_quantity", createdAt: new Date(lastTimestamp).toISOString(),
    payload: { item_public_id: item.public_id, item_name: item.name, delta },
  };
  await putOfflineOperation(operation);
  return operation;
}

/** Replays use the same receipt, and later changes cannot overtake a failed one. */
export function applyQuantityOperation(operation: OfflineAdjustOperation): Promise<Item> {
  const itemId = operation.payload.item_public_id;
  const drain = async () => {
    const queued = (await listOfflineOperations()).filter((entry): entry is OfflineAdjustOperation => entry.kind === "adjust_quantity" && entry.payload.item_public_id === itemId);
    const end = queued.findIndex((entry) => entry.id === operation.id);
    if (end < 0) return api.item(itemId); // Another tab already synchronized it.
    let result: Item | undefined;
    for (const entry of queued.slice(0, end + 1)) {
      result = (await api.syncOfflineOperation(entry.id, entry.kind, entry.payload)).result;
      await deleteOfflineOperation(entry.id);
    }
    return result!;
  };
  const execute = async (): Promise<Item> => navigator.locks
    ? navigator.locks.request(`findstuff:quantity:${itemId}`, drain)
    : drain();
  const next = (running.get(itemId) || Promise.resolve()).catch(() => undefined).then(execute);
  running.set(itemId, next);
  void next.finally(() => { if (running.get(itemId) === next) running.delete(itemId); }).catch(() => undefined);
  return next;
}
