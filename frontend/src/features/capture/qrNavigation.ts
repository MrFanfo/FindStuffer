export type FindstuffQrTarget =
  | { type: "item"; publicId: string }
  | { type: "location"; publicId: string; mode: "view" | "add" };

const PUBLIC_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/i;

/**
 * Findstuff labels contain root URLs such as
 * https://device.tailnet.example/?location=loc_123&mode=view.
 *
 * The hostname deliberately is not compared with the current page: the same
 * installation can be reached through Tailnet HTTPS, a LAN hostname, or an
 * installed PWA origin. Requiring a root path and a valid Findstuff public ID
 * keeps ordinary web URLs from being mistaken for inventory labels.
 */
export function parseFindstuffQrTarget(value: string, currentUrl = window.location.href): FindstuffQrTarget | null {
  const normalized = value.trim();
  if (!normalized) return null;

  let parsed: URL;
  try {
    parsed = new URL(normalized, currentUrl);
  } catch {
    return null;
  }

  if (parsed.pathname !== "/") return null;

  const itemId = parsed.searchParams.get("item")?.trim() || "";
  const locationId = parsed.searchParams.get("location")?.trim() || "";
  if (itemId && !locationId && PUBLIC_ID_PATTERN.test(itemId)) {
    return { type: "item", publicId: itemId };
  }
  if (locationId && !itemId && PUBLIC_ID_PATTERN.test(locationId)) {
    return {
      type: "location",
      publicId: locationId,
      mode: parsed.searchParams.get("mode") === "add" ? "add" : "view",
    };
  }
  return null;
}
