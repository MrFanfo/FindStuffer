import { beforeEach, expect, it, vi } from "vitest";
import type { Item } from "../../api";
import type { OfflineOperation } from "../../offline";
const mocks = vi.hoisted(() => ({ queue: [] as OfflineOperation[], sync: vi.fn(), item: vi.fn() }));
vi.mock("../../api", () => ({ api: { syncOfflineOperation: mocks.sync, item: mocks.item } }));
vi.mock("../../offline", () => ({
  offlineOperationId: () => crypto.randomUUID(),
  putOfflineOperation: async (op: OfflineOperation) => { mocks.queue.push(op); },
  listOfflineOperations: async () => [...mocks.queue].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  deleteOfflineOperation: async (id: string) => { mocks.queue = mocks.queue.filter(op => op.id !== id); },
}));
import { applyQuantityOperation, persistQuantityChange } from "./quantityChanges";
const item = { public_id: "item", name: "Parts", quantity: "3" } as Item;
beforeEach(() => { mocks.queue = []; mocks.sync.mockReset(); mocks.item.mockReset(); });
it("retries the same receipt after a lost response and preserves later changes", async () => {
  const first = await persistQuantityChange(item, 1);
  const second = await persistQuantityChange(item, -1);
  mocks.sync.mockRejectedValueOnce(new Error("Response lost"));
  await expect(applyQuantityOperation(second)).rejects.toThrow("Response lost");
  expect(mocks.queue).toHaveLength(2);
  mocks.sync.mockResolvedValue({ result: item });
  await applyQuantityOperation(second);
  expect(mocks.sync.mock.calls.map(call => call[0])).toEqual([first.id, first.id, second.id]);
  expect(mocks.queue).toHaveLength(0);
});
it("serializes concurrent quantity changes without sending a receipt twice", async () => {
  const first = await persistQuantityChange(item, 1);
  const second = await persistQuantityChange(item, 1);
  mocks.sync.mockResolvedValue({ result: item });
  await Promise.all([applyQuantityOperation(first), applyQuantityOperation(second)]);
  expect(mocks.sync.mock.calls.map(call => call[0])).toEqual([first.id, second.id]);
});
