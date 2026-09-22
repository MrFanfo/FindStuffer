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
    if (url.pathname === "/api/v1/compatibility-targets") return route.fulfill({ json: [] });
    if (url.pathname.endsWith("/extensions")) return route.fulfill({ json: { custom_fields: {}, field_definitions: [], compatibility: [] } });
    if (url.pathname === "/api/v1/preferences") return route.fulfill({ json: { pinned_places: [], favorite_categories: [], show_shopping: true } });
    if (url.pathname === "/api/v1/attention") return route.fulfill({ json: { ai_pending: 0, reminders: [] } });
    if (url.pathname === "/api/v1/items/query") {
      const query = url.searchParams.get("q") || "";
      const more = !query && !url.searchParams.get("cursor");
      const missing = query.includes("missing");
      return route.fulfill({ json: { query, normalized_query: query, count: missing ? 0 : query ? 1 : 2,
        total: missing ? 0 : query ? 1 : 2, items: missing ? [] : url.searchParams.get("cursor") ? [{ ...item, public_id: "itm_second", name: "Flathead driver" }] : [item],
        next_cursor: more ? "next-page" : null, has_more: more, matched_by: [], fuzzy: false, can_add: missing, can_mark_lost: missing } });
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
    if (url.pathname === `/api/v1/locations/${location.public_id}/contents`) {
      return route.fulfill({
        json: { location, children: [], items: [item], recursive: true },
      });
    }
    if (url.pathname === "/api/v1/dashboard") return route.fulfill({ json: dashboard });
    if (url.pathname === "/api/v1/saved-views" || url.pathname === "/api/v1/projects" || url.pathname === "/api/v1/location-rules" || url.pathname === "/api/v1/shopping-list") {
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
      new URL(response.url()).pathname === "/api/v1/items/query"
    )),
    page.getByRole("button", { name: "Find", exact: true }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Phillips driver" })).toBeVisible({
    timeout: 10_000,
  });

  await search.fill("missing widget");
  await Promise.all([
    page.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/v1/items/query"
      && new URL(response.url()).searchParams.get("q") === "missing widget"
    )),
    page.getByRole("button", { name: "Find", exact: true }).click(),
  ]);
  await expect(page.getByText(/No inventory result/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Add “missing widget”/ })).toBeVisible();
});

test("cursor pagination and document ownership", async ({ page }) => {
  // The first page doesn't fill the screen, so the next one loads without a click.
  await expect(page.getByRole("heading", { name: "Flathead driver" })).toBeVisible();

  await Promise.all([
    page.waitForResponse((response) => (
      new URL(response.url()).pathname === `/api/v1/items/${item.public_id}/detail`
    )),
    page.getByRole("button", { name: "Open Phillips driver" }).click(),
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

test("scan opens a Tailnet location QR instead of adding an item", async ({ page }) => {
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page.getByRole("tab", { name: "Scan" }).click();
  await page.getByRole("textbox", { name: "Barcode or QR text" }).fill(
    `https://findstuff.example.ts.net/?location=${location.public_id}&mode=view`,
  );
  await page.getByRole("button", { name: "Use code" }).click();

  await expect(page.getByRole("heading", { name: location.name })).toBeVisible();
  await expect(page.getByRole("heading", { name: "1 unique item" })).toHaveCount(0);
});

test("inventory has no serious accessibility violations", async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("empty item sections stay hidden and editors respect category capabilities", async ({ page }) => {
  await page.route(`**/api/v1/items/${item.public_id}/detail`, (route) => route.fulfill({ json: { item, history: [], photos: [], documents: [], lots: [], maintenance: [], reservations: [], related: [], enrichment: { product: null, candidates: [], jobs: [] } } }));
  await page.getByRole("button", { name: "Open Phillips driver" }).click();
  await page.getByRole("tab", { name: "Details" }).click();
  for (const name of ["Documents & warranties", "Links", "Properties", "Related", "Maintenance", "Expiration batches"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Documents & warranties" })).toBeVisible();
  await expect(page.getByLabel("Links", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Related", exact: true })).toBeVisible();
  await expect(page.getByLabel(/This item is a physical instance/)).toBeVisible();
});

const compactCategory = {
  id: 42, parent_id: null, name: "PTFE Tubes and Pneumatic Fittings", slug: "ptfe", path: "PTFE Tubes and Pneumatic Fittings", depth: 0, sort_order: 0, item_count: 1, total_item_count: 1, default_location: null,
  capabilities: { fullness: false, expiration: false, batches: false, maintenance: false, reservation: false, enrichment: false, photos: false, identity: true, specs: false, price: false, links: false, shopping_list: false, documents: false, related: false, override: true, inherited_from: null, inherited_label: "custom" },
};
async function categoryBootstrap(page: Page) {
  await page.route("**/api/v1/bootstrap?**", (route) => route.fulfill({ json: {
    auth: { authenticated: true, user: { public_id: "local", username: "admin", is_admin: true } }, categories: [compactCategory], dashboard, items: [{ ...item, category_id: 42 }], items_next_cursor: null, items_has_more: false, location_types: [], locations: [location], units: ["pcs"],
  } }));
}

test("mobile category labels retain most of the row and actions stay inline", async ({ page }, testInfo) => {
  await categoryBootstrap(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=categories");
  await expect(page.locator('.category-node')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hide empty branches' })).toBeVisible();
  await page.getByRole('button', { name: 'Hide empty branches' }).click();
  await expect(page.getByRole('button', { name: 'Show all branches' })).toBeVisible();
  await page.getByRole('button', { name: 'Show all branches' }).click();
  const treeLabel = await page.locator('.category-open').boundingBox();
  expect(treeLabel!.width).toBeGreaterThan(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
    const scan = await new AxeBuilder({ page }).analyze();
    expect(scan.violations).toEqual([]);
  }
  await page.screenshot({ path: testInfo.outputPath('compact-categories.png'), fullPage: true });
});

test("disabled category sections are absent from item edit", async ({ page }) => {
  await categoryBootstrap(page);
  await page.route(`**/api/v1/items/${item.public_id}`, (route) => route.fulfill({ json: { ...item, category_id: 42 } }));
  await page.goto(`/?view=inventory&item=${item.public_id}`);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  for (const name of ['Documents & warranties', 'Related', 'Maintenance', 'Expiration batches']) {
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByLabel('Links', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
});

const printerTarget = {
  public_id: "compat_ender", name: "Ender 3", manufacturer: "Creality", model: "V2", type: "printer",
  aliases: [], parent: null, category: 42, active: true, linked_item_ids: [],
};
const looseTarget = {
  public_id: "compat_loose", name: "Unsorted rig", manufacturer: "", model: "", type: "",
  aliases: [], parent: null, category: null, active: true, linked_item_ids: [],
};
const plannedProject = {
  public_id: "prj_toolhead", name: "Toolhead upgrade", description: "Swap the hotend", notes: "", status: "planned",
  multiplier: 1, currency: "EUR", ready: false, compatibility: [], links: [], files: [], outputs: [], completions: [],
  requirements: [], budget: { estimated_total_minor: 0, actual_spent_minor: 0, ordered_value_minor: 0, remaining_estimated_minor: 0, unpriced_lines: 0 },
  progress: { percent: 0, completed_lines: 0, total_lines: 0, missing_lines: 0, quantities_by_unit: {} },
};

async function planningBootstrap(page: Page) {
  await categoryBootstrap(page);
  await page.route("**/api/v1/compatibility-targets", (route) => route.fulfill({ json: [printerTarget, looseTarget] }));
  await page.route("**/api/v1/compatibility-targets/compat_ender**", (route) => route.fulfill({ json: {
    target: printerTarget, linked_items: [], total: 0, items: [], projects: [{ public_id: "prj_toolhead", name: "Toolhead upgrade" }], next_offset: null,
  } }));
  await page.route("**/api/v1/projects", (route) => route.fulfill({ json: [plannedProject] }));
}

test("compatibility targets group by category and open their own page", async ({ page }) => {
  await planningBootstrap(page);
  await page.goto("/?view=compatibility");
  // Grouped by the assigned category, with uncategorised collected separately.
  await expect(page.getByRole("region", { name: "PTFE Tubes and Pneumatic Fittings" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Uncategorised" })).toBeVisible();
  await page.getByRole("button", { name: /Ender 3/ }).click();
  // The detail replaces the list rather than expanding beneath it.
  await expect(page).toHaveURL(/view=target/);
  await expect(page.getByRole("heading", { level: 1, name: "Ender 3" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Compatibility$/ })).toBeVisible();
  await expect(page.locator(".target-group")).toHaveCount(0);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
});

test("projects open a detail page and return to the list", async ({ page }) => {
  await planningBootstrap(page);
  await page.goto("/?view=projects");
  await expect(page.locator(".project-card")).toHaveCount(1);
  await page.getByRole("button", { name: /Toolhead upgrade/ }).click();
  await expect(page).toHaveURL(/view=project/);
  await expect(page.getByRole("heading", { level: 1, name: "Toolhead upgrade" })).toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(0);
  await page.getByRole("button", { name: /^Projects$/ }).click();
  await expect(page.locator(".project-card")).toHaveCount(1);
});

test("target editor picks a category from the hierarchy", async ({ page }) => {
  await planningBootstrap(page);
  await page.goto("/?view=compatibility");
  await page.getByRole("button", { name: "Create target" }).click();
  const dialog = page.getByRole("dialog", { name: "Compatibility target editor" });
  await expect(dialog).toBeVisible();
  // The category control is the same hierarchy picker item edit uses, not a select.
  await expect(dialog.locator(".picker-field select")).toHaveCount(0);
  await dialog.getByRole("button", { name: /No category/ }).click();
  const picker = page.getByRole("dialog", { name: "Choose category" });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: /Use (this )?category/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Choose category" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /PTFE Tubes and Pneumatic Fittings/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Clear category" })).toBeVisible();
});


test("capture draft survives a reload", async ({ page }) => {
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page.getByLabel("Barcode").fill("8001234567890");
  await page.getByRole("button", { name: "Use code" }).click();
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(name).toHaveValue("Workshop screws");
  await name.fill("Unfinished capture draft");
  await expect(page.getByText("Draft saved on this device", { exact: true })).toBeVisible();
  await page.reload();
  await expect(name).toHaveValue("Unfinished capture draft");
  await expect(page.getByText(/Your unfinished draft is restored/)).toBeVisible();
});

test("saved views persist on the server with compatibility filters", async ({ page }) => {
  let saved: Record<string, unknown> | null = null;
  await page.route("**/api/v1/saved-views**", async route => {
    if (route.request().method() === "PUT") {
      saved = { ...route.request().postDataJSON().view, revision: 1 };
      return route.fulfill({ json: saved });
    }
    return route.fulfill({ json: saved ? [saved] : [] });
  });
  await page.reload();
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByLabel("Compatible with").fill("Camera");
  await page.getByLabel("Save this view").fill("Camera stock");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".inventory-quick-chips").getByRole("button", { name: "Camera stock" })).toBeVisible();
  expect(saved).toMatchObject({ compatibilityFilter: "Camera", revision: 1 });
  await page.reload();
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByLabel("Compatible with").fill("");
  await page.locator(".inventory-quick-chips").getByRole("button", { name: "Camera stock" }).click();
  await expect(page.getByLabel("Compatible with")).toHaveValue("Camera");
});

test("item detail fits laptop and desktop widths", async ({ page }) => {
  for (const width of [1100, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?view=inventory&item=${item.public_id}`);
    const sheet = page.locator(".detail-sheet");
    await expect(sheet).toBeVisible();
    const bounds = await sheet.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
  }
});

test("scrolling loads more items in place and does not flood history", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.history.replaceState.bind(window.history);
    (window as unknown as { replaceCalls: number }).replaceCalls = 0;
    window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
      (window as unknown as { replaceCalls: number }).replaceCalls += 1;
      return original(...args);
    };
  });
  await page.route("**/api/v1/items/query**", (route) => {
    const cursor = Number(new URL(route.request().url()).searchParams.get("cursor") || 0);
    const items = Array.from({ length: 100 }, (_, index) => ({
      ...item, public_id: `itm_${cursor + index}`, name: `Bulk item ${String(cursor + index).padStart(3, "0")}`,
    }));
    const more = cursor + 100 < 300;
    return route.fulfill({ json: { query: "", normalized_query: "", count: 300, total: 300, items,
      next_cursor: more ? String(cursor + 100) : null, has_more: more, matched_by: [], fuzzy: false, can_add: false, can_mark_lost: false } });
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Bulk item 000" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bulk item 100" })).toHaveCount(0);

  await page.getByRole("heading", { name: "Bulk item 099" }).scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(1000);
  await expect(page.getByRole("heading", { name: "Bulk item 199" })).toBeAttached();
  await page.waitForTimeout(300);
  expect(Math.abs(await page.evaluate(() => window.scrollY) - before)).toBeLessThan(50);
  await expect(page.getByRole("button", { name: /Show \d+ more/ })).toHaveCount(0);

  await page.getByRole("heading", { name: "Bulk item 199" }).scrollIntoViewIfNeeded();
  await expect(page.getByText("That's everything · 300 items")).toBeVisible();
  await page.mouse.wheel(0, -400);
  await page.getByRole("button", { name: "Top" }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(10);

  // Browsers throttle replaceState (Safari: 100 per 10s); a 3s scroll burst must not come close.
  await page.evaluate(() => { (window as unknown as { replaceCalls: number }).replaceCalls = 0; });
  await page.evaluate(() => new Promise<void>((resolve) => {
    let frame = 0;
    const tick = () => {
      window.scrollBy(0, frame % 60 < 30 ? 40 : -40);
      frame += 1;
      if (frame < 180) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  }));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { replaceCalls: number }).replaceCalls)).toBeLessThan(20);
});

test("a row holds its actions, its chips filter, and the quantity can be counted", async ({ page }) => {
  let adjusted: Record<string, unknown> | null = null;
  await page.route("**/api/v1/offline/sync", async (route) => {
    adjusted = route.request().postDataJSON().payload;
    return route.fulfill({ json: { operation_id: "op", status: "applied", result: { ...item, quantity: "7" } } });
  });
  const row = page.locator(".inv-row").filter({ hasText: "Phillips driver" }).first();

  // The row shows one line: photo, name, place, amount. Changing stock waits behind the chevron.
  await expect(row.locator(".inv-thumb")).toBeVisible();
  await expect(row.getByRole("button", { name: "Move", exact: true })).toHaveCount(0);
  await expect(row.getByRole("button", { name: /^(Add|Remove) one/ })).toHaveCount(0);
  await row.getByRole("button", { name: "More actions for Phillips driver" }).click();
  await expect(row.getByRole("button", { name: "Move", exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Add one Phillips driver" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Archive", exact: true })).toBeVisible();
  await row.getByRole("button", { name: "More actions for Phillips driver" }).click();
  await expect(row.getByRole("button", { name: "Move", exact: true })).toHaveCount(0);

  // Counting sets an exact amount, sent as the change that reaches it.
  await row.getByRole("button", { name: /Set quantity for Phillips driver/ }).click();
  await page.getByRole("textbox", { name: "Quantity in pcs" }).fill("7");
  await expect(page.getByText("Adds 6 pcs", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Save quantity" }).click();
  await expect.poll(() => (adjusted as { delta?: number } | null)?.delta).toBe(6);

  // The place chip narrows the list to that place instead of opening the item.
  await row.getByRole("button", { name: /Drawer A/ }).click();
  await expect(page.getByRole("button", { name: /Drawer A \+ inside/ })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("density is a choice the list remembers", async ({ page }) => {
  await page.getByRole("button", { name: "Display" }).click();
  await page.getByRole("radio", { name: /Photo grid/ }).click();
  await expect(page.locator(".inventory-group.as-grid")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await page.reload();
  await expect(page.locator(".inventory-group.as-grid")).toBeVisible();
  await page.getByRole("button", { name: "Display" }).click();
  await page.getByRole("radio", { name: /Compact/ }).click();
  await expect(page.locator(".inv-row.inv-compact").first()).toBeVisible();
});
