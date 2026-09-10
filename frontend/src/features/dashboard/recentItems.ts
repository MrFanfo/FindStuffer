import type { Item } from "../../api";
const key = 'findstuff.recentItems.v1';
export function recentlyViewed(): Item[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value.filter((item): item is Item => item && typeof item.public_id === 'string').slice(0, 5) : []; }
  catch { return []; }
}
export function rememberItem(item: Item) {
  try { localStorage.setItem(key, JSON.stringify([item, ...recentlyViewed().filter((entry) => entry.public_id !== item.public_id)].slice(0, 5))); }
  catch { /* Recent navigation is optional when storage is full. */ }
}
