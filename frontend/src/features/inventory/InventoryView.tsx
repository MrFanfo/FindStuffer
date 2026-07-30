import { type FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { api, flattenLocations, type Category, type Item, type LocationNode } from "../../api";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { SearchFeedback } from "../../components/SearchFeedback";
import { SearchableFilterPicker } from "../../components/SearchableFilterPicker";
import { categoryLabel, categoryOptionLabel, expirationState } from "../../domain/inventory";
import {
  cloneFormula,
  emptyInventoryFormula,
  inventoryFormulaMatches,
  loadSavedInventoryViews,
  saveSavedInventoryViews,
  uid,
  validateInventoryFormula,
  type InventoryFilter,
  type InventoryFormula,
  type InventoryGroup,
  type InventorySort,
  type SavedInventoryView,
} from "./formula";

type InventorySearchOptions = { showBusy?: boolean };
type RefreshScope = "all" | "inventory" | "none";
type ActionOptions = { progress?: string; undo?: () => Promise<void> };
type InventoryViewPrefs = { groupBy: InventoryGroup; sortBy: InventorySort };

const INVENTORY_PREFS_KEY = "findstuff.inventoryPrefs.v1";
const INITIAL_RESULT_WINDOW = 120;
const RESULT_WINDOW_STEP = 120;

function isLowStock(item: Item): boolean {
  return item.low_stock_threshold !== null && Number(item.quantity) <= Number(item.low_stock_threshold);
}

function expirationDays(item: Item): number | null {
  if (!item.expiration_date) return null;
  return Math.ceil((new Date(`${item.expiration_date}T23:59:59`).getTime() - Date.now()) / 86400000);
}

function expirationCopy(item: Item): string {
  const days = expirationDays(item);
  if (days === null) return "";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `${days}d left`;
}

function expirationTime(item: Item): number {
  if (!item.expiration_date) return Number.POSITIVE_INFINITY;
  return new Date(`${item.expiration_date}T23:59:59`).getTime();
}

function inventoryFilterLabel(filter: InventoryFilter): string {
  const labels: Record<InventoryFilter, string> = {
    all: "All Items", low: "Low stock", expiring: "Expiring", details: "No place",
    zero: "Empty stock", "in-stock": "In stock", expired: "Expired",
    "expiring-week": "Expiring in 7 days", "expiring-30": "Expiring in 30 days",
    "expiry-8-30": "Expiring in 8–30 days", "expiry-31-90": "Expiring in 31–90 days",
    "expiry-later": "Later expiry", "no-expiry": "No expiry date", "missing-photo": "Missing photos",
    uncategorized: "Uncategorised", "missing-notes": "Missing notes", priced: "Priced Items",
    "added-30": "Added this month", "added-90": "Added 1–3 months ago",
    "added-365": "Added 3–12 months ago", "added-older": "Added over a year ago",
  };
  return labels[filter];
}

function itemNeedsDetails(item: Item): boolean {
  return item.location_public_id === "unassigned";
}

function restockQuantity(item: Item): string {
  const current = Number(item.quantity);
  const threshold = item.low_stock_threshold === null ? current : Number(item.low_stock_threshold);
  return String(Math.max(1, Math.ceil(threshold - current)));
}

function firstLocationPart(item: Item): string {
  return item.location_path.split(">").map((part) => part.trim()).filter(Boolean)[0] || "Unassigned";
}

function groupLabel(item: Item, groupBy: InventoryGroup): string {
  if (groupBy === "room") return firstLocationPart(item);
  if (groupBy === "location") return item.location_path || "Unassigned";
  if (groupBy === "category") return categoryLabel(item) || "Uncategorised";
  if (groupBy === "unit") return item.unit || "No unit";
  return "";
}

function categoryDescendantIds(categories: Category[], rootId: number): Set<number> {
  const result = new Set<number>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (category.parent_id !== null && result.has(category.parent_id) && !result.has(category.id)) {
        result.add(category.id);
        changed = true;
      }
    }
  }
  return result;
}

function loadInventoryPrefs(): InventoryViewPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(INVENTORY_PREFS_KEY) || "null") as Partial<InventoryViewPrefs> | null;
    const groups: InventoryGroup[] = ["none", "room", "location", "category", "tag", "unit"];
    const sorts: InventorySort[] = ["updated", "name", "location", "quantity-asc", "quantity-desc", "expiration"];
    return {
      groupBy: parsed?.groupBy && groups.includes(parsed.groupBy) ? parsed.groupBy : "none",
      sortBy: parsed?.sortBy && sorts.includes(parsed.sortBy) ? parsed.sortBy : "updated",
    };
  } catch {
    return { groupBy: "none", sortBy: "updated" };
  }
}

function saveInventoryPrefs(prefs: InventoryViewPrefs): void {
  try { localStorage.setItem(INVENTORY_PREFS_KEY, JSON.stringify(prefs)); }
  catch { /* Preference storage is best-effort. */ }
}

export function InventoryView({
  items,
  locations,
  categories,
  totalItemCount,
  detailsTotalCount,
  query,
  setQuery,
  onSearch,
  run,
  busy,
  isSearchBusy,
  onOpen,
  onBulkStart,
  onAdd,
  onFindLost,
  hasMore,
  onLoadMore,
  onQuickAdjust,
  onAddShopping,
  onDeleteItem,
  includeZero,
  onIncludeZeroChange,
  initialFilter,
  initialCategoryId,
  initialTag,
  pendingItems,
}: {
  items: Item[];
  locations: LocationNode[];
  categories: Category[];
  totalItemCount: number;
  detailsTotalCount: number;
  query: string;
  setQuery: (value: string) => void;
  onSearch: (query: string, options?: InventorySearchOptions) => void;
  run: (action: () => Promise<unknown>, success: string, scope?: RefreshScope, options?: ActionOptions) => Promise<void>;
  busy: boolean;
  isSearchBusy: boolean;
  onOpen: (item: Item) => void;
  onBulkStart: () => void;
  onAdd: () => void;
  onFindLost: () => void;
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
  onQuickAdjust: (item: Item, delta: number) => Promise<void>;
  onAddShopping: (item: Item) => Promise<void>;
  onDeleteItem: (item: Item) => Promise<void>;
  includeZero: boolean;
  onIncludeZeroChange: (value: boolean) => void;
  initialFilter: InventoryFilter;
  initialCategoryId: number | null;
  initialTag: string;
  pendingItems: Set<string>;
}) {
  const initialPrefs = useMemo(loadInventoryPrefs, []);
  const [filter, setFilter] = useState<InventoryFilter>(initialFilter);
  const [groupBy, setGroupBy] = useState<InventoryGroup>(initialPrefs.groupBy);
  const [sortBy, setSortBy] = useState<InventorySort>(initialPrefs.sortBy);
  const [tagFilter, setTagFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [filterPicker, setFilterPicker] = useState<"category" | "tag" | "location" | null>(null);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [formula, setFormula] = useState<InventoryFormula>(emptyInventoryFormula);
  const [savedViews, setSavedViews] = useState<SavedInventoryView[]>(loadSavedInventoryViews);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelection, setBulkSelection] = useState<Set<string>>(() => new Set());
  const [bulkPicker, setBulkPicker] = useState<"category" | "location" | "remove-tag" | null>(null);
  const [renderLimit, setRenderLimit] = useState(INITIAL_RESULT_WINDOW);
  const deferredQuery = useDeferredValue(query);
  const lastBackgroundSearch = useRef(query.trim());
  useEffect(() => setFilter(initialFilter), [initialFilter]);
  useEffect(() => {
    if (initialCategoryId !== null) setCategoryFilter(String(initialCategoryId));
  }, [initialCategoryId]);
  useEffect(() => setTagFilter(initialTag), [initialTag]);
  useEffect(() => {
    if (categoryFilter && !categories.some((category) => String(category.id) === categoryFilter)) {
      setCategoryFilter("");
    }
  }, [categories, categoryFilter]);
  useEffect(() => {
    saveInventoryPrefs({ groupBy, sortBy });
  }, [groupBy, sortBy]);
  useEffect(() => {
    const trimmed = query.trim();
    const nextSearch = trimmed.length >= 2 ? trimmed : "";
    if (lastBackgroundSearch.current === nextSearch) return;
    const timeout = window.setTimeout(() => {
      lastBackgroundSearch.current = nextSearch;
      onSearch(nextSearch, { showBusy: false });
    }, nextSearch ? 420 : 260);
    return () => window.clearTimeout(timeout);
  }, [onSearch, query]);
  const indexedItems = useMemo(() => items.map((item) => ({
    item,
    expiration: expirationTime(item),
    expirationDays: expirationDays(item),
    expiring: expirationState(item) !== null,
    lowStock: isLowStock(item),
    needsDetails: itemNeedsDetails(item),
    quantity: Number(item.quantity),
    updated: new Date(item.updated_at).getTime(),
  })), [items]);
  const lowStockCount = useMemo(() => indexedItems.filter((entry) => entry.lowStock).length, [indexedItems]);
  const expiringCount = useMemo(() => indexedItems.filter((entry) => entry.expiring).length, [indexedItems]);
  const detailsCount = useMemo(() => indexedItems.filter((entry) => entry.needsDetails).length, [indexedItems]);
  const displayedDetailsCount = Math.max(detailsCount, detailsTotalCount);
  const allCount = Math.max(items.length, totalItemCount);
  const tags = useMemo(() => Array.from(new Set(indexedItems.flatMap(({ item }) => item.tags))).sort((a, b) => a.localeCompare(b)), [indexedItems]);
  const selectedCategory = useMemo(() => (
    categoryFilter ? categories.find((category) => String(category.id) === categoryFilter) || null : null
  ), [categories, categoryFilter]);
  const flatInventoryLocations = useMemo(() => flattenLocations(locations), [locations]);
  const selectedLocation = useMemo(() => (
    locationFilter ? flatInventoryLocations.find((location) => location.public_id === locationFilter) || null : null
  ), [flatInventoryLocations, locationFilter]);
  useEffect(() => {
    if (locationFilter && !selectedLocation) setLocationFilter("");
  }, [locationFilter, selectedLocation]);
  const selectedCategoryIds = useMemo(() => (
    categoryFilter ? categoryDescendantIds(categories, Number(categoryFilter)) : null
  ), [categories, categoryFilter]);
  const searchTerm = deferredQuery.trim().toLowerCase();
  const formulaValidation = useMemo(() => validateInventoryFormula(formula.source), [formula.source]);
  const hasScope = Boolean(
    searchTerm || filter !== "all" || tagFilter || categoryFilter || locationFilter || groupBy !== "none" || sortBy !== "updated" || formula.source.trim(),
  );
  useEffect(() => {
    setRenderLimit(INITIAL_RESULT_WINDOW);
  }, [categoryFilter, filter, formula, groupBy, items.length, locationFilter, searchTerm, sortBy, tagFilter]);
  const filteredEntries = useMemo(() => indexedItems.filter((entry) => {
    const { item } = entry;
    if (filter === "low" && !entry.lowStock) return false;
    if (filter === "expiring" && !entry.expiring) return false;
    if (filter === "details" && !entry.needsDetails) return false;
    if (filter === "zero" && entry.quantity > 0) return false;
    if (filter === "in-stock" && (entry.quantity <= 0 || entry.lowStock)) return false;
    if (filter === "expired" && (entry.expirationDays === null || entry.expirationDays >= 0)) return false;
    if (filter === "expiring-week" && (entry.expirationDays === null || entry.expirationDays < 0 || entry.expirationDays > 7)) return false;
    if (filter === "expiring-30" && (entry.expirationDays === null || entry.expirationDays < 0 || entry.expirationDays > 30)) return false;
    if (filter === "expiry-8-30" && (entry.expirationDays === null || entry.expirationDays <= 7 || entry.expirationDays > 30)) return false;
    if (filter === "expiry-31-90" && (entry.expirationDays === null || entry.expirationDays <= 30 || entry.expirationDays > 90)) return false;
    if (filter === "expiry-later" && (entry.expirationDays === null || entry.expirationDays <= 90)) return false;
    if (filter === "no-expiry" && item.expiration_date) return false;
    if (filter === "missing-photo" && item.primary_photo_url) return false;
    if (filter === "uncategorized" && item.category_id !== null) return false;
    if (filter === "missing-notes" && (item.description || item.notes)) return false;
    if (filter === "priced" && item.purchase_price_minor === null && item.estimated_price_minor === null) return false;
    const ageDays = Math.floor((Date.now() - new Date(item.created_at).getTime()) / 86400000);
    if (filter === "added-30" && ageDays > 30) return false;
    if (filter === "added-90" && (ageDays <= 30 || ageDays > 90)) return false;
    if (filter === "added-365" && (ageDays <= 90 || ageDays > 365)) return false;
    if (filter === "added-older" && ageDays <= 365) return false;
    if (tagFilter && !item.tags.includes(tagFilter)) return false;
    if (selectedLocation && item.location_public_id !== selectedLocation.public_id && !item.location_path.startsWith(`${selectedLocation.path} > `)) return false;
    if (selectedCategoryIds && (item.category_id === null || !selectedCategoryIds.has(item.category_id))) {
      return false;
    }
    if (formula.source.trim() && (!formulaValidation.node || !inventoryFormulaMatches(item, formulaValidation.node))) return false;
    return true;
  }), [filter, formula.source, formulaValidation.node, indexedItems, searchTerm, selectedCategoryIds, selectedLocation, tagFilter]);
  const sortedEntries = useMemo(() => {
    const sorted = [...filteredEntries];
    sorted.sort((left, right) => {
      if (sortBy === "name") return left.item.name.localeCompare(right.item.name);
      if (sortBy === "location") return left.item.location_path.localeCompare(right.item.location_path) || left.item.name.localeCompare(right.item.name);
      if (sortBy === "quantity-asc") return left.quantity - right.quantity || left.item.name.localeCompare(right.item.name);
      if (sortBy === "quantity-desc") return right.quantity - left.quantity || left.item.name.localeCompare(right.item.name);
      if (sortBy === "expiration") return left.expiration - right.expiration || left.item.name.localeCompare(right.item.name);
      return right.updated - left.updated;
    });
    return sorted;
  }, [filteredEntries, sortBy]);
  const visibleItems = useMemo(() => sortedEntries.slice(0, renderLimit).map((entry) => entry.item), [renderLimit, sortedEntries]);
  const hiddenResultCount = Math.max(0, sortedEntries.length - visibleItems.length);
  const showingSearchPlaceholder = isSearchBusy && query.trim().length > 0;
  const groupedItems = useMemo(() => {
    const groups = new Map<string, Item[]>();
    for (const item of visibleItems) {
      const keys = groupBy === "tag" && item.tags.length > 0 ? item.tags : [groupLabel(item, groupBy)];
      for (const key of keys) {
        const label = key || "Other";
        groups.set(label, [...(groups.get(label) || []), item]);
      }
    }
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [groupBy, visibleItems]);
  function requestSearch(value: string, options: InventorySearchOptions = {}) {
    const nextSearch = value.trim();
    lastBackgroundSearch.current = nextSearch.length >= 2 ? nextSearch : "";
    onSearch(value, options);
  }
  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextQuery = String(formData.get("inventory-search") || "");
    setQuery(nextQuery);
    requestSearch(nextQuery, { showBusy: true });
  }
  function clearAllScope() {
    setFilter("all");
    setGroupBy("none");
    setSortBy("updated");
    setTagFilter("");
    setCategoryFilter("");
    setLocationFilter("");
    setFormula(emptyInventoryFormula());
    onIncludeZeroChange(false);
    setQuery("");
    requestSearch("", { showBusy: true });
  }
  function toggleBulkItem(publicId: string) {
    setBulkSelection((current) => {
      const next = new Set(current);
      if (next.has(publicId)) next.delete(publicId); else next.add(publicId);
      return next;
    });
  }
  function leaveBulkMode() {
    setBulkMode(false);
    setBulkSelection(new Set());
    setBulkPicker(null);
  }
  async function performBulk(
    label: string,
    action: (item: Item) => Promise<unknown>,
    undo?: (current: Item, original: Item) => Promise<unknown>,
  ) {
    const selected = items.filter((item) => bulkSelection.has(item.public_id));
    if (!selected.length) return;
    await run(async () => {
      for (const item of selected) await action(item);
    }, `${label}: ${selected.length} item${selected.length === 1 ? "" : "s"}`, "inventory", {
      progress: `${label} ${selected.length} item${selected.length === 1 ? "" : "s"}…`,
      undo: undo ? async () => {
        for (const original of selected) {
          const current = await api.item(original.public_id);
          await undo(current, original);
        }
      } : undefined,
    });
    leaveBulkMode();
  }
  function saveCurrentView(name: string, nextFormula: InventoryFormula) {
    if (!name.trim()) return;
    const next: SavedInventoryView = {
      id: uid("view"), name: name.trim(), formula: cloneFormula(nextFormula), query, filter, groupBy, sortBy,
      categoryFilter, locationFilter, tagFilter, includeZero,
    };
    setSavedViews((current) => {
      const updated = [...current, next];
      saveSavedInventoryViews(updated);
      return updated;
    });
  }
  function applySavedView(saved: SavedInventoryView) {
    setFormula(cloneFormula(saved.formula));
    setQuery(saved.query);
    setFilter(saved.filter);
    setGroupBy(saved.groupBy);
    setSortBy(saved.sortBy);
    setCategoryFilter(saved.categoryFilter);
    setLocationFilter(saved.locationFilter);
    setTagFilter(saved.tagFilter);
    onIncludeZeroChange(saved.includeZero);
    requestSearch(saved.query, { showBusy: true });
  }
  function deleteSavedView(id: string) {
    setSavedViews((current) => {
      const updated = current.filter((view) => view.id !== id);
      saveSavedInventoryViews(updated);
      return updated;
    });
  }
  function exportBulkSelection() {
    const selected = items.filter((item) => bulkSelection.has(item.public_id));
    const cell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["Name", "Brand", "Quantity", "Unit", "Category", "Location", "Tags", "Barcode", "Expiration"],
      ...selected.map((item) => [item.name, item.brand, item.quantity, item.unit, item.category_path || "", item.location_path, item.tags.join(", "), item.barcode, item.expiration_date || ""]),
    ];
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.map(cell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `findstuff-selection-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="inventory-page">
      <h1 className="sr-only">Inventory</h1>
      <div className="search-hero">
        <form className="search search-large" onSubmit={submitSearch}>
          <Icon name="search" size={21} />
          <input
            type="search"
            name="inventory-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ESP32, pasta, drill…"
            aria-label="Search inventory"
          />
          {query && <button type="button" className="clear-search" onClick={() => { setQuery(""); requestSearch("", { showBusy: true }); }} aria-label="Clear search"><Icon name="close" size={17} /></button>}
          <button type="submit" className="primary search-submit" aria-busy={busy}>Find</button>
        </form>
      </div>
      <div className="inventory-command-row">
        <div className="saved-view-strip" aria-label="Saved inventory views">
          <span>Views</span>
          {savedViews.map((saved) => <div className="saved-view-chip" key={saved.id}><button type="button" onClick={() => applySavedView(saved)}>{saved.name}</button><button type="button" onClick={() => deleteSavedView(saved.id)} aria-label={`Delete ${saved.name}`}><Icon name="close" size={13} /></button></div>)}
          {savedViews.length === 0 && <small>Save a formula and its layout</small>}
        </div>
        <div className="inventory-mode-actions">
          <button type="button" className={formula.source.trim() ? "active" : ""} onClick={() => setFormulaOpen(true)}><Icon name="filter" size={16} />Formula</button>
          <button type="button" className="clear-inventory-filters" onClick={clearAllScope} disabled={!hasScope && !includeZero}><Icon name="close" size={16} />Clear all</button>
          <button type="button" className={bulkMode ? "active" : ""} onClick={() => { if (bulkMode) leaveBulkMode(); else { onBulkStart(); setBulkMode(true); } }}><Icon name={bulkMode ? "close" : "check"} size={16} />{bulkMode ? "Exit bulk" : "Bulk mode"}</button>
        </div>
      </div>
      {bulkMode && <div className="bulk-mode-banner" role="status"><span><Icon name="check" size={18} /><strong>Bulk action mode</strong><small>Items select instead of opening.</small></span><button type="button" onClick={() => setBulkSelection(new Set(visibleItems.map((item) => item.public_id)))}>Select visible</button><button type="button" onClick={() => setBulkSelection(new Set())}>Clear</button></div>}
      <div className="filter-row" role="group" aria-label="Filter inventory">
        <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All <span>{allCount}</span></button>
        <button className={filter === "low" ? "active" : ""} onClick={() => setFilter("low")}>Low stock <span>{lowStockCount}</span></button>
        <button className={filter === "expiring" ? "active" : ""} onClick={() => setFilter("expiring")}>Expiring <span>{expiringCount}</span></button>
        <button className={filter === "details" ? "active" : ""} onClick={() => setFilter("details")}>Needs details <span>{displayedDetailsCount}</span></button>
      </div>
      <div className="view-toolbar compact-inventory-toolbar">
        <label><span>Sort</span><select aria-label="Sort Items" value={sortBy} onChange={(event) => setSortBy(event.target.value as InventorySort)}><option value="updated">Recent</option><option value="name">Name</option><option value="location">Place</option><option value="quantity-asc">Qty ↑</option><option value="quantity-desc">Qty ↓</option><option value="expiration">Expires</option></select></label>
        <label><span>Group</span><select aria-label="Group Items" value={groupBy} onChange={(event) => setGroupBy(event.target.value as InventoryGroup)}><option value="none">None</option><option value="room">Room</option><option value="location">Place</option><option value="category">Category</option><option value="tag">Tag</option><option value="unit">Unit</option></select></label>
        <div className="filter-choice"><span>Category</span><button type="button" onClick={() => setFilterPicker("category")}><Icon name="tag" size={16} /><strong>{selectedCategory ? categoryOptionLabel(selectedCategory) : "Any category"}</strong><Icon name="chevron" size={15} /></button></div>
        <div className="filter-choice"><span>Place</span><button type="button" onClick={() => setFilterPicker("location")}><Icon name="pin" size={16} /><strong>{selectedLocation?.path || "Any Place"}</strong><Icon name="chevron" size={15} /></button></div>
        <div className="filter-choice"><span>Tag</span><button type="button" onClick={() => setFilterPicker("tag")}><Icon name="tag" size={16} /><strong>{tagFilter || "Any tag"}</strong><Icon name="chevron" size={15} /></button></div>
        <label className="toolbar-toggle"><span>Zero qty</span><input type="checkbox" checked={includeZero} onChange={(event) => onIncludeZeroChange(event.target.checked)} /></label>
      </div>
      {hasScope && <div className="active-filter-row" aria-label="Active inventory filters">
        <span><Icon name="filter" size={15} />Showing</span>
        {query.trim() && <button type="button" onClick={() => { setQuery(""); requestSearch("", { showBusy: true }); }}>Search: {query.trim()}</button>}
        {filter !== "all" && <button type="button" onClick={() => setFilter("all")}>{inventoryFilterLabel(filter)}</button>}
        {sortBy !== "updated" && <button type="button" onClick={() => setSortBy("updated")}>Sorted by {sortBy.replace("-", " ")}</button>}
        {selectedCategory && <button type="button" onClick={() => setCategoryFilter("")}>{categoryOptionLabel(selectedCategory)} + children</button>}
        {selectedLocation && <button type="button" onClick={() => setLocationFilter("")}>{selectedLocation.path} + inside</button>}
        {tagFilter && <button type="button" onClick={() => setTagFilter("")}>#{tagFilter}</button>}
        {formula.source.trim() && <button type="button" onClick={() => setFormulaOpen(true)}>Formula applied</button>}
        {groupBy !== "none" && <button type="button" onClick={() => setGroupBy("none")}>Grouped by {groupBy}</button>}
      </div>}
      <div className="section-heading">
        <h2>{query ? "Search results" : filter === "all" ? "Everything" : inventoryFilterLabel(filter)}</h2>
        <span>{showingSearchPlaceholder ? "Searching..." : `${visibleItems.length === sortedEntries.length ? sortedEntries.length : `${visibleItems.length} of ${sortedEntries.length}`} ${sortedEntries.length === 1 ? "item" : "items"}`}</span>
      </div>
      <div className="item-list">
        {showingSearchPlaceholder
          ? <div className="empty-inline"><span>Searching Items…</span></div>
          : visibleItems.length === 0 && query.trim()
            ? <SearchFeedback query={query.trim()} onAdd={onAdd} onFindLost={onFindLost} />
            : visibleItems.length === 0 && <EmptyState icon={hasScope ? "box" : "search"} title={hasScope ? "Nothing needs attention" : "No Items yet"} text={hasScope ? "You’re all caught up." : "Add an Item and it will appear here."} action={items.length === 0 ? { label: "Add first Item", onClick: onAdd } : undefined} />}
        {!showingSearchPlaceholder && (groupBy === "none" ? [["", visibleItems] as [string, Item[]]] : groupedItems).map(([group, groupItems]) => <div className="inventory-group" key={group || "all"}>{group && <h3>{group}<span>{groupItems.length}</span></h3>}{groupItems.map((item) => (
          <article className={`item-card ${expirationState(item) === "expired" || isLowStock(item) ? "needs-attention" : ""} ${pendingItems.has(item.public_id) ? "syncing" : ""} ${bulkMode ? "bulk-selectable" : ""} ${bulkSelection.has(item.public_id) ? "selected" : ""}`} key={item.public_id}>
            <button className="item-main" onClick={() => bulkMode ? toggleBulkItem(item.public_id) : onOpen(item)} aria-pressed={bulkMode ? bulkSelection.has(item.public_id) : undefined}>
              {bulkMode && <span className="bulk-check" aria-hidden="true">{bulkSelection.has(item.public_id) ? <Icon name="check" size={17} /> : null}</span>}
              <div className={`item-icon ${item.primary_photo_url ? "item-photo" : ""}`} aria-hidden="true">{item.primary_photo_url ? <img src={item.primary_photo_url} alt="" loading="lazy" /> : <Icon name="box" size={21} />}</div>
              <div className="item-copy">
                <div className="item-name-line"><h3>{item.name}</h3>{isLowStock(item) && <span className="status-badge warning">Low</span>}{expirationState(item) && <span className={`status-badge ${expirationState(item)}`}>{expirationState(item) === "expired" ? "Expired" : expirationCopy(item)}</span>}{categoryLabel(item) && <span className="status-badge quiet">{categoryLabel(item)}</span>}</div>
                <p className="location-line"><Icon name="pin" size={13} />{item.location_path}</p>
                {(item.brand || item.model) && <p className="muted">{[item.brand, item.model].filter(Boolean).join(" · ")}</p>}
              </div>
              <span className="quantity"><strong>{item.quantity}</strong><small>{item.unit}</small></span>
              <Icon name="chevron" size={17} />
            </button>
            {!bulkMode && <div className={`quick-actions ${isLowStock(item) ? "has-shopping" : ""}`}>
              <button aria-label={`Remove one ${item.name}`} disabled={Number(item.quantity) <= 0} onClick={() => void onQuickAdjust(item, -1)}><Icon name="minus" size={16} /> <span>1</span></button>
              <button aria-label={`Add one ${item.name}`} onClick={() => void onQuickAdjust(item, 1)}><Icon name="plus" size={16} /> <span>1</span></button>
              <button className="move-action" disabled={busy} onClick={() => onOpen(item)}><Icon name="pin" size={15} />Move</button>
              <button className="delete-action" disabled={busy} onClick={() => void onDeleteItem(item)}><Icon name="close" size={15} />Delete</button>
              {isLowStock(item) && <button className="shopping-action" onClick={() => void onAddShopping(item)}><Icon name="plus" size={15} />List {restockQuantity(item)} {item.unit}</button>}
            </div>}
          </article>
        ))}</div>)}
        {!showingSearchPlaceholder && hiddenResultCount > 0 && <button type="button" className="load-more-results" onClick={() => setRenderLimit((current) => current + RESULT_WINDOW_STEP)}>Show {Math.min(RESULT_WINDOW_STEP, hiddenResultCount)} more</button>}
        {!showingSearchPlaceholder && hiddenResultCount === 0 && hasMore && !query.trim() && <button type="button" className="load-more-results" disabled={isSearchBusy} onClick={() => void onLoadMore()}>{isSearchBusy ? "Loading…" : "Load more from Findstuff"}</button>}
      </div>
      {filterPicker === "category" && <SearchableFilterPicker title="Filter by category" icon="tag" selectedId={categoryFilter} emptyLabel="Any category" options={categories.map((category) => ({ id: String(category.id), label: category.name, detail: `${category.path} · ${category.total_item_count} item${category.total_item_count === 1 ? "" : "s"}` }))} onChoose={setCategoryFilter} onClose={() => setFilterPicker(null)} />}
      {filterPicker === "location" && <SearchableFilterPicker title="Filter by Place" icon="pin" selectedId={locationFilter} emptyLabel="Any Place" options={flatInventoryLocations.map((location) => ({ id: location.public_id, label: location.name, detail: `${location.path} · ${location.total_item_count ?? location.item_count ?? 0} Items inside` }))} onChoose={setLocationFilter} onClose={() => setFilterPicker(null)} />}
      {filterPicker === "tag" && <SearchableFilterPicker title="Filter by tag" icon="tag" selectedId={tagFilter} emptyLabel="Any tag" options={tags.map((tag) => ({ id: tag, label: tag, detail: `${indexedItems.filter(({ item }) => item.tags.includes(tag)).length} matching items` }))} onChoose={setTagFilter} onClose={() => setFilterPicker(null)} />}
      {formulaOpen && <FormulaBuilder formula={formula} categories={categories} locations={flatInventoryLocations} tags={tags} units={Array.from(new Set(items.map((item) => item.unit))).sort()} onApply={(next) => { setFormula(next); setFormulaOpen(false); requestSearch(query, { showBusy: true }); }} onSave={(name, next) => { saveCurrentView(name, next); setFormula(next); setFormulaOpen(false); requestSearch(query, { showBusy: true }); }} onClose={() => setFormulaOpen(false)} />}
      {bulkMode && bulkSelection.size > 0 && <div className="bulk-action-dock" aria-label="Bulk actions"><strong>{bulkSelection.size}<small>selected</small></strong><button type="button" onClick={() => setBulkPicker("location")}><Icon name="pin" size={17} />Move</button><button type="button" onClick={() => setBulkPicker("category")}><Icon name="tag" size={17} />Category</button><button type="button" onClick={() => { const tag = window.prompt("Tag to add to the selected items"); if (tag?.trim()) void performBulk("Tagged", (item) => api.setTags(item, Array.from(new Set([...item.tags, tag.trim()]))), (current, original) => api.setTags(current, original.tags)); }}><Icon name="plus" size={17} />Add tag</button><button type="button" onClick={() => setBulkPicker("remove-tag")}><Icon name="minus" size={17} />Remove tag</button><button type="button" onClick={() => { const value = window.prompt("Quantity adjustment for every selected item (for example: 2 or -1)", "1"); const delta = Number(value?.replace(",", ".")); if (value && Number.isFinite(delta) && delta !== 0) void performBulk("Updated", (item) => api.adjust(item, delta), (current) => api.adjust(current, -delta)); }}><Icon name="plus" size={17} />Quantity</button><button type="button" onClick={exportBulkSelection}><Icon name="more" size={17} />Export</button><button type="button" className="danger" onClick={() => { if (window.confirm(`Archive ${bulkSelection.size} selected items?`)) void performBulk("Archived", api.archive, (_current, original) => api.restoreItem(original.public_id)); }}><Icon name="close" size={17} />Archive</button></div>}
      {bulkPicker === "location" && <SearchableFilterPicker title="Move selected Items" icon="pin" selectedId="" emptyLabel="Cancel" options={flatInventoryLocations.map((location) => ({ id: location.public_id, label: location.name, detail: location.path }))} onChoose={(id) => { if (id) void performBulk("Moved", (item) => api.move(item, id), (current, original) => api.move(current, original.location_public_id)); }} onClose={() => setBulkPicker(null)} />}
      {bulkPicker === "category" && <SearchableFilterPicker title="Change Category" icon="tag" selectedId="" emptyLabel="No Category" options={categories.map((category) => ({ id: String(category.id), label: category.name, detail: category.path }))} onChoose={(id) => { void performBulk("Category updated", (item) => api.updateItem(item, { category_id: id ? Number(id) : null }), (current, original) => api.updateItem(current, { category_id: original.category_id })); }} onClose={() => setBulkPicker(null)} />}
      {bulkPicker === "remove-tag" && <SearchableFilterPicker title="Remove a tag from selected Items" icon="tag" selectedId="" emptyLabel="Cancel" options={Array.from(new Set(items.filter((item) => bulkSelection.has(item.public_id)).flatMap((item) => item.tags))).sort().map((tag) => ({ id: tag, label: tag }))} onChoose={(tag) => { if (tag) void performBulk("Tag removed", (item) => api.setTags(item, item.tags.filter((entry) => entry !== tag)), (current, original) => api.setTags(current, original.tags)); }} onClose={() => setBulkPicker(null)} />}
    </section>
  );
}

function formulaGuideMarkdown(categories: Category[], locations: LocationNode[], tags: string[], units: string[]): string {
  const values = (entries: string[]) => entries.length ? entries.map((entry) => `- \`${entry.replaceAll("`", "\\`")}\``).join("\n") : "- No values currently exist.";
  return `# Findstuff inventory formula language

Use this language in **Inventory → Formula**. Keywords are case-insensitive. Text comparisons are also case-insensitive.

## Fields

| Field | Meaning | Value type |
|---|---|---|
| \`name\` | Item name | text |
| \`brand\` | Brand | text |
| \`model\` | Model | text |
| \`serial\` | Serial number | text |
| \`description\` | Description | text |
| \`notes\` | Notes | text |
| \`category\` | Full category path | text |
| \`location\` | Full location path | text |
| \`tag\` or \`tags\` | Any tag on the item | text/list |
| \`quantity\` or \`qty\` | Current quantity | number |
| \`unit\` | Quantity unit | text |
| \`value\` or \`price\` | Estimated price, falling back to purchase price | number |
| \`weight\` | Weight in grams | number |
| \`length\`, \`width\`, \`height\` | Dimensions in millimetres | number |
| \`expiration\` or \`expires\` | Expiration date | YYYY-MM-DD |
| \`barcode\` | Barcode text | text |
| \`updated\` | Last update date | YYYY-MM-DD |
| \`low_stock\` | Whether the item is low stock | true/false |
| \`has_photo\` | Whether the item has a photo | true/false |
| \`missing_location\` | Whether the item is unassigned | true/false |

## Operators

- Equality: \`=\`, \`==\`, \`!=\`
- Numeric comparisons: \`>\`, \`>=\`, \`<\`, \`<=\`
- Text matching: \`CONTAINS\`, \`NOT CONTAINS\`
- Multiple choices: \`IN ["choice 1", "choice 2"]\`, \`NOT IN [...]\`
- Dates: \`BEFORE YYYY-MM-DD\`, \`AFTER YYYY-MM-DD\`
- Missing values: \`IS EMPTY\`, \`IS NOT EMPTY\`
- Logic: \`AND\`, \`OR\`, \`NOT\`
- Use parentheses to control precedence. \`NOT\` runs first, then \`AND\`, then \`OR\`.

Quote text containing spaces, commas, or parentheses. Both single and double quotes are accepted.

## Examples

\`category IN ["Food & Groceries", "Electronics"]\`

\`quantity <= 2 AND unit = "pcs"\`

\`(tag = "urgent" OR tag = "restock") AND location CONTAINS "Garage"\`

\`expiration BEFORE 2026-12-31 AND expiration IS NOT EMPTY\`

\`value >= 50 AND brand NOT CONTAINS "generic"\`

\`NOT (category CONTAINS "Food" OR tag = "consumable")\`

## Current category paths

${values(categories.map((entry) => entry.path))}

## Current location paths

${values(locations.map((entry) => entry.path))}

## Current tags

${values(tags)}

## Current units

${values(units)}

## Instructions for an AI

Return only one Findstuff formula, without a Markdown code fence or explanation. Use only the fields and operators documented above. Quote text values and add parentheses whenever AND and OR are mixed.
`;
}

function FormulaBuilder({ formula, categories, locations, tags, units, onApply, onSave, onClose }: {
  formula: InventoryFormula;
  categories: Category[];
  locations: LocationNode[];
  tags: string[];
  units: string[];
  onApply: (formula: InventoryFormula) => void;
  onSave: (name: string, formula: InventoryFormula) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState(formula.source);
  const [viewName, setViewName] = useState("");
  const validation = useMemo(() => validateInventoryFormula(source), [source]);
  const valid = !validation.error;
  function exportGuide() {
    const url = URL.createObjectURL(new Blob([formulaGuideMarkdown(categories, locations, tags, units)], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "findstuff-formula-language.md";
    link.click();
    URL.revokeObjectURL(url);
  }
  return <div className="modal-backdrop picker-backdrop formula-backdrop" role="dialog" aria-modal="true" aria-label="Advanced inventory formula" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <article className="picker-sheet formula-sheet text-formula-sheet">
      <header><button type="button" className="icon-button" onClick={onClose} aria-label="Close formula"><Icon name="close" size={17} /></button><div><p className="eyebrow">ADVANCED FILTER</p><h2>Formula editor</h2><small>Type a formula directly. It is checked before it can be applied or saved.</small></div><button type="button" className="formula-guide-button" onClick={exportGuide}><Icon name="more" size={16} />Export guide (.md)</button></header>
      <label className="formula-text-label"><span>Formula</span><textarea autoFocus spellCheck={false} value={source} onChange={(event) => setSource(event.target.value)} placeholder={'(category IN ["Electronics", "Tools"] OR tag = "important") AND quantity > 0'} /></label>
      <div className={`formula-validation ${valid ? "valid" : "invalid"}`} role="status"><Icon name={valid ? "check" : "close"} size={17} /><span><strong>{valid ? source.trim() ? "Formula is valid" : "No formula — all items match" : "Formula needs attention"}</strong><small>{validation.error || "Keywords and text matching are case-insensitive."}</small></span></div>
      <div className="formula-language-hint"><code>AND · OR · NOT · = · != · &gt; · &gt;= · &lt; · &lt;= · CONTAINS · IN […] · BEFORE · AFTER · IS EMPTY</code><small>The exported guide includes the complete syntax and your current categories, locations, tags, and units.</small></div>
      <div className="formula-save-view"><label><span>Saved view name</span><input value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="Example: Workshop low stock" /></label><button type="button" disabled={!valid || !viewName.trim()} onClick={() => onSave(viewName, { source: source.trim() })}>Save named view</button></div>
      <footer><button type="button" onClick={() => setSource("")}>Clear formula</button><button type="button" className="primary" disabled={!valid} onClick={() => onApply({ source: source.trim() })}>Apply formula</button></footer>
    </article>
  </div>;
}
