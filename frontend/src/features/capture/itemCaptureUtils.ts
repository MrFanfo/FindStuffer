import type { Category, CategoryCapabilities } from "../../api";

const OPEN_CAPABILITIES: CategoryCapabilities = {
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

export function isOfflineFailure(error: unknown): boolean {
  if (!navigator.onLine) return true;
  return error instanceof Error && (
    error.message === "Failed to fetch"
    || error.message.includes("NetworkError")
    || error.message.includes("Load failed")
  );
}
