import { beforeEach, expect, test, vi } from 'vitest';
import { api, type HumanSearchResult, type Item } from '../../api';
import { rememberInventoryPage, restoreInventoryPage } from './inventoryHistory';

beforeEach(() => { window.history.replaceState(null, ''); vi.restoreAllMocks(); });
const result = (count: number, cursor: string | null) => ({ items: Array.from({ length: count }, (_, index) => ({ public_id: String(index) } as Item)), next_cursor: cursor, has_more: cursor !== null, total: 200 } as HumanSearchResult);

test('initial query does not eagerly fetch a short page with a cursor', async () => {
  const query = vi.spyOn(api, 'inventoryQuery').mockResolvedValue(result(1, 'next'));
  await restoreInventoryPage('', {}, false, new AbortController().signal);
  expect(query).toHaveBeenCalledTimes(1);
});

test('browser history restores only the previously loaded pages of the same scope', async () => {
  rememberInventoryPage('fitting', { sort: 'name' }, false, 200);
  const query = vi.spyOn(api, 'inventoryQuery').mockResolvedValueOnce(result(100, 'second')).mockResolvedValueOnce(result(100, 'third'));
  const restored = await restoreInventoryPage('fitting', { sort: 'name' }, false, new AbortController().signal);
  expect(restored.items).toHaveLength(200);
  expect(query).toHaveBeenCalledTimes(2);
  query.mockClear().mockResolvedValue(result(100, 'second'));
  await restoreInventoryPage('different query', { sort: 'name' }, false, new AbortController().signal);
  expect(query).toHaveBeenCalledTimes(1);
});
