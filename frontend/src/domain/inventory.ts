import type { Category, CategoryCapabilities, Item } from "../api";

const OPEN_CAPABILITIES: CategoryCapabilities = {
  fullness: true,
  expiration: true,
  batches: true,
  maintenance: true,
  reservation: true,
  enrichment: true,
  photos: true,
  identity: true,
  specs: true,
  price: true,
  links: true,
  shopping_list: true,
  override: false,
  inherited_from: null,
  inherited_label: "uncategorised defaults",
};

export function capabilitiesForCategory(
  categories: Category[],
  categoryId: number | string | null | undefined,
): CategoryCapabilities {
  if (categoryId === null || categoryId === undefined || categoryId === "") return OPEN_CAPABILITIES;
  return categories.find((category) => category.id === Number(categoryId))?.capabilities || OPEN_CAPABILITIES;
}

export function categoryOptionLabel(category: Category): string {
  return category.path || category.name;
}

export function categoryLabel(item: Item): string {
  return item.category_path || item.category_name || "";
}

export function expirationState(item: Item): "expired" | "soon" | null {
  if (!item.expiration_date) return null;
  const days = Math.ceil((new Date(`${item.expiration_date}T23:59:59`).getTime() - Date.now()) / 86400000);
  if (days < 0) return "expired";
  return days <= 7 ? "soon" : null;
}

export function activityLabel(action: string): string {
  const labels: Record<string, string> = {
    adjust_quantity: "Quantity changed",
    archive: "Archived",
    create: "Created",
    move: "Moved",
    restore: "Restored",
    update: "Updated",
    update_tags: "Tags updated",
  };
  return labels[action] || action.replaceAll("_", " ");
}

export function parseLinkText(value: string): Array<{ label: string; url: string }> {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [first, ...rest] = line.split("|").map((part) => part.trim());
      const url = rest.length ? rest.join("|").trim() : first;
      return { label: rest.length ? first : url.replace(/^https?:\/\//, ""), url };
    })
    .filter((link) => link.label && link.url);
}
