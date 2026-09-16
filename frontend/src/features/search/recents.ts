const RECENT_ITEMS_KEY = "findstuff.recentItems.v1";
const RECENT_LIMIT = 8;

// The palette opens on what you looked at last rather than the whole inventory,
// so the same twenty things stay one keystroke away.
export function loadRecentItemIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_ITEMS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export function rememberRecentItem(publicId: string): void {
  if (!publicId) return;
  try {
    const next = [publicId, ...loadRecentItemIds().filter((entry) => entry !== publicId)].slice(0, RECENT_LIMIT);
    localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(next));
  } catch {
    // A private window or blocked storage only costs the convenience.
  }
}
