import type { Item } from "../../api";

/** Status helpers shared by the inventory list, its rows and its filters. */
export function isLowStock(item: Item): boolean {
  return item.low_stock_enabled !== false && item.low_stock_threshold !== null && Number(item.quantity) <= Number(item.low_stock_threshold);
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
 * Places are typed in whatever case was handy — STUDIO, armadio grande — so the
 * list evens them out. Words that are deliberately mixed case, like iPhone or
 * 3D, are left exactly as they are.
 */
function evenCase(part: string): string {
  return part.split(" ").map((word) => {
    if (!word || /\d/.test(word)) return word;
    const letters = word.replace(/[^A-Za-zÀ-ÿ]/g, "");
    if (letters.length > 1 && letters !== letters.toUpperCase() && letters !== letters.toLowerCase()) return word;
    return word[0].toUpperCase() + word.slice(1).toLowerCase();
  }).join(" ");
}

/**
 * The place, led by the two levels that identify it — the room and the cupboard —
 * because those are what someone walks to. Everything deeper, including the
 * container an item sits in, follows and gives way first when the row is narrow.
 */
export function placeParts(item: Item): { head: string; tail: string } {
  const parts = item.location_path.split(">").map((part) => evenCase(part.trim())).filter(Boolean);
  const container = item.containment_path
    ? evenCase(item.containment_path.replace(/^Inside\s+/i, "").split(">").map((part) => part.trim()).filter(Boolean)[0] || "")
    : "";
  return {
    head: parts.slice(0, 2).join(" › ") || "Unassigned",
    tail: [...parts.slice(2), container].filter(Boolean).join(" › "),
  };
}

/** Quantities are decimal strings; keep the arithmetic free of floating-point dust. */
export function quantityDelta(from: string, to: string): number {
  return Math.round((Number(to) - Number(from)) * 1000) / 1000;
}
