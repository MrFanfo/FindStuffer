import AxeBuilder from "@axe-core/playwright";
import { expect, Page, test } from "@playwright/test";

const item = {
  public_id: "itm_driver",
  version: 1,
  name: "Phillips driver",
  description: "",
  notes: "",
  category_id: null,
  category_name: null,
  category_slug: null,
  category_parent_id: null,
  category_path: null,
  location_public_id: "loc_drawer",
  location_name: "Drawer A",
  location_path: "Workshop > Drawer A",
  quantity: "1",
  unit: "pcs",
  purchase_price_minor: null,
  purchase_currency: null,
  estimated_price_minor: null,
  estimated_price_currency: null,
  estimated_price_at: null,
  weight_g: null,
  length_mm: null,
  width_mm: null,
  height_mm: null,
  brand: "",
  model: "",
  serial_number: "",
  expiration_date: null,
  low_stock_threshold: null,
  barcode: "",
  links: [],
  tags: [],
  archived_at: null,
  created_at: "2026-01-01T00:00:00",
  updated_at: "2026-01-01T00:00:00",
  primary_photo_url: null,
};

const location = {
  public_id: "loc_drawer",
  name: "Drawer A",
  kind: "drawer",
  description: "",
  path: "Workshop > Drawer A",
  item_count: 1,
  total_item_count: 1,
  children: [],
};

const dashboard = {
  item_count: 2,
  location_count: 1,
  low_stock_count: 0,
  expiring_count: 0,
  needs_details_count: 0,
  recent_events: [],
};

async function mockApi(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/bootstrap") {
      return route.fulfill({
        json: {
          auth: { authenticated: true, user: { public_id: "local", username: "admin", is_admin: true } },
          categories: [],
          dashboard,
          items: [item],
          items_next_cursor: "next-page",
          items_has_more: true,
          location_types: [],
          locations: [location],
          units: ["pcs"],
        },
      });
    }
    if (url.pathname === "/api/v1/items/page") {
      return route.fulfill({
        json: {
          items: [{ ...item, public_id: "itm_second", name: "Flathead driver" }],
          next_cursor: null,
          has_more: false,
        },
      });
    }
    if (url.pathname === "/api/v1/search") {
      const query = url.searchParams.get("q") || "";
      return route.fulfill({
        json: {
          query,
          normalized_query: query,
          count: query.includes("missing") ? 0 : 1,
          items: query.includes("missing") ? [] : [item],
          matched_by: ["related term: phillips driver"],
          fuzzy: false,
          can_add: query.includes("missing"),
          can_mark_lost: query.includes("missing"),
        },
      });
    }
    if (url.pathname === "/api/v1/barcodes/8001234567890/lookup") {
      return route.fulfill({
        json: {
          found: true,
          cached: false,
          existing_item: null,
          mapped_category: null,
          suggested_location: null,
          product: {
            barcode: "8001234567890",
            name: "Workshop screws",
            brand: "Fixings Co",
            package_quantity: "100 pcs",
            categories: ["Hardware"],
            direct_categories: ["Hardware"],
            ingredients_text: "",
            nutriscore_grade: "",
            nova_group: "",
            ecoscore_grade: "",
            nutrition: {},
            image_url: null,
            source: "test",
            source_url: "",
          },
        },
      });
    }
    if (url.pathname === `/api/v1/items/${item.public_id}/detail`) {
      return route.fulfill({
        json: {
          item,
          history: [],
          photos: [],
          enrichment: { product: null, full_product_available: false, jobs: [], candidates: [] },
          lots: [],
          maintenance: [],
          reservations: [],
          related: [],
          documents: [{
            public_id: "doc_warranty",
            item_public_id: item.public_id,
            document_type: "warranty",
            title: "Driver warranty",
            original_name: "warranty.pdf",
            mime_type: "application/pdf",
            size_bytes: 2048,
            purchase_date: "2026-01-01",
            warranty_expires_at: "2028-01-01",
            extracted_text: "",
            extracted_serial_number: "",
            extracted_purchase_date: null,
            extracted_warranty_expires_at: null,
            extraction_status: "complete",
            extraction_error: null,
            content_url: "/api/v1/documents/doc_warranty/content",
            created_at: "2026-01-01T00:00:00",
            updated_at: "2026-01-01T00:00:00",
          }],
        },
      });
    }
    if (url.pathname === `/api/v1/items/${item.public_id}`) {
      return route.fulfill({ json: item });
    }
    if (url.pathname === "/api/v1/dashboard") return route.fulfill({ json: dashboard });
    if (url.pathname === "/api/v1/projects" || url.pathname === "/api/v1/location-rules" || url.pathname === "/api/v1/shopping-list") {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: {} });
  });
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto("/?view=inventory");
  await expect(page.getByRole("searchbox", { name: "Search inventory" })).toBeVisible();
});

test("human search and no-result actions", async ({ page }) => {
  const search = page.getByRole("searchbox", { name: "Search inventory" });
  await search.fill("screwdrivers");
  await Promise.all([
    page.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/v1/search"
    )),
    page.getByRole("button", { name: "Find", exact: true }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Phillips driver" })).toBeVisible({
    timeout: 10_000,
  });

  await search.fill("missing widget");
  await Promise.all([
    page.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/v1/search"
      && new URL(response.url()).searchParams.get("q") === "missing widget"
    )),
    page.getByRole("button", { name: "Find", exact: true }).click(),
  ]);
  await expect(page.getByText(/No inventory result/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Add “missing widget”/ })).toBeVisible();
});

test("cursor pagination and document ownership", async ({ page }) => {
  await Promise.all([
    page.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/v1/items/page"
    )),
    page.getByRole("button", { name: /Load more from Findstuff/ }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Flathead driver" })).toBeVisible();

  await Promise.all([
    page.waitForResponse((response) => (
      new URL(response.url()).pathname === `/api/v1/items/${item.public_id}/detail`
    )),
    page.getByRole("button", { name: /Phillips driver Workshop/ }).click(),
  ]);
  await page.getByRole("tab", { name: "Details" }).click();
  await expect(page.getByRole("link", { name: "Driver warranty" })).toBeVisible();
});

test("scan produces an editable review before saving", async ({ page }) => {
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page.getByRole("tab", { name: "Scan" }).click();
  await page.getByRole("textbox", { name: "Barcode or QR text" }).fill("8001234567890");
  await Promise.all([
    page.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/v1/barcodes/8001234567890/lookup"
    )),
    page.getByRole("button", { name: "Use code" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: "1 unique item" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Workshop screws");
  await expect(page.getByRole("button", { name: "Save item" })).toBeEnabled();
});

test("inventory has no serious accessibility violations", async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
