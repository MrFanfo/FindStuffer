import type { Item } from "../../api";

/** Status helpers shared by the inventory list, its rows and its filters. */
export function isLowStock(item: Item): boolean {
  return item.low_stock_threshold !== null && Number(item.quantity) <= Number(item.low_stock_threshold);
}

export function expirationDays(item: Item): number | null {
  if (!item.expiration_date) return null;
  return Math.ceil((new Date(`${item.expiration_date}T23:59:59`).getTime() - Date.now()) / 86400000);
}

export function expirationCopy(item: Item): string {
  const days = expirationDays(item);
  if (days === null) return "";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `${days}d left`;
}

export function expirationTime(item: Item): number {
  if (!item.expiration_date) return Number.POSITIVE_INFINITY;
  return new Date(`${item.expiration_date}T23:59:59`).getTime();
}

export function itemNeedsDetails(item: Item): boolean {
  return item.location_public_id === "unassigned";
}

export function restockQuantity(item: Item): string {
  const current = Number(item.quantity);
  const threshold = item.low_stock_threshold === null ? current : Number(item.low_stock_threshold);
  return String(Math.max(1, Math.ceil(threshold - current)));
}

/** Quantity held for projects, which is stock that is already promised elsewhere. */
export function heldQuantity(item: Item): number {
  return (item.project_holds || []).reduce((total, hold) => total + Number(hold.quantity || 0), 0);
}

/**
 * The place, most specific part first, so that truncating a narrow row trims the
 * broad end of the path instead of the drawer the item is actually in.
 */
export function placeParts(item: Item): { leaf: string; rest: string } {
  if (item.containment_path) {
    const [leaf, ...rest] = item.containment_path.replace(/^Inside\s+/i, "").split(">").map((part) => part.trim()).filter(Boolean);
    return { leaf: leaf || "Unassigned", rest: rest.join(" › ") };
  }
  const parts = item.location_path.split(">").map((part) => part.trim()).filter(Boolean);
  const leaf = parts.pop() || "Unassigned";
  return { leaf, rest: parts.join(" › ") };
}

/** Quantities are decimal strings; keep the arithmetic free of floating-point dust. */
export function quantityDelta(from: string, to: string): number {
  return Math.round((Number(to) - Number(from)) * 1000) / 1000;
}
