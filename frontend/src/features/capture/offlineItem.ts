import { flattenLocations, type Category, type Item, type LocationNode } from "../../api";

export function makeOfflineItem(
  body: Record<string, unknown>,
  operationId: string,
  locations: LocationNode[],
  categories: Category[],
  hasPhoto: boolean,
): Item {
  const locationId = String(body.location_public_id || "unassigned");
  const location = flattenLocations(locations).find((entry) => entry.public_id === locationId);
  const categoryId = typeof body.category_id === "number" ? body.category_id : null;
  const category = categories.find((entry) => entry.id === categoryId);
  return {
    public_id: operationId,
    version: 1,
    name: String(body.name || "Offline capture"),
    description: String(body.description || ""),
    notes: String(body.notes || ""),
    category_id: categoryId,
    category_name: category?.name || null,
    category_slug: category?.slug || null,
    category_parent_id: category?.parent_id || null,
    category_path: category?.path || null,
    location_public_id: locationId,
    location_name: location?.name || "Unassigned",
    location_path: location?.path || "Unassigned",
    quantity: String(body.quantity || "1"),
    unit: String(body.unit || "pcs"),
    purchase_price_minor: typeof body.purchase_price_minor === "number" ? body.purchase_price_minor : null,
    purchase_currency: typeof body.purchase_currency === "string" ? body.purchase_currency : null,
    estimated_price_minor: typeof body.estimated_price_minor === "number" ? body.estimated_price_minor : null,
    estimated_price_currency: typeof body.estimated_price_currency === "string" ? body.estimated_price_currency : null,
    estimated_price_at: null,
    weight_g: typeof body.weight_g === "number" ? body.weight_g : null,
    length_mm: typeof body.length_mm === "number" ? body.length_mm : null,
    width_mm: typeof body.width_mm === "number" ? body.width_mm : null,
    height_mm: typeof body.height_mm === "number" ? body.height_mm : null,
    serial_number: String(body.serial_number || ""),
    model: String(body.model || ""),
    brand: String(body.brand || ""),
    expiration_date: typeof body.expiration_date === "string" ? body.expiration_date : null,
    low_stock_threshold: body.low_stock_threshold === null || body.low_stock_threshold === undefined
      ? null
      : String(body.low_stock_threshold),
    barcode: String(body.barcode || ""),
    links: Array.isArray(body.links) ? body.links as Array<{ label: string; url: string }> : [],
    tags: Array.isArray(body.tags) ? body.tags.filter((entry): entry is string => typeof entry === "string") : [],
    archived_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    primary_photo_url: hasPhoto ? "" : null,
  };
}
