import { api, type HumanSearchResult, type InventoryQueryOptions } from '../../api';

function scopeKey(query: string, scope: InventoryQueryOptions, includeZero: boolean) {
  return JSON.stringify([query, Object.entries(scope).sort(([a], [b]) => a.localeCompare(b)), includeZero]);
}

/** Refill previously loaded pages before browser Back restores their scroll position. */
export async function restoreInventoryPage(query: string, scope: InventoryQueryOptions, includeZero: boolean, signal: AbortSignal): Promise<HumanSearchResult> {
  const key = scopeKey(query, scope, includeZero);
  const saved = window.history.state?.inventory;
  const wanted = saved?.key === key ? Number(saved.rows) || 0 : 0;
  let result = await api.inventoryQuery(query, scope, includeZero, null, { signal });
  while (result.next_cursor && result.items.length < wanted) {
    const page = await api.inventoryQuery(query, scope, includeZero, result.next_cursor, { signal });
    result = { ...page, items: [...result.items, ...page.items] };
  }
  return result;
}

export function rememberInventoryPage(query: string, scope: InventoryQueryOptions, includeZero: boolean, rows: number) {
  window.history.replaceState({ ...window.history.state, inventory: { key: scopeKey(query, scope, includeZero), rows } }, '');
}
