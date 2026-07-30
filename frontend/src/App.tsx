import { CSSProperties, FormEvent, MutableRefObject, ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import {
  api,
  AICommand,
  AIConnectionDiagnostic,
  AIScanProposal,
  Analytics,
  ApplicationSettings,
  AuthStatus,
  BarcodeResult,
  Bootstrap,
  Category,
  CategoryCapabilities,
  CategoryContents,
  Dashboard,
  flattenLocations,
  HistoryEvent,
  HttpRequestError,
  ImportBatch,
  ImportPreviewDetail,
  Item,
  ItemDocument,
  ItemLot,
  ItemReservation,
  Loan,
  LocationContents,
  LocationNode,
  LocationRule,
  LocationType,
  MaintenanceTask,
  OffCategoryMapping,
  OffCategoryMappingImportResult,
  Photo,
  Project,
  RelatedItem,
  ShoppingEntry,
  SoftwareUpdateStatus,
  Enrichment,
  FullOffProduct,
  EnrichmentSuggestion,
  isAuthenticationError,
  isRequestAborted,
} from "./api";
import { DocumentSection } from "./components/DocumentSection";
import { EmptyState } from "./components/EmptyState";
import { Icon, IconName } from "./components/Icon";
import { SearchFeedback } from "./components/SearchFeedback";
import { SearchAliasManager } from "./components/SearchAliasManager";
import { SearchableFilterPicker } from "./components/SearchableFilterPicker";
import { categoryPickerNodes, HierarchyPicker, locationPickerNodes } from "./components/HierarchyPicker";
import {
  loadPrintQueue,
  loadPrintSettings,
  PrintQueueDialog,
  savePrintQueue,
  savePrintSettings,
  type PrintQueueItem,
  type PrintQueueSettings,
} from "./features/printing/PrintQueueDialog";
import { LoginView } from "./features/auth/LoginView";
import { DashboardView } from "./features/dashboard/DashboardView";
import { AnalyticsView } from "./features/analytics/AnalyticsView";
import { ExtraView } from "./features/shell/ExtraView";
import { AICommandBox } from "./features/capture/AICommandBox";
import { makeOfflineItem, ScanView, type CaptureMode } from "./features/capture/ScanView";
import {
  uid,
  type InventoryFilter,
  type InventoryGroup,
  type InventorySort,
} from "./features/inventory/formula";
import { useInventoryState } from "./features/inventory/useInventoryState";
import { InventoryView } from "./features/inventory/InventoryView";
import {
  deleteOfflineOperation,
  listOfflineOperations,
  loadOfflineSnapshot,
  OfflineOperation,
  offlineOperationId,
  putOfflineOperation,
  saveOfflineSnapshot,
  setOfflineOperationError,
} from "./offline";

type View = "inventory" | "capture" | "add" | "scan" | "places" | "locations" | "location" | "categories" | "category" | "default-rules" | "off-category-mappings" | "ai-inbox" | "dashboard" | "extra" | "analytics" | "manage";
type PlacesSection = "locations" | "categories";
type ThemePreference = "light" | "dark" | "system";
type DetailItemSort = "name" | "quantity-asc" | "quantity-desc" | "location" | "category";
type DetailItemView = "grid" | "list";
type InventorySearchOptions = { showBusy?: boolean };
type AdjustmentQueue = {
  confirmed: Item;
  inFlight: boolean;
  pendingDelta: number;
  timer: number | null;
};
type RefreshScope = "all" | "inventory" | "none";
type RetryNotice = {
  action: () => Promise<void>;
  label: string;
  message: string;
};
type ActionOptions = {
  progress?: string;
  undo?: () => Promise<void>;
};
type CategoryNode = Category & { children: CategoryNode[] };
const LEGACY_APP_CACHE_KEY = "findstuff.appSnapshot.v2";
const THEME_KEY = "findstuff.theme.v1";
const LOST_TAG = "lost";

const EMPTY_DASHBOARD: Dashboard = {
  item_count: 0,
  location_count: 0,
  low_stock_count: 0,
  expiring_count: 0,
  needs_details_count: 0,
  recent_events: [],
};

function hasLostTag(item: Item): boolean {
  return item.tags.some((tag) => tag.toLowerCase() === LOST_TAG);
}

function withLostTag(item: Item): string[] {
  return hasLostTag(item) ? item.tags : [...item.tags, LOST_TAG];
}

function withoutLostTag(item: Item): string[] {
  return item.tags.filter((tag) => tag.toLowerCase() !== LOST_TAG);
}

function friendlyErrorMessage(error: unknown, fallback: string): string {
  if (!navigator.onLine) return "You're offline. The change was not saved.";
  if (!(error instanceof Error)) return fallback;
  if (error.message === "Failed to fetch") return "Could not reach Findstuff. Check the connection and try again.";
  if (error.message.includes("timed out")) return "Findstuff took too long to respond. Please try again.";
  return error.message || fallback;
}

function isOfflineFailure(error: unknown): boolean {
  if (!navigator.onLine) return true;
  return error instanceof Error && (
    error.message === "Failed to fetch"
    || error.message.includes("NetworkError")
    || error.message.includes("Load failed")
  );
}

function activityLabel(action: string): string {
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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return "<1 min";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function BarcodeGraphic({ value }: { value: string }) {
  const barcodeRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    if (!barcodeRef.current) return;
    try {
      JsBarcode(barcodeRef.current, value, {
        format: "auto",
        displayValue: false,
        height: 42,
        width: 1.45,
        margin: 0,
        background: "transparent",
        lineColor: "currentColor",
      });
    } catch {
      JsBarcode(barcodeRef.current, value, {
        format: "CODE128",
        displayValue: false,
        height: 42,
        width: 1.2,
        margin: 0,
        background: "transparent",
        lineColor: "currentColor",
      });
    }
  }, [value]);
  return <div className="rendered-barcode"><svg ref={barcodeRef} role="img" aria-label={`Barcode ${value}`} /><strong>{value}</strong></div>;
}

function isLowStock(item: Item): boolean {
  return item.low_stock_threshold !== null && Number(item.quantity) <= Number(item.low_stock_threshold);
}

function expirationState(item: Item): "expired" | "soon" | null {
  if (!item.expiration_date) return null;
  const days = Math.ceil((new Date(`${item.expiration_date}T23:59:59`).getTime() - Date.now()) / 86400000);
  if (days < 0) return "expired";
  return days <= 7 ? "soon" : null;
}

function expirationDays(item: Item): number | null {
  if (!item.expiration_date) return null;
  return Math.ceil(
    (new Date(`${item.expiration_date}T23:59:59`).getTime() - Date.now()) / 86400000,
  );
}

function inventoryFilterLabel(filter: InventoryFilter): string {
  const labels: Record<InventoryFilter, string> = {
    all: "All Items",
    low: "Low stock",
    expiring: "Expiring",
    details: "No place",
    zero: "Empty stock",
    "in-stock": "In stock",
    expired: "Expired",
    "expiring-week": "Expiring in 7 days",
    "expiring-30": "Expiring in 30 days",
    "expiry-8-30": "Expiring in 8–30 days",
    "expiry-31-90": "Expiring in 31–90 days",
    "expiry-later": "Later expiry",
    "no-expiry": "No expiry date",
    "missing-photo": "Missing photos",
    uncategorized: "Uncategorised",
    "missing-notes": "Missing notes",
    priced: "Priced Items",
    "added-30": "Added this month",
    "added-90": "Added 1–3 months ago",
    "added-365": "Added 3–12 months ago",
    "added-older": "Added over a year ago",
  };
  return labels[filter];
}

function expirationCopy(item: Item): string {
  if (!item.expiration_date) return "";
  const days = Math.ceil((new Date(`${item.expiration_date}T23:59:59`).getTime() - Date.now()) / 86400000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `${days}d left`;
}

function expirationTime(item: Item): number {
  if (!item.expiration_date) return Number.POSITIVE_INFINITY;
  return new Date(`${item.expiration_date}T23:59:59`).getTime();
}

function itemNeedsDetails(item: Item): boolean {
  return item.location_public_id === "unassigned";
}

function addDecimal(value: string, delta: number): string {
  const next = Math.max(0, Number(value.replace(",", ".")) + delta);
  return Number.isInteger(next) ? String(next) : next.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function optimisticQuantity(item: Item, delta: number): Item {
  return { ...item, quantity: addDecimal(item.quantity, delta), version: item.version + 1 };
}

function restockQuantity(item: Item): string {
  const current = Number(item.quantity);
  const threshold = item.low_stock_threshold === null ? current : Number(item.low_stock_threshold);
  const desired = Math.max(1, Math.ceil(threshold - current));
  return String(desired);
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

function categoryLabel(item: Item): string {
  return item.category_path || item.category_name || "";
}

function nutritionLabel(key: string): string {
  return key
    .replace("_100g", "")
    .replace("energy-kcal", "kcal")
    .replace("energy", "energy")
    .replace("saturated-fat", "sat fat")
    .replaceAll("-", " ");
}

function nutritionValueLabel(key: string, value: string | number): string {
  const rendered = String(value);
  if (!rendered || /[a-z%]$/i.test(rendered)) return rendered;
  if (key.includes("energy-kcal")) return `${rendered} kcal`;
  if (key.includes("energy")) return `${rendered} kJ`;
  if (key.endsWith("_100g") || ["fat", "saturated-fat", "carbohydrates", "sugars", "fiber", "proteins", "salt", "sodium"].includes(key)) {
    return `${rendered} g`;
  }
  return rendered;
}

function categoryOptionLabel(category: Category): string {
  return category.path || category.name;
}

function parseLinkText(value: string): Array<{ label: string; url: string }> {
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

function linkText(links: Array<{ label: string; url: string }> = []): string {
  return links.map((link) => `${link.label} | ${link.url}`).join("\n");
}

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

const CATEGORY_DATA_FIELD_LABELS: Record<keyof Omit<CategoryCapabilities, "override" | "inherited_from" | "inherited_label">, string> = {
  expiration: "Expiration",
  batches: "Batches",
  maintenance: "Maintenance",
  reservation: "Reservations",
  enrichment: "Enrichment",
  photos: "Photos",
  identity: "Identity",
  specs: "Specs",
  price: "Prices",
  links: "Links",
  shopping_list: "Shopping list",
};

function capabilitiesForCategory(categories: Category[], categoryId: number | string | null | undefined): CategoryCapabilities {
  if (categoryId === null || categoryId === undefined || categoryId === "") return OPEN_CAPABILITIES;
  return categories.find((category) => category.id === Number(categoryId))?.capabilities || OPEN_CAPABILITIES;
}

function buildCategoryTree(categories: Category[]): CategoryNode[] {
  const nodes = new Map<number, CategoryNode>(
    categories.map((category) => [category.id, { ...category, children: [] }]),
  );
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id === null ? null : nodes.get(node.parent_id);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (entries: CategoryNode[]) => {
    entries.sort((left, right) => categoryOptionLabel(left).localeCompare(categoryOptionLabel(right)));
    entries.forEach((entry) => sortNodes(entry.children));
  };
  sortNodes(roots);
  return roots;
}

function categoryDescendantIds(categories: Category[], rootId: number): Set<number> {
  const result = new Set<number>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (
        category.parent_id !== null &&
        result.has(category.parent_id) &&
        !result.has(category.id)
      ) {
        result.add(category.id);
        changed = true;
      }
    }
  }
  return result;
}

function viewFromParameter(value: string | null): View | null {
  if (!value) return null;
  const views: Record<string, View> = {
    add: "capture",
    capture: "capture",
    categories: "places",
    category: "places",
    dashboard: "dashboard",
    "default-rules": "default-rules",
    defaults: "default-rules",
    find: "inventory",
    home: "dashboard",
    inventory: "inventory",
    locations: "places",
    manage: "manage",
    more: "extra",
    extra: "extra",
    analytics: "analytics",
    "off-category-mappings": "off-category-mappings",
    places: "places",
    scan: "capture",
  };
  return views[value.toLowerCase()] || null;
}

const nav: Array<{ id: View; label: string; icon: IconName }> = [
  { id: "dashboard", label: "Home", icon: "home" },
  { id: "inventory", label: "Inventory", icon: "search" },
  { id: "capture", label: "Capture", icon: "scan" },
  { id: "places", label: "Places", icon: "pin" },
  { id: "extra", label: "Extra", icon: "more" },
];

function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const {
    items,
    setItems,
    query,
    setQuery,
    searchBusy: inventorySearchBusy,
    setSearchBusy: setInventorySearchBusy,
    nextCursor: inventoryNextCursor,
    setNextCursor: setInventoryNextCursor,
    hasMore: inventoryHasMore,
    setHasMore: setInventoryHasMore,
    pendingItems,
    setPendingItems,
    selectedItem,
    setSelectedItem,
    filter: inventoryFilter,
    setFilter: setInventoryFilter,
    categoryId: inventoryCategoryId,
    setCategoryId: setInventoryCategoryId,
    tag: inventoryTag,
    setTag: setInventoryTag,
    includeZero: inventoryIncludeZero,
    setIncludeZero: setInventoryIncludeZero,
  } = useInventoryState();
  const [locations, setLocations] = useState<LocationNode[]>([]);
  const [locationTypes, setLocationTypes] = useState<LocationType[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<string[]>(["pcs", "box", "pack", "bag", "g", "kg", "ml", "l"]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [notice, setNotice] = useState("");
  const [retryNotice, setRetryNotice] = useState<RetryNotice | null>(null);
  const [connectionIssue, setConnectionIssue] = useState("");
  const [busy, setBusy] = useState(false);
  const [activityMessage, setActivityMessage] = useState("");
  const [offlineOperations, setOfflineOperations] = useState<OfflineOperation[]>([]);
  const [offlineMode, setOfflineMode] = useState(!navigator.onLine);
  const [syncingOffline, setSyncingOffline] = useState(false);
  const [addLocation, setAddLocation] = useState("unassigned");
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [captureMode, setCaptureMode] = useState<CaptureMode>("scan");
  const [placesSection, setPlacesSection] = useState<PlacesSection>("locations");
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [printQueue, setPrintQueue] = useState<PrintQueueItem[]>(loadPrintQueue);
  const [printSettings, setPrintSettings] = useState<PrintQueueSettings>(loadPrintSettings);
  const [printQueueOpen, setPrintQueueOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });
  const itemsRef = useRef<Item[]>([]);
  const refreshTimer = useRef<number | null>(null);
  const inventoryRefreshTimer = useRef<number | null>(null);
  const refreshController = useRef<AbortController | null>(null);
  const inventoryRefreshController = useRef<AbortController | null>(null);
  const refreshGeneration = useRef(0);
  const inventoryRefreshGeneration = useRef(0);
  const adjustmentQueue = useRef<Map<string, AdjustmentQueue>>(new Map());
  const previousView = useRef<View>(view);

  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { savePrintQueue(printQueue); }, [printQueue]);
  useEffect(() => { savePrintSettings(printSettings); }, [printSettings]);
  useEffect(() => {
    const applyTheme = () => {
      const resolved = theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
        : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    applyTheme();
    localStorage.setItem(THEME_KEY, theme);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setGlobalSearchOpen(true);
      }
      if (event.key === "/" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        setGlobalSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);
  const navigate = useCallback((nextView: View) => {
    setView(nextView);
    window.scrollTo({ top: 0 });
  }, []);
  const openCapture = useCallback((mode: CaptureMode = "scan", locationId?: string) => {
    setCaptureMode(mode);
    if (locationId) setAddLocation(locationId);
    navigate("capture");
  }, [navigate]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => {
      setNotice("");
      setRetryNotice(null);
    }, retryNotice?.message === notice ? 9000 : 4500);
    return () => window.clearTimeout(timeout);
  }, [notice, retryNotice]);

  const notify = useCallback((message: string, retry?: Omit<RetryNotice, "message">) => {
    setNotice(message);
    setRetryNotice(retry ? { ...retry, message } : null);
  }, []);

  const addLocationToPrintQueue = useCallback((location: LocationNode) => {
    setPrintQueue((current) => {
      const existing = current.find((entry) => entry.publicId === location.public_id);
      if (existing) {
        return current.map((entry) => entry.publicId === location.public_id
          ? { ...entry, name: location.name, path: location.path, kind: location.kind, selected: true }
          : entry);
      }
      return [...current, {
        publicId: location.public_id,
        name: location.name,
        path: location.path,
        kind: location.kind,
        selected: true,
      }];
    });
    notify(`${location.name} added to print queue`);
  }, [notify]);

  const applyBootstrap = useCallback((snapshot: Bootstrap) => {
    setAuth(snapshot.auth);
    setItems(snapshot.items);
    setInventoryNextCursor(snapshot.items_next_cursor ?? null);
    setInventoryHasMore(snapshot.items_has_more ?? false);
    setLocations(snapshot.locations);
    setCategories(snapshot.categories);
    setLocationTypes(snapshot.location_types);
    setDashboard(snapshot.dashboard);
    setUnits(snapshot.units);
    setConnectionIssue("");
  }, []);

  const refresh = useCallback(async (
    search = query,
    options: { showBusy?: boolean } = {},
  ) => {
    const showBusy = options.showBusy ?? true;
    if (refreshTimer.current !== null) {
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
    refreshController.current?.abort();
    const controller = new AbortController();
    const generation = refreshGeneration.current + 1;
    refreshGeneration.current = generation;
    refreshController.current = controller;
    if (showBusy) setBusy(true);
    try {
      const snapshot = await api.bootstrap(search, { signal: controller.signal }, inventoryIncludeZero);
      if (generation !== refreshGeneration.current) return;
      applyBootstrap(snapshot);
      if (showBusy) {
        notify("");
      }
    } catch (error) {
      if (isRequestAborted(error)) return;
      const message = friendlyErrorMessage(error, "Unable to load Findstuff");
      setConnectionIssue(message);
      notify(message, { label: "Retry", action: async () => refresh(search, { showBusy: true }) });
    } finally {
      if (refreshController.current === controller) refreshController.current = null;
      if (showBusy && generation === refreshGeneration.current) setBusy(false);
    }
  }, [applyBootstrap, inventoryIncludeZero, notify, query]);

  const refreshInventory = useCallback(async (
    search = query,
    options: { showBusy?: boolean } = {},
  ) => {
    const showBusy = options.showBusy ?? false;
    if (inventoryRefreshTimer.current !== null) {
      window.clearTimeout(inventoryRefreshTimer.current);
      inventoryRefreshTimer.current = null;
    }
    inventoryRefreshController.current?.abort();
    const controller = new AbortController();
    const generation = inventoryRefreshGeneration.current + 1;
    inventoryRefreshGeneration.current = generation;
    inventoryRefreshController.current = controller;
    if (showBusy) {
      setBusy(true);
      setInventorySearchBusy(true);
    }
    try {
      const inventoryRequest = search.trim()
        ? api.humanSearch(search, inventoryIncludeZero).then((result) => ({
          items: result.items,
          next_cursor: null,
          has_more: false,
        }))
        : api.itemPage("", null, { signal: controller.signal }, { includeZero: inventoryIncludeZero });
      const [nextItems, nextDashboard] = await Promise.allSettled([
        inventoryRequest,
        api.dashboard({ signal: controller.signal }),
      ]);
      if (generation !== inventoryRefreshGeneration.current) return;
      if (nextItems.status === "fulfilled") {
        setItems(nextItems.value.items.map((item) => (
          adjustmentQueue.current.has(item.public_id)
            ? itemsRef.current.find((entry) => entry.public_id === item.public_id) || item
            : item
        )));
        setInventoryNextCursor(nextItems.value.next_cursor);
        setInventoryHasMore(nextItems.value.has_more);
      }
      if (nextDashboard.status === "fulfilled") setDashboard(nextDashboard.value);
      const failure = [nextItems, nextDashboard].find((result) => (
        result.status === "rejected" && !isRequestAborted(result.reason)
      ));
      if (failure?.status === "rejected" && showBusy) {
        notify(friendlyErrorMessage(failure.reason, "Unable to refresh inventory"), {
          label: "Retry",
          action: async () => refreshInventory(search, { showBusy: true }),
        });
      }
    } finally {
      if (inventoryRefreshController.current === controller) inventoryRefreshController.current = null;
      if (showBusy && generation === inventoryRefreshGeneration.current) {
        setBusy(false);
        setInventorySearchBusy(false);
      }
    }
  }, [inventoryIncludeZero, notify, query]);

  const loadMoreInventory = useCallback(async () => {
    if (!inventoryNextCursor || inventorySearchBusy || query.trim()) return;
    setInventorySearchBusy(true);
    try {
      const page = await api.itemPage(
        "",
        inventoryNextCursor,
        undefined,
        { includeZero: inventoryIncludeZero },
      );
      setItems((current) => {
        const seen = new Set(current.map((item) => item.public_id));
        return [...current, ...page.items.filter((item) => !seen.has(item.public_id))];
      });
      setInventoryNextCursor(page.next_cursor);
      setInventoryHasMore(page.has_more);
    } finally {
      setInventorySearchBusy(false);
    }
  }, [inventoryIncludeZero, inventoryNextCursor, inventorySearchBusy, query]);

  const searchInventory = useCallback((value: string, options: InventorySearchOptions = {}) => {
    void refreshInventory(value, { showBusy: options.showBusy ?? true });
  }, [refreshInventory]);

  useEffect(() => {
    const lastView = previousView.current;
    previousView.current = view;
    if (lastView !== "inventory" || view === "inventory") return;
    setInventoryFilter("all");
    setInventoryCategoryId(null);
    setInventoryTag("");
    setInventoryIncludeZero(false);
    setQuery("");
    setSelectedItem(null);
    if (!inventoryIncludeZero) searchInventory("", { showBusy: false });
  }, [inventoryIncludeZero, searchInventory, view]);

  const scheduleRefresh = useCallback((search = query) => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void refresh(search, { showBusy: false });
    }, 300);
  }, [query, refresh]);

  const scheduleInventoryRefresh = useCallback((search = query) => {
    if (inventoryRefreshTimer.current !== null) window.clearTimeout(inventoryRefreshTimer.current);
    inventoryRefreshTimer.current = window.setTimeout(() => {
      inventoryRefreshTimer.current = null;
      void refreshInventory(search, { showBusy: false });
    }, 350);
  }, [query, refreshInventory]);

  const refreshAfterMutation = useCallback((scope: RefreshScope = "inventory") => {
    if (scope === "none") return;
    if (scope === "all") {
      scheduleRefresh();
      return;
    }
    scheduleInventoryRefresh();
  }, [scheduleInventoryRefresh, scheduleRefresh]);

  useEffect(() => () => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    if (inventoryRefreshTimer.current !== null) window.clearTimeout(inventoryRefreshTimer.current);
    refreshController.current?.abort();
    inventoryRefreshController.current?.abort();
  }, []);

  useEffect(() => {
    const offlineMessage = "Offline mode. New captures and quantity changes will sync later.";
    const handleOffline = () => {
      setOfflineMode(true);
      setConnectionIssue(offlineMessage);
      notify(offlineMessage);
    };
    const handleOnline = () => {
      setOfflineMode(false);
      notify("Back online. Syncing saved changes…");
      void syncOfflineQueue();
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [notify, refresh]);

  useEffect(() => {
    localStorage.removeItem(LEGACY_APP_CACHE_KEY);
    void listOfflineOperations().then((operations) => {
      setOfflineOperations(operations);
      setPendingItems((current) => new Set([
        ...current,
        ...operations
          .filter((operation) => operation.kind === "adjust_quantity")
          .map((operation) => operation.payload.item_public_id),
      ]));
    }).catch(() => undefined);
    api.bootstrap("", undefined, inventoryIncludeZero)
      .then((snapshot) => {
        applyBootstrap(snapshot);
        setOfflineMode(false);
        void saveOfflineSnapshot(snapshot);
        setNotice("");
      })
      .catch(async (error) => {
        if (isAuthenticationError(error)) {
          setAuth({ authenticated: false, user: null });
          setDashboard(null);
          setConnectionIssue("");
          setNotice("");
          return;
        }
        const cached = await loadOfflineSnapshot().catch(() => null);
        if (cached) {
          applyBootstrap(cached.value);
          setOfflineMode(true);
          const message = `Offline inventory loaded · saved ${new Date(cached.savedAt).toLocaleString()}`;
          setConnectionIssue(message);
          notify(message);
          return;
        }
        const message = error instanceof Error ? error.message : "Unable to connect";
        setAuth({ authenticated: false, user: null });
        setDashboard(EMPTY_DASHBOARD);
        setConnectionIssue(message);
        notify(message, {
          label: "Retry",
          action: async () => {
            const snapshot = await api.bootstrap("", undefined, inventoryIncludeZero);
            applyBootstrap(snapshot);
            notify("");
          },
        });
      });
  }, [applyBootstrap, inventoryIncludeZero, notify]); // Initialize once; searches are explicitly submitted.

  useEffect(() => {
    if (!auth?.authenticated || items.length === 0) return;
    const snapshot: Bootstrap = {
      auth,
      categories,
      dashboard: dashboard || EMPTY_DASHBOARD,
      items,
      location_types: locationTypes,
      locations,
      units,
    };
    void saveOfflineSnapshot(snapshot).catch(() => undefined);
  }, [auth, categories, dashboard, items, locationTypes, locations, units]);

  useEffect(() => {
    if (!auth?.authenticated) return;
    const parameters = new URLSearchParams(window.location.search);
    const itemId = parameters.get("item");
    const locationId = parameters.get("location");
    if (itemId) api.item(itemId).then(setSelectedItem).catch(() => undefined);
    if (locationId) {
      setSelectedLocationId(locationId);
      if (parameters.get("mode") === "add") {
        setAddLocation(locationId);
        setCaptureMode("quick");
        navigate("capture");
      } else {
        navigate("location");
      }
      return;
    }
    const requestedView = viewFromParameter(parameters.get("view"));
    if (requestedView) {
      if (requestedView === "capture") {
        const requestedMode = parameters.get("mode");
        if (["scan", "quick", "putaway", "consume", "assistant"].includes(requestedMode || "")) {
          setCaptureMode(requestedMode as CaptureMode);
        }
      }
      navigate(requestedView);
    }
  }, [auth?.authenticated, navigate]);

  async function run(
    action: () => Promise<unknown>,
    success: string,
    scope: RefreshScope = "inventory",
    options: ActionOptions = {},
  ) {
    setBusy(true);
    setActivityMessage(options.progress || "Saving changes…");
    try {
      await action();
      notify(success, options.undo ? { label: "Undo", action: options.undo } : undefined);
      refreshAfterMutation(scope);
    } catch (error) {
      notify(friendlyErrorMessage(error, "The action failed"), {
        label: "Retry",
        action: async () => run(action, success, scope, options),
      });
    } finally {
      setBusy(false);
      setActivityMessage("");
    }
  }

  function applyLocalItem(updated: Item) {
    setItems((current) => current.map((entry) => (
      entry.public_id === updated.public_id ? updated : entry
    )).filter((entry) => inventoryIncludeZero || Number(entry.quantity) > 0));
    setSelectedItem((current) => (
      current?.public_id === updated.public_id ? updated : current
    ));
  }

  function finishQueue(publicId: string) {
    adjustmentQueue.current.delete(publicId);
    setPendingItems((current) => {
      const next = new Set(current);
      next.delete(publicId);
      return next;
    });
    scheduleInventoryRefresh();
  }

  async function flushAdjustment(publicId: string) {
    const queued = adjustmentQueue.current.get(publicId);
    if (!queued || queued.inFlight || queued.pendingDelta === 0) return;
    const delta = queued.pendingDelta;
    queued.pendingDelta = 0;
    queued.inFlight = true;
    try {
      const updated = await api.adjust(queued.confirmed, delta);
      queued.confirmed = updated;
      queued.inFlight = false;
      if (queued.pendingDelta !== 0) {
        applyLocalItem(optimisticQuantity(updated, queued.pendingDelta));
        void flushAdjustment(publicId);
        return;
      }
      applyLocalItem(updated);
      notify(`${updated.name}: quantity updated`, {
        label: "Undo",
        action: async () => {
          const current = await api.item(updated.public_id);
          const restored = await api.adjust(current, -delta);
          applyLocalItem(restored);
          scheduleInventoryRefresh();
          notify(`${restored.name}: change undone`);
        },
      });
      finishQueue(publicId);
    } catch (error) {
      const retryDelta = delta;
      const retryBase = queued.confirmed;
      if (isOfflineFailure(error)) {
        adjustmentQueue.current.delete(publicId);
        const operation: OfflineOperation = {
          id: offlineOperationId(),
          kind: "adjust_quantity",
          createdAt: new Date().toISOString(),
          payload: {
            item_public_id: publicId,
            item_name: retryBase.name,
            delta: retryDelta,
          },
        };
        await putOfflineOperation(operation);
        setOfflineOperations(await listOfflineOperations());
        notify(`${retryBase.name}: quantity change saved offline`);
        return;
      }
      applyLocalItem(queued.confirmed);
      finishQueue(publicId);
      notify(friendlyErrorMessage(error, "Quantity was not saved"), {
        label: "Retry",
        action: async () => {
          setPendingItems((current) => new Set(current).add(publicId));
          try {
            const updated = await api.adjust(retryBase, retryDelta);
            applyLocalItem(updated);
            notify(`${updated.name}: quantity updated`);
            scheduleInventoryRefresh();
          } finally {
            setPendingItems((current) => {
              const next = new Set(current);
              next.delete(publicId);
              return next;
            });
          }
        },
      });
    }
  }

  async function quickAdjust(item: Item, delta: number) {
    const displayed = itemsRef.current.find((entry) => entry.public_id === item.public_id) || item;
    if (delta < 0 && Number(displayed.quantity) <= 0) return;
    const queued = adjustmentQueue.current.get(item.public_id) || {
      confirmed: displayed,
      inFlight: false,
      pendingDelta: 0,
      timer: null,
    };
    if (!adjustmentQueue.current.has(item.public_id)) {
      adjustmentQueue.current.set(item.public_id, queued);
    }
    queued.pendingDelta += delta;
    const optimistic = optimisticQuantity(displayed, delta);
    applyLocalItem(optimistic);
    setPendingItems((current) => new Set(current).add(item.public_id));
    if (queued.timer !== null) window.clearTimeout(queued.timer);
    queued.timer = window.setTimeout(() => {
      queued.timer = null;
      void flushAdjustment(item.public_id);
    }, 120);
  }

  async function moveItemFast(item: Item, destinationPublicId: string) {
    const destination = flattenLocations(locations).find((entry) => entry.public_id === destinationPublicId);
    const optimistic = {
      ...item,
      location_name: destination?.name || item.location_name,
      location_path: destination?.path || item.location_path,
      location_public_id: destinationPublicId,
      version: item.version + 1,
    };
    applyLocalItem(optimistic);
    try {
      const updated = await api.move(item, destinationPublicId);
      applyLocalItem(updated);
      notify(`${updated.name} moved`, {
        label: "Undo",
        action: async () => {
          const current = await api.item(updated.public_id);
          const restored = await api.move(current, item.location_public_id);
          applyLocalItem(restored);
          scheduleInventoryRefresh();
          notify(`${restored.name} moved back`);
        },
      });
      scheduleInventoryRefresh();
    } catch (error) {
      applyLocalItem(item);
      notify(friendlyErrorMessage(error, "Move failed"), {
        label: "Retry",
        action: async () => moveItemFast(item, destinationPublicId),
      });
    }
  }

  async function addLowStockToShopping(item: Item) {
    try {
      await api.addShopping(item.name, restockQuantity(item), item.unit, item.public_id);
      notify(`${item.name} added to shopping list`);
      scheduleInventoryRefresh();
    } catch (error) {
      notify(friendlyErrorMessage(error, "Could not add shopping item"), {
        label: "Retry",
        action: async () => addLowStockToShopping(item),
      });
    }
  }

  async function setItemLost(item: Item, lost: boolean) {
    setBusy(true);
    try {
      const updated = await api.setTags(item, lost ? withLostTag(item) : withoutLostTag(item));
      applyLocalItem(updated);
      notify(lost ? `${updated.name} marked lost` : `${updated.name} found`);
      scheduleInventoryRefresh();
    } catch (error) {
      notify(friendlyErrorMessage(error, "Could not update lost status"), {
        label: "Retry",
        action: async () => setItemLost(item, lost),
      });
    } finally {
      setBusy(false);
    }
  }

  async function foreverLost(item: Item) {
    if (!window.confirm(`${item.name} is forever lost? It will be archived, hidden from regular search, and kept in history.`)) return;
    setBusy(true);
    try {
      await api.archive(item);
      setItems((current) => current.filter((entry) => entry.public_id !== item.public_id));
      setSelectedItem((current) => current?.public_id === item.public_id ? null : current);
      notify(`${item.name} moved to forever lost`, {
        label: "Undo",
        action: async () => {
          const restored = await api.restoreItem(item.public_id);
          applyLocalItem(restored);
          scheduleInventoryRefresh();
          notify(`${restored.name} restored`);
        },
      });
      scheduleInventoryRefresh();
    } catch (error) {
      notify(friendlyErrorMessage(error, "Could not mark item forever lost"), {
        label: "Retry",
        action: async () => foreverLost(item),
      });
    } finally {
      setBusy(false);
    }
  }

  async function hardDeleteItem(item: Item) {
    if (!window.confirm(
      `Permanently delete ${item.name}?\n\nThis removes the Item, its photos, and its history. This cannot be undone.`,
    )) return;
    setBusy(true);
    setActivityMessage(`Deleting ${item.name}…`);
    try {
      await api.hardDeleteItem(item);
      setItems((current) => current.filter((entry) => entry.public_id !== item.public_id));
      setSelectedItem((current) => current?.public_id === item.public_id ? null : current);
      notify(`${item.name} permanently deleted`);
      scheduleInventoryRefresh();
    } catch (error) {
      notify(friendlyErrorMessage(error, "Could not delete item"), {
        label: "Retry",
        action: async () => hardDeleteItem(item),
      });
    } finally {
      setBusy(false);
      setActivityMessage("");
    }
  }

  async function createItemFast(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const item = await api.createItem(body);
      setItems((current) => [item, ...current.filter((entry) => entry.public_id !== item.public_id)]);
      notify(`${item.name} added`);
      setInventoryFilter("all");
      setInventoryCategoryId(item.category_id);
      navigate("inventory");
      scheduleInventoryRefresh();
    } catch (error) {
      notify(friendlyErrorMessage(error, "Could not add item"), {
        label: "Retry",
        action: async () => createItemFast(body),
      });
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function createScannedItem(body: Record<string, unknown>, imageUrl?: string, photoFile?: File) {
    setBusy(true);
    try {
      const tags = Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : [];
      const itemBody = { ...body };
      delete itemBody.tags;
      let item = await api.createItem(itemBody);
      if (tags.length) item = await api.setTags(item, tags);
      if (imageUrl) await api.importPhotoFromUrl(item, imageUrl);
      if (photoFile) {
        const resized = await resizePhoto(photoFile);
        await api.uploadPhoto(item, resized.blob, resized.width, resized.height);
        item = await api.item(item.public_id);
      }
      if (item.barcode) {
        try {
          await api.queueEnrichment(item);
          await api.runEnrichment();
          const enrichment = await api.enrichment(item);
          for (const candidate of enrichment.candidates.filter((entry) => entry.status === "proposed" && Object.keys(entry.proposed).length > 0)) {
            item = await api.applyEnrichment(candidate.public_id);
          }
        } catch {
          // Barcode enrichment is best effort; keep the scanned item save fast and reliable.
        }
      }
      setItems((current) => [item, ...current.filter((entry) => entry.public_id !== item.public_id)]);
      notify(imageUrl || photoFile ? `${item.name} added with image` : `${item.name} added`);
      scheduleInventoryRefresh();
      return item;
    } catch (error) {
      if (isOfflineFailure(error)) {
        const operationId = offlineOperationId();
        const tags = Array.isArray(body.tags)
          ? body.tags.filter((tag): tag is string => typeof tag === "string")
          : [];
        let resizedPhoto: Awaited<ReturnType<typeof resizePhoto>> | null = null;
        if (photoFile) resizedPhoto = await resizePhoto(photoFile);
        const operation: OfflineOperation = {
          id: operationId,
          kind: "create_item",
          createdAt: new Date().toISOString(),
          payload: { ...body, tags },
          imageUrl,
          photo: resizedPhoto?.blob,
          photoWidth: resizedPhoto?.width,
          photoHeight: resizedPhoto?.height,
        };
        await putOfflineOperation(operation);
        const placeholder = makeOfflineItem(
          body,
          operationId,
          locations,
          categories,
          Boolean(photoFile),
        );
        setItems((current) => [placeholder, ...current]);
        setOfflineOperations(await listOfflineOperations());
        notify(`${placeholder.name} saved offline · it will sync when Findstuff reconnects`);
        return placeholder;
      }
      notify(friendlyErrorMessage(error, "Could not add scanned item"), {
        label: "Retry",
        action: async () => { await createScannedItem(body, imageUrl, photoFile); },
      });
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function syncOfflineQueue() {
    if (!navigator.onLine || syncingOffline) return;
    setSyncingOffline(true);
    try {
      const queued = await listOfflineOperations().catch(() => []);
      let synced = 0;
      for (const operation of queued) {
        try {
          const response = await api.syncOfflineOperation(
            operation.id,
            operation.kind,
            operation.payload,
          );
          let item = response.result;
          if (operation.kind === "create_item") {
            if (operation.imageUrl) {
              await api.importPhotoFromUrl(item, operation.imageUrl);
            }
            if (operation.photo) {
              await api.uploadPhoto(
                item,
                operation.photo,
                operation.photoWidth,
                operation.photoHeight,
              );
            }
            if (operation.imageUrl || operation.photo) item = await api.item(item.public_id);
            setItems((current) => [
              item,
              ...current.filter((entry) => (
                entry.public_id !== operation.id && entry.public_id !== item.public_id
              )),
            ]);
          } else {
            applyLocalItem(item);
            setPendingItems((current) => {
              const next = new Set(current);
              next.delete(operation.payload.item_public_id);
              return next;
            });
          }
          await deleteOfflineOperation(operation.id);
          synced += 1;
        } catch (error) {
          if (isAuthenticationError(error) || isOfflineFailure(error)) break;
          await setOfflineOperationError(
            operation.id,
            friendlyErrorMessage(error, "Could not synchronize this offline change"),
          ).catch(() => undefined);
        }
      }
      const remaining = await listOfflineOperations().catch(() => []);
      setOfflineOperations(remaining);
      if (synced) {
        notify(
          remaining.length
            ? `${synced} offline change${synced === 1 ? "" : "s"} synced · ${remaining.length} need attention`
            : `${synced} offline change${synced === 1 ? "" : "s"} synced`,
        );
        await refresh("", { showBusy: false });
      } else if (!remaining.length) {
        await refresh("", { showBusy: false });
      }
    } finally {
      setSyncingOffline(false);
    }
  }

  async function createCategoryFast(name: string, parentId: number | null): Promise<Category> {
    const category = await api.createCategory(name, parentId);
    setCategories((current) => [...current.filter((entry) => entry.id !== category.id), category]);
    scheduleRefresh();
    return category;
  }

  function openAnalyticsInventory(filter: InventoryFilter) {
    const wantsZero = filter === "zero" || filter === "low";
    setInventoryFilter(filter);
    setInventoryCategoryId(null);
    setInventoryTag("");
    setQuery("");
    setSelectedItem(null);
    if (wantsZero !== inventoryIncludeZero) {
      setInventoryIncludeZero(wantsZero);
      void api.items("", undefined, { includeZero: wantsZero }).then(setItems).catch(() => undefined);
    }
    navigate("inventory");
  }

  async function signIn(username: string, password: string) {
    await api.login(username, password);
    const snapshot = await api.bootstrap("", undefined, inventoryIncludeZero);
    applyBootstrap(snapshot);
    setNotice("");
  }

  if (auth === null) {
    return <div className="splash"><div className="item-icon">F</div><h1>Findstuff</h1><p>{notice || "Opening your inventory…"}</p></div>;
  }
  if (!auth.authenticated) {
    return <LoginView onLogin={signIn} />;
  }

  const navView = view === "location" || view === "locations" || view === "category" || view === "categories"
    ? "places"
    : view === "add" || view === "scan"
      ? "capture"
      : view === "default-rules" || view === "off-category-mappings" || view === "ai-inbox"
        ? "extra"
        : view === "manage" || view === "analytics"
          ? "extra"
          : view;
  return (
    <div className="app-shell">
      {busy && <div className="activity-banner" role="status" aria-live="polite"><span className="activity-spinner" aria-hidden="true" /><strong>{activityMessage || "Saving changes…"}</strong></div>}
      {(offlineMode || offlineOperations.length > 0) && <div className={`offline-sync-banner ${offlineMode ? "offline" : ""}`} role="status"><span><Icon name={offlineMode ? "more" : "check"} size={17} /><strong>{offlineMode ? "Offline capture" : `${offlineOperations.length} saved change${offlineOperations.length === 1 ? "" : "s"}`}</strong><small>{offlineMode ? `${offlineOperations.length} waiting to sync` : offlineOperations.some((operation) => operation.error) ? "Some changes need attention" : "Ready to synchronize"}</small></span><button type="button" disabled={offlineMode || syncingOffline} onClick={() => void syncOfflineQueue()}>{syncingOffline ? "Syncing…" : "Sync now"}</button></div>}

      {notice && <div className={`toast ${retryNotice?.message === notice ? "has-action" : ""}`} role="status"><span className="toast-check"><Icon name="spark" size={16} /></span><p>{notice}</p>{retryNotice?.message === notice && <button className="toast-action" onClick={() => { const pendingAction = retryNotice; setRetryNotice(null); notify(`${pendingAction.label} in progress…`); void pendingAction.action().catch((error) => notify(friendlyErrorMessage(error, `${pendingAction.label} failed`))); }}>{retryNotice.label}</button>}<button onClick={() => { setNotice(""); setRetryNotice(null); }} aria-label="Dismiss message"><Icon name="close" size={16} /></button></div>}

      <main className="page-content">
        {view === "inventory" && (
          <div className={`inventory-desktop-layout ${selectedItem ? "has-detail" : ""}`}>
          <InventoryView
            items={items}
            locations={locations}
            categories={categories}
            totalItemCount={dashboard?.item_count ?? items.length}
            detailsTotalCount={dashboard?.needs_details_count ?? items.filter(itemNeedsDetails).length}
            query={query}
            setQuery={setQuery}
            onSearch={searchInventory}
            run={run}
            busy={busy}
            isSearchBusy={inventorySearchBusy}
            onOpen={setSelectedItem}
            onBulkStart={() => setSelectedItem(null)}
            onAdd={() => openCapture("quick")}
            onFindLost={() => setGlobalSearchOpen(true)}
            hasMore={inventoryHasMore}
            onLoadMore={loadMoreInventory}
            onQuickAdjust={quickAdjust}
            onAddShopping={addLowStockToShopping}
            onDeleteItem={hardDeleteItem}
            includeZero={inventoryIncludeZero}
            onIncludeZeroChange={setInventoryIncludeZero}
            initialFilter={inventoryFilter}
            initialCategoryId={inventoryCategoryId}
            initialTag={inventoryTag}
            pendingItems={pendingItems}
          />
          {selectedItem && <div className="inventory-detail-pane"><ItemDetail
            key={selectedItem.public_id}
            embedded
            item={selectedItem}
            allItems={items}
            locations={locations}
            categories={categories}
            units={units}
            busy={busy}
            onClose={() => setSelectedItem(null)}
            onChanged={async (item) => { applyLocalItem(item); scheduleInventoryRefresh(); }}
            onQuickAdjust={quickAdjust}
            onQuickMove={moveItemFast}
            onAddShopping={addLowStockToShopping}
            onMarkLost={(item) => setItemLost(item, true)}
            onMarkFound={(item) => setItemLost(item, false)}
            onForeverLost={foreverLost}
            onDeleteItem={hardDeleteItem}
            onOpenLocation={(id) => { setSelectedLocationId(id); setSelectedItem(null); navigate("location"); }}
            onOpenTag={(tag) => { setInventoryTag(tag); setInventoryCategoryId(null); setInventoryFilter("all"); setQuery(""); searchInventory("", { showBusy: false }); setSelectedItem(null); navigate("inventory"); }}
            run={run}
          /></div>}
          </div>
        )}
        {(view === "capture" || view === "add" || view === "scan") && (
          <ScanView
            items={items}
            locations={locations}
            categories={categories}
            units={units}
            busy={busy}
            initialMode={view === "add" ? "quick" : view === "scan" ? "scan" : captureMode}
            initialLocation={addLocation}
            onOpenItem={(id) => api.item(id).then(setSelectedItem)}
            onUseLocation={(id) => { setSelectedLocationId(id); navigate("location"); }}
            onCreateLocation={(body) => api.createLocation(body)}
            onCreateCategory={createCategoryFast}
            onAdjust={quickAdjust}
            onCreate={createScannedItem}
            onInventoryChanged={() => refresh(undefined, { showBusy: false })}
          />
        )}
        {view === "places" && (
          <PlacesView
            section={placesSection}
            onSectionChange={setPlacesSection}
            locations={locations}
            categories={categories}
            locationTypes={locationTypes}
            selectedLocationId={selectedLocationId}
            busy={busy}
            printQueueCount={printQueue.length}
            onSelectLocation={setSelectedLocationId}
            onOpenPrintQueue={() => setPrintQueueOpen(true)}
            onQueuePrint={addLocationToPrintQueue}
            onOpenItem={setSelectedItem}
            onCaptureHere={(id, mode = "quick") => openCapture(mode, id)}
            onCreateLocation={(body) => run(() => api.createLocation(body), "Place created", "all")}
            onUpdateLocation={(id, body) => run(() => api.updateLocation(id, body), "Place updated", "all")}
            onDeleteLocation={(id) => run(() => api.deleteLocation(id), "Place deleted", "all")}
            onDeleteLocationTree={(id) => run(() => api.deleteLocationTree(id), "Place group deleted", "all")}
            onCreateType={(name) => run(() => api.createLocationType(name), "Place type added", "all")}
            onOpenCategory={(id) => { setSelectedCategoryId(id); navigate("category"); }}
            onCreateCategory={(name, parentId) => run(() => api.createCategory(name, parentId), "Category created", "all")}
            onUpdateCategory={(id, body) => run(() => api.updateCategory(id, body), "Category updated", "all")}
            onDeleteCategory={(id) => run(() => api.deleteCategory(id), "Category deleted", "all")}
            onDeleteCategoryTree={(id) => run(() => api.deleteCategoryTree(id), "Category subtree deleted", "all")}
            onSaveCapabilities={(overrides) => run(() => api.saveCategoryDataSettings(overrides), "Required metadata saved", "all")}
            onSetDefaultLocation={(id, locationId) => run(() => api.setCategoryDefaultLocation(id, locationId), "Default Place saved", "all")}
            onDefaultsChanged={() => refresh(undefined, { showBusy: false })}
          />
        )}
        {view === "locations" && (
          <LocationsView
            locations={locations}
            locationTypes={locationTypes}
            busy={busy}
            onQueuePrint={addLocationToPrintQueue}
            onOpen={(id) => { setSelectedLocationId(id); navigate("location"); }}
            onCreate={(body) => run(() => api.createLocation(body), "Place created", "all")}
            onUpdate={(id, body) => run(() => api.updateLocation(id, body), "Place updated", "all")}
            onDelete={(id) => run(() => api.deleteLocation(id), "Place deleted", "all")}
            onDeleteTree={(id) => run(() => api.deleteLocationTree(id), "Place group deleted", "all")}
            onCreateType={(name) => run(() => api.createLocationType(name), "Place type added", "all")}
          />
        )}
        {view === "location" && selectedLocationId && (
          <LocationDetailView
            locationId={selectedLocationId}
            locations={locations}
            categories={categories}
            locationTypes={locationTypes}
            busy={busy}
            onQueuePrint={addLocationToPrintQueue}
            onOpenItem={setSelectedItem}
            onOpenLocation={setSelectedLocationId}
            onAddHere={(id) => openCapture("quick", id)}
            onCreateLocationHere={(body) => run(() => api.createLocation(body), "Place created", "all")}
            onDefaultsChanged={() => refresh(undefined, { showBusy: false })}
            onBack={() => { setPlacesSection("locations"); navigate("places"); }}
          />
        )}
        {view === "categories" && (
          <CategoriesView
            categories={categories}
            locations={locations}
            busy={busy}
            onOpen={(id) => { setSelectedCategoryId(id); navigate("category"); }}
            onCreate={(name, parentId) => run(() => api.createCategory(name, parentId), "Category created", "all")}
            onUpdate={(id, body) => run(() => api.updateCategory(id, body), "Category updated", "all")}
            onDelete={(id) => run(() => api.deleteCategory(id), "Category deleted", "all")}
            onDeleteTree={(id) => run(() => api.deleteCategoryTree(id), "Category subtree deleted", "all")}
            onSaveCapabilities={(overrides) => run(() => api.saveCategoryDataSettings(overrides), "Required metadata saved", "all")}
            onSetDefaultLocation={(id, locationId) => run(() => api.setCategoryDefaultLocation(id, locationId), "Default Place saved", "all")}
          />
        )}
        {view === "category" && selectedCategoryId && (
          <CategoryDetailView
            categoryId={selectedCategoryId}
            categories={categories}
            busy={busy}
            onOpenItem={setSelectedItem}
            onOpenCategory={(id) => { setSelectedCategoryId(id); navigate("category"); }}
            onInventory={(id) => { setInventoryCategoryId(id); setInventoryFilter("all"); navigate("inventory"); }}
            onCreateCategoryHere={(name, parentId) => run(() => api.createCategory(name, parentId), "Category created", "all")}
            onBack={() => { setPlacesSection("categories"); navigate("places"); }}
          />
        )}
        {view === "off-category-mappings" && <OffCategoryMappingsView categories={categories} busy={busy} onBack={() => navigate("manage")} onOpenItem={setSelectedItem} onNotice={setNotice} />}
        {view === "default-rules" && <DefaultRulesView locations={locations} categories={categories} busy={busy} onBack={() => navigate("manage")} onChanged={() => refresh(undefined, { showBusy: false })} notify={notify} />}
        {view === "ai-inbox" && <AIScanInboxView categories={categories} locations={locations} units={units} busy={busy} onBack={() => navigate("manage")} onInventoryChanged={() => refresh()} notify={notify} />}
        {view === "dashboard" && <DashboardView dashboard={dashboard} detailsCount={dashboard?.needs_details_count ?? items.filter(itemNeedsDetails).length} connectionIssue={connectionIssue} onRetry={() => void refresh("", { showBusy: true })} onCapture={openCapture} onGlobalSearch={() => setGlobalSearchOpen(true)} onInventory={(filter) => { setInventoryFilter(filter); setInventoryCategoryId(null); navigate("inventory"); }} onNotice={setNotice} />}
        {view === "extra" && <ExtraView offlineOperations={offlineOperations} offlineMode={offlineMode} syncing={syncingOffline} onAnalytics={() => navigate("analytics")} onSettings={() => navigate("manage")} onSync={() => syncOfflineQueue()} onDiscard={async (id) => { await deleteOfflineOperation(id); setOfflineOperations(await listOfflineOperations()); if (navigator.onLine) await refresh("", { showBusy: false }); }} />}
        {view === "analytics" && <AnalyticsView
          onBack={() => navigate("extra")}
          onInventory={openAnalyticsInventory}
          onCategory={(id) => {
            if (id === null) {
              openAnalyticsInventory("uncategorized");
              return;
            }
            setSelectedCategoryId(id);
            navigate("category");
          }}
          onLocation={(id) => {
            if (id === "unassigned") {
              openAnalyticsInventory("details");
              return;
            }
            setSelectedLocationId(id);
            setSelectedItem(null);
            navigate("location");
          }}
          onItem={(id) => void api.item(id).then(setSelectedItem)}
        />}
        {view === "manage" && (
          <ManageView items={items} dashboard={dashboard} locations={locations} categories={categories} locationTypes={locationTypes} units={units} busy={busy} theme={theme} setNotice={setNotice} notify={notify} onThemeChange={setTheme} onInventoryChanged={() => refresh()} onLocations={() => { setPlacesSection("locations"); navigate("places"); }} onCategories={() => { setPlacesSection("categories"); navigate("places"); }} onDefaultRules={() => navigate("default-rules")} onOffCategoryMappings={() => navigate("off-category-mappings")} onInbox={() => navigate("ai-inbox")} onOpenItem={setSelectedItem} onMarkFound={(item) => setItemLost(item, false)} onForeverLost={foreverLost} onUnitsChanged={setUnits} />
        )}
        {selectedItem && view !== "inventory" && (
          <ItemDetail
            item={selectedItem}
            allItems={items}
            locations={locations}
            categories={categories}
            units={units}
            busy={busy}
            onClose={() => setSelectedItem(null)}
            onChanged={async (item) => { applyLocalItem(item); scheduleInventoryRefresh(); }}
            onQuickAdjust={quickAdjust}
            onQuickMove={moveItemFast}
            onAddShopping={addLowStockToShopping}
            onMarkLost={(item) => setItemLost(item, true)}
            onMarkFound={(item) => setItemLost(item, false)}
            onForeverLost={foreverLost}
            onDeleteItem={hardDeleteItem}
            onOpenLocation={(id) => { setSelectedLocationId(id); setSelectedItem(null); navigate("location"); }}
            onOpenTag={(tag) => { setInventoryTag(tag); setInventoryCategoryId(null); setInventoryFilter("all"); setQuery(""); searchInventory("", { showBusy: false }); setSelectedItem(null); navigate("inventory"); }}
            run={run}
          />
        )}
        {globalSearchOpen && <GlobalSearch items={items} locations={locations} categories={categories} onClose={() => setGlobalSearchOpen(false)} onOpenItem={(item) => { setGlobalSearchOpen(false); setSelectedItem(item); }} onOpenLocation={(id) => { setGlobalSearchOpen(false); setSelectedLocationId(id); setPlacesSection("locations"); navigate("places"); }} onOpenCategory={(id) => { setGlobalSearchOpen(false); setSelectedCategoryId(id); navigate("category"); }} onNavigate={(next) => { setGlobalSearchOpen(false); navigate(next); }} onCapture={(mode) => { setGlobalSearchOpen(false); openCapture(mode); }} />}
        {printQueueOpen && <PrintQueueDialog
          queue={printQueue}
          settings={printSettings}
          onChangeQueue={setPrintQueue}
          onChangeSettings={setPrintSettings}
          onClose={() => setPrintQueueOpen(false)}
          onNotice={notify}
        />}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        {nav.map((entry) => (
          <button
            type="button"
            key={entry.id}
            className={`${navView === entry.id ? "active" : ""} ${entry.id === "capture" ? "add-tab" : ""}`}
            onClick={() => navigate(entry.id)}
            aria-current={navView === entry.id ? "page" : undefined}
          >
            <span className="nav-icon"><Icon name={entry.icon} size={22} /></span><span>{entry.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function PlacesView({ section, onSectionChange, locations, categories, locationTypes, selectedLocationId, busy, printQueueCount, onSelectLocation, onOpenPrintQueue, onQueuePrint, onOpenItem, onCaptureHere, onCreateLocation, onUpdateLocation, onDeleteLocation, onDeleteLocationTree, onCreateType, onOpenCategory, onCreateCategory, onUpdateCategory, onDeleteCategory, onDeleteCategoryTree, onSaveCapabilities, onSetDefaultLocation, onDefaultsChanged }: {
  section: PlacesSection;
  onSectionChange: (section: PlacesSection) => void;
  locations: LocationNode[];
  categories: Category[];
  locationTypes: LocationType[];
  selectedLocationId: string | null;
  busy: boolean;
  printQueueCount: number;
  onSelectLocation: (id: string | null) => void;
  onOpenPrintQueue: () => void;
  onQueuePrint: (location: LocationNode) => void;
  onOpenItem: (item: Item) => void;
  onCaptureHere: (id: string, mode?: CaptureMode) => void;
  onCreateLocation: (body: { name: string; kind: string; parent_public_id: string | null }) => Promise<void>;
  onUpdateLocation: (id: string, body: { name: string; kind: string; parent_public_id: string | null }) => Promise<void>;
  onDeleteLocation: (id: string) => Promise<void>;
  onDeleteLocationTree: (id: string) => Promise<void>;
  onCreateType: (name: string) => Promise<void>;
  onOpenCategory: (id: number) => void;
  onCreateCategory: (name: string, parentId: number | null) => Promise<void>;
  onUpdateCategory: (id: number, body: { name: string; parent_id: number | null }) => Promise<void>;
  onDeleteCategory: (id: number) => Promise<void>;
  onDeleteCategoryTree: (id: number) => Promise<void>;
  onSaveCapabilities: (overrides: ApplicationSettings["category_data"]["overrides"]) => Promise<void>;
  onSetDefaultLocation: (id: number, locationId: string | null) => Promise<void>;
  onDefaultsChanged: () => Promise<void>;
}) {
  return <section className="places-page">
    <header className="places-heading compact-places-heading"><div className="places-tabs" role="tablist" aria-label="Browse Places"><button type="button" role="tab" aria-selected={section === "locations"} className={section === "locations" ? "active" : ""} onClick={() => onSectionChange("locations")}><Icon name="pin" size={17} />Places</button><button type="button" role="tab" aria-selected={section === "categories"} className={section === "categories" ? "active" : ""} onClick={() => onSectionChange("categories")}><Icon name="tag" size={17} />Categories</button></div>{section === "locations" && <button type="button" className="print-queue-launcher" onClick={onOpenPrintQueue}><Icon name="qr" size={17} /><span>Print queue</span><strong>{printQueueCount}</strong></button>}</header>
    {section === "locations" ? <div className={`places-layout ${selectedLocationId ? "has-detail" : ""}`}><div className="places-tree-pane"><LocationsView locations={locations} locationTypes={locationTypes} busy={busy} onQueuePrint={onQueuePrint} onOpen={(id) => onSelectLocation(id)} onCreate={onCreateLocation} onUpdate={onUpdateLocation} onDelete={onDeleteLocation} onDeleteTree={onDeleteLocationTree} onCreateType={onCreateType} /></div>{selectedLocationId ? <div className="places-detail-pane"><LocationDetailView locationId={selectedLocationId} locations={locations} categories={categories} locationTypes={locationTypes} busy={busy} onQueuePrint={onQueuePrint} onOpenItem={onOpenItem} onOpenLocation={(id) => onSelectLocation(id)} onAddHere={(id) => onCaptureHere(id, "quick")} onCreateLocationHere={onCreateLocation} onDefaultsChanged={onDefaultsChanged} onBack={() => onSelectLocation(null)} /><div className="location-mode-actions"><button className="primary button-with-icon" onClick={() => onCaptureHere(selectedLocationId, "putaway")}><Icon name="scan" size={17} />Put away here</button></div></div> : <aside className="places-detail-empty"><span><Icon name="pin" size={25} /></span><h2>Select a Place</h2><p>Its Items, child Places, defaults, and actions will stay beside the tree on larger screens.</p></aside>}</div> : <CategoriesView categories={categories} locations={locations} busy={busy} onOpen={onOpenCategory} onCreate={onCreateCategory} onUpdate={onUpdateCategory} onDelete={onDeleteCategory} onDeleteTree={onDeleteCategoryTree} onSaveCapabilities={onSaveCapabilities} onSetDefaultLocation={onSetDefaultLocation} />}
  </section>;
}

function GlobalSearch({ items, locations, categories, onClose, onOpenItem, onOpenLocation, onOpenCategory, onNavigate, onCapture }: {
  items: Item[];
  locations: LocationNode[];
  categories: Category[];
  onClose: () => void;
  onOpenItem: (item: Item) => void;
  onOpenLocation: (id: string) => void;
  onOpenCategory: (id: number) => void;
  onNavigate: (view: View) => void;
  onCapture: (mode: CaptureMode) => void;
}) {
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  useEffect(() => { api.projects().then(setProjects).catch(() => undefined); }, []);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", close); };
  }, [onClose]);
  const term = query.trim().toLocaleLowerCase();
  const matches = (values: Array<string | null | undefined>) => !term || values.filter(Boolean).join(" ").toLocaleLowerCase().includes(term);
  const itemResults = items.filter((item) => matches([item.name, item.brand, item.model, item.barcode, item.location_path, categoryLabel(item), ...item.tags])).slice(0, 8);
  const locationResults = flatLocations.filter((location) => matches([location.name, location.path, location.kind])).slice(0, 6);
  const categoryResults = categories.filter((category) => matches([category.name, category.path])).slice(0, 6);
  const projectResults = projects.filter((project) => matches([project.name, project.description, project.status])).slice(0, 5);
  const allCommands: Array<{ label: string; detail: string; icon: IconName; run: () => void }> = [
    { label: "Capture an item", detail: "Type or take a photo", icon: "plus", run: () => onCapture("quick") },
    { label: "Scan a barcode", detail: "Open the camera", icon: "scan", run: () => onCapture("scan") },
    { label: "Put items away", detail: "Scan into one destination", icon: "pin", run: () => onCapture("putaway") },
    { label: "Consume an item", detail: "Reduce quantity by scanning", icon: "minus", run: () => onCapture("consume") },
    { label: "Open inventory", detail: "Search and filter all items", icon: "search", run: () => onNavigate("inventory") },
    { label: "Open settings", detail: "Manage Findstuff", icon: "settings", run: () => onNavigate("manage") },
  ];
  const commands = allCommands.filter((command) => matches([command.label, command.detail]));
  return <div className="global-search-backdrop" role="dialog" aria-modal="true" aria-label="Search Findstuff" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="global-search-sheet"><header><Icon name="search" size={22} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Items, locations, categories, projects, commands…" aria-label="Search all of Findstuff" /><kbd>Esc</kbd><button className="icon-button" onClick={onClose} aria-label="Close search"><Icon name="close" size={17} /></button></header><div className="global-search-results">{itemResults.length > 0 && <SearchGroup title="Items">{itemResults.map((item) => <button key={item.public_id} onClick={() => onOpenItem(item)}><Icon name="box" size={17} /><span><strong>{item.name}</strong><small>{item.location_path} · {item.quantity} {item.unit}</small></span></button>)}</SearchGroup>}{locationResults.length > 0 && <SearchGroup title="Locations">{locationResults.map((location) => <button key={location.public_id} onClick={() => onOpenLocation(location.public_id)}><Icon name="pin" size={17} /><span><strong>{location.name}</strong><small>{location.path} · {location.total_item_count} items</small></span></button>)}</SearchGroup>}{categoryResults.length > 0 && <SearchGroup title="Categories">{categoryResults.map((category) => <button key={category.id} onClick={() => onOpenCategory(category.id)}><Icon name="tag" size={17} /><span><strong>{category.name}</strong><small>{category.path} · {category.total_item_count} items</small></span></button>)}</SearchGroup>}{projectResults.length > 0 && <SearchGroup title="Projects">{projectResults.map((project) => <button key={project.public_id} onClick={() => onNavigate("manage")}><Icon name="spark" size={17} /><span><strong>{project.name}</strong><small>{project.status} · {project.reservations.length} reservations</small></span></button>)}</SearchGroup>}{commands.length > 0 && <SearchGroup title="Commands">{commands.map((command) => <button key={command.label} onClick={command.run}><Icon name={command.icon} size={17} /><span><strong>{command.label}</strong><small>{command.detail}</small></span></button>)}</SearchGroup>}{term && !itemResults.length && !locationResults.length && !categoryResults.length && !projectResults.length && !commands.length && <EmptyState icon="search" title="Nothing found" text="Try a shorter name, barcode, place, category, project, or command." />}</div></section></div>;
}

function SearchGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="global-search-group"><h2>{title}</h2><div>{children}</div></section>;
}

function LocationsView({ locations, locationTypes, onCreate, onUpdate, onDelete, onDeleteTree, onCreateType, onOpen, onQueuePrint, busy }: {
  locations: LocationNode[];
  locationTypes: LocationType[];
  onCreate: (body: { name: string; kind: string; parent_public_id: string | null }) => Promise<void>;
  onUpdate: (publicId: string, body: { name: string; kind: string; parent_public_id: string | null }) => Promise<void>;
  onDelete: (publicId: string) => Promise<void>;
  onDeleteTree: (publicId: string) => Promise<void>;
  onCreateType: (name: string) => Promise<void>;
  onOpen: (publicId: string) => void;
  onQueuePrint: (location: LocationNode) => void;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("location");
  const [parent, setParent] = useState("");
  const [newType, setNewType] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState("");
  const [editName, setEditName] = useState("");
  const [editKind, setEditKind] = useState("location");
  const [editParent, setEditParent] = useState("");
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const editingLocation = useMemo(() => flatLocations.find((entry) => entry.public_id === editingId) || null, [editingId, flatLocations]);
  const editParentOptions = useMemo(() => {
    if (!editingLocation) return flatLocations;
    const blocked = new Set(flattenLocations([editingLocation]).map((entry) => entry.public_id));
    return flatLocations.filter((entry) => !blocked.has(entry.public_id));
  }, [editingLocation, flatLocations]);
  function toggle(publicId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(publicId)) next.delete(publicId);
      else next.add(publicId);
      return next;
    });
  }
  function startEdit(location: LocationNode) {
    setEditingId(location.public_id);
    setEditName(location.name);
    setEditKind(location.kind);
    const parentPath = location.path.split(" > ").slice(0, -1).join(" > ");
    setEditParent(flatLocations.find((entry) => entry.path === parentPath)?.public_id || "");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    await onCreate({ name, kind, parent_public_id: parent || null });
    setName("");
  }
  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingLocation) return;
    await onUpdate(editingLocation.public_id, {
      name: editName,
      kind: editKind,
      parent_public_id: editParent || null,
    });
    setEditingId("");
  }
  async function remove(location: LocationNode) {
    if (!window.confirm(`Delete ${location.path}? Locations with items or child locations must be emptied first.`)) return;
    await onDelete(location.public_id);
  }
  async function removeTree(location: LocationNode) {
    const totalItems = location.total_item_count ?? location.item_count ?? 0;
    if (!window.confirm(`Delete ${location.path} and all child locations? ${totalItems} item${totalItems === 1 ? "" : "s"} inside will be archived.`)) return;
    await onDeleteTree(location.public_id);
  }
  async function submitType(event: FormEvent) {
    event.preventDefault();
    await onCreateType(newType);
    setKind(newType.trim().toLowerCase());
    setNewType("");
  }
  return (
    <section className="locations-page">
      <details className="create-panel"><summary><span className="summary-icon"><Icon name="plus" /></span><span><strong>Create a location</strong><small>Nest it inside any existing place</small></span><Icon name="chevron" /></summary><form className="form-card" onSubmit={submit}>
          <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Drawer A" /></label>
          <div className="form-row">
            <label>Inside<select value={parent} onChange={(event) => setParent(event.target.value)}><option value="">Top level</option>{flatLocations.map((entry) => <option key={entry.public_id} value={entry.public_id}>{entry.path}</option>)}</select></label>
            <label>Type<select value={kind} onChange={(event) => setKind(event.target.value)}>{locationTypes.map((entry) => <option value={entry.name} key={entry.name}>{entry.name}</option>)}</select></label>
          </div>
          <button className="primary wide button-with-icon" disabled={busy || !name.trim()}><Icon name="plus" size={17} />Create location</button>
        </form><form className="inline-create-type" onSubmit={submitType}><label>Add a custom type<input value={newType} onChange={(event) => setNewType(event.target.value)} placeholder="e.g. crate, suitcase, rack" /></label><button className="secondary" disabled={!newType.trim()}>Add type</button></form></details>
      <div className="location-tree">{locations.length ? locations.map((node) => <LocationBranch key={node.public_id} node={node} locationTypes={locationTypes} editParentOptions={editParentOptions} editingId={editingId} editName={editName} editKind={editKind} editParent={editParent} expanded={expanded} busy={busy} depth={0} onToggle={toggle} onOpen={onOpen} onQueuePrint={onQueuePrint} onEdit={startEdit} onDelete={remove} onDeleteTree={removeTree} onSaveEdit={saveEdit} onCancelEdit={() => setEditingId("")} onEditName={setEditName} onEditKind={setEditKind} onEditParent={setEditParent} />) : <EmptyState icon="pin" title="No locations yet" text="Create your first room, shelf, box, or drawer." />}</div>
    </section>
  );
}

function LocationBranch({ node, locationTypes, editParentOptions, editingId, editName, editKind, editParent, expanded, busy, depth = 0, onToggle, onOpen, onQueuePrint, onEdit, onDelete, onDeleteTree, onSaveEdit, onCancelEdit, onEditName, onEditKind, onEditParent }: {
  node: LocationNode;
  locationTypes: LocationType[];
  editParentOptions: LocationNode[];
  editingId: string;
  editName: string;
  editKind: string;
  editParent: string;
  expanded: Set<string>;
  busy: boolean;
  depth?: number;
  onToggle: (publicId: string) => void;
  onOpen: (publicId: string) => void;
  onQueuePrint: (location: LocationNode) => void;
  onEdit: (location: LocationNode) => void;
  onDelete: (location: LocationNode) => void;
  onDeleteTree: (location: LocationNode) => void;
  onSaveEdit: (event: FormEvent) => void;
  onCancelEdit: () => void;
  onEditName: (value: string) => void;
  onEditKind: (value: string) => void;
  onEditParent: (value: string) => void;
}) {
  const isOpen = expanded.has(node.public_id);
  const isEditing = editingId === node.public_id;
  const isSystem = node.public_id === "unassigned";
  const directItems = node.item_count ?? 0;
  const totalItems = node.total_item_count ?? directItems;
  const itemText = `${totalItems} item${totalItems === 1 ? "" : "s"}${directItems && directItems !== totalItems ? ` · ${directItems} here` : ""}`;
  const placeText = node.children.length ? `${node.children.length} place${node.children.length === 1 ? "" : "s"} inside` : "exact spot";
  return <div className="location-branch" style={{ "--depth": depth } as CSSProperties}><div className="location-node"><span className="hierarchy-rail" aria-hidden="true" />{node.children.length > 0 ? <button type="button" className={`tree-toggle ${isOpen ? "open" : ""}`} onClick={() => onToggle(node.public_id)} aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.name}`} aria-expanded={isOpen}><Icon name="chevron" size={16} /></button> : <span className="tree-toggle-spacer" />}<button type="button" className="location-open" onClick={() => onOpen(node.public_id)}><span className="location-kind"><Icon name={node.kind === "box" || node.kind === "container" ? "box" : "pin"} size={18} /></span><span><strong>{node.name}</strong><small>Level {depth + 1} · {node.kind} · {itemText} · {placeText}</small><em>{node.path}</em></span></button><div className="location-node-actions"><button type="button" disabled={isSystem || busy} onClick={() => onEdit(node)}><Icon name="settings" size={14} /><span>Edit</span></button><button type="button" disabled={isSystem || busy || node.children.length > 0} title={node.children.length > 0 ? "Move or delete child locations first" : "Delete location"} onClick={() => onDelete(node)}><Icon name="close" size={14} /><span>Delete</span></button><button type="button" className="danger-button" disabled={isSystem || busy} onClick={() => onDeleteTree(node)}><Icon name="close" size={14} /><span>Subtree</span></button><button type="button" className="qr-link" disabled={isSystem} onClick={() => onQueuePrint(node)} aria-label={`Print QR for ${node.name}`}><Icon name="qr" size={18} /><span>Print QR</span></button></div></div>{isEditing && <form className="location-edit-form" onSubmit={onSaveEdit}><label>Name<input required value={editName} onChange={(event) => onEditName(event.target.value)} /></label><label>Type<select value={editKind} onChange={(event) => onEditKind(event.target.value)}>{locationTypes.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}</select></label><label>Inside<select value={editParent} onChange={(event) => onEditParent(event.target.value)}><option value="">Top level</option>{editParentOptions.map((entry) => <option key={entry.public_id} value={entry.public_id}>{entry.path}</option>)}</select></label><div className="button-row"><button type="button" onClick={onCancelEdit}>Cancel</button><button className="secondary" disabled={!editName.trim() || busy}>Save location</button></div></form>}{isOpen && node.children.map((child) => <LocationBranch key={child.public_id} node={child} locationTypes={locationTypes} editParentOptions={editParentOptions} editingId={editingId} editName={editName} editKind={editKind} editParent={editParent} expanded={expanded} busy={busy} depth={depth + 1} onToggle={onToggle} onOpen={onOpen} onQueuePrint={onQueuePrint} onEdit={onEdit} onDelete={onDelete} onDeleteTree={onDeleteTree} onSaveEdit={onSaveEdit} onCancelEdit={onCancelEdit} onEditName={onEditName} onEditKind={onEditKind} onEditParent={onEditParent} />)}</div>;
}

function CategoriesView({ categories, locations, busy, onOpen, onCreate, onUpdate, onDelete, onDeleteTree, onSaveCapabilities, onSetDefaultLocation }: {
  categories: Category[];
  locations: LocationNode[];
  busy: boolean;
  onOpen: (categoryId: number) => void;
  onCreate: (name: string, parentId: number | null) => Promise<void>;
  onUpdate: (categoryId: number, body: { name: string; parent_id: number | null }) => Promise<void>;
  onDelete: (categoryId: number) => Promise<void>;
  onDeleteTree: (categoryId: number) => Promise<void>;
  onSaveCapabilities: (overrides: ApplicationSettings["category_data"]["overrides"]) => Promise<void>;
  onSetDefaultLocation: (categoryId: number, locationId: string | null) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editParent, setEditParent] = useState("");
  const [editDefaultLocation, setEditDefaultLocation] = useState("");
  const [capabilityOverrides, setCapabilityOverrides] = useState<ApplicationSettings["category_data"]["overrides"]>({});
  const tree = useMemo(() => buildCategoryTree(categories), [categories]);
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const editingCategory = categories.find((entry) => entry.id === editingId) || null;
  const editParentOptions = useMemo(() => {
    if (!editingCategory) return categories;
    const blocked = categoryDescendantIds(categories, editingCategory.id);
    return categories.filter((entry) => !blocked.has(entry.id));
  }, [categories, editingCategory]);
  useEffect(() => {
    const next: ApplicationSettings["category_data"]["overrides"] = {};
    for (const category of categories) {
      if (!category.capabilities.override) continue;
      next[String(category.id)] = Object.fromEntries(
        Object.keys(CATEGORY_DATA_FIELD_LABELS).map((field) => [field, Boolean(category.capabilities[field as keyof typeof CATEGORY_DATA_FIELD_LABELS])]),
      ) as Record<string, boolean>;
    }
    setCapabilityOverrides(next);
  }, [categories]);
  function toggle(categoryId: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    await onCreate(name, parent ? Number(parent) : null);
    setName("");
  }
  function startEdit(category: Category) {
    setEditingId(category.id);
    setEditName(category.name);
    setEditParent(category.parent_id === null ? "" : String(category.parent_id));
    setEditDefaultLocation(category.default_location?.public_id || "");
  }
  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingCategory) return;
    await onUpdate(editingCategory.id, { name: editName, parent_id: editParent ? Number(editParent) : null });
    await onSetDefaultLocation(editingCategory.id, editDefaultLocation || null);
    await onSaveCapabilities(capabilityOverrides);
    setEditingId(null);
  }
  async function remove(category: Category) {
    if (!window.confirm(`Delete ${category.path}? It must have no items or child categories.`)) return;
    await onDelete(category.id);
  }
  async function removeTree(category: Category) {
    if (!window.confirm(`Delete ${category.path} and all child categories? ${category.total_item_count} item${category.total_item_count === 1 ? "" : "s"} will become uncategorised.`)) return;
    await onDeleteTree(category.id);
  }
  function setCapability(category: Category, field: keyof typeof CATEGORY_DATA_FIELD_LABELS, enabled: boolean) {
    setCapabilityOverrides((current) => ({
      ...current,
      [String(category.id)]: {
        ...Object.fromEntries(Object.keys(CATEGORY_DATA_FIELD_LABELS).map((key) => [key, Boolean(category.capabilities[key as keyof typeof CATEGORY_DATA_FIELD_LABELS])])),
        ...(current[String(category.id)] || {}),
        [field]: enabled,
      },
    }));
  }
  function resetCapabilities(category: Category) {
    setCapabilityOverrides((current) => {
      const next = { ...current };
      delete next[String(category.id)];
      return next;
    });
  }
  return (
    <section className="locations-page">
      {editingCategory ? <CategoryEditPanel category={editingCategory} locations={flatLocations} editName={editName} editParent={editParent} editParentOptions={editParentOptions} editDefaultLocation={editDefaultLocation} overrides={capabilityOverrides} busy={busy} onEditName={setEditName} onEditParent={setEditParent} onEditDefaultLocation={setEditDefaultLocation} onCapability={setCapability} onResetCapabilities={resetCapabilities} onCancel={() => setEditingId(null)} onSubmit={saveEdit} /> : <details className="create-panel"><summary><span className="summary-icon"><Icon name="plus" /></span><span><strong>Create a category</strong><small>Nest it under any existing category</small></span><Icon name="chevron" /></summary><form className="form-card" onSubmit={submit}><label>Name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Resistors, batteries, printer parts" /></label><label>Inside<select value={parent} onChange={(event) => setParent(event.target.value)}><option value="">Top level</option>{categories.map((entry) => <option key={entry.id} value={entry.id}>{categoryOptionLabel(entry)}</option>)}</select></label><button className="primary wide button-with-icon" disabled={busy || !name.trim()}><Icon name="plus" size={17} />Create category</button></form></details>}
      <div className="category-tree">{tree.length ? tree.map((category) => <CategoryBranch key={category.id} category={category} expanded={expanded} busy={busy} onToggle={toggle} onOpen={onOpen} onEdit={startEdit} onDelete={remove} onDeleteTree={removeTree} />) : <EmptyState icon="tag" title="No categories yet" text="Create your first category." />}</div>
    </section>
  );
}

function CategoryEditPanel({ category, locations, editName, editParent, editParentOptions, editDefaultLocation, overrides, busy, onEditName, onEditParent, onEditDefaultLocation, onCapability, onResetCapabilities, onCancel, onSubmit }: {
  category: Category;
  locations: LocationNode[];
  editName: string;
  editParent: string;
  editParentOptions: Category[];
  editDefaultLocation: string;
  overrides: ApplicationSettings["category_data"]["overrides"];
  busy: boolean;
  onEditName: (value: string) => void;
  onEditParent: (value: string) => void;
  onEditDefaultLocation: (value: string) => void;
  onCapability: (category: Category, field: keyof typeof CATEGORY_DATA_FIELD_LABELS, enabled: boolean) => void;
  onResetCapabilities: (category: Category) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const override = overrides[String(category.id)];
  const capabilities = { ...category.capabilities, ...(override || {}) };
  const [pickingLocation, setPickingLocation] = useState(false);
  const locationRoots = locations.filter((entry) => !entry.path.includes(" > "));
  const locationNodes = locationPickerNodes(locationRoots);
  const selectedLocation = locations.find((entry) => entry.public_id === editDefaultLocation);
  return <>
    <form className="form-card compact-form category-edit-panel" onSubmit={onSubmit}>
      <div className="section-heading"><div><p className="eyebrow">EDIT CATEGORY</p><h2>{category.name}</h2><span>{category.path}</span></div></div>
      <div className="form-row"><label>Rename<input required value={editName} onChange={(event) => onEditName(event.target.value)} /></label><label>Move inside<select value={editParent} onChange={(event) => onEditParent(event.target.value)}><option value="">Top level</option>{editParentOptions.map((entry) => <option key={entry.id} value={entry.id}>{categoryOptionLabel(entry)}</option>)}</select></label></div>
      <div className="picker-field"><span>Default location</span><button type="button" onClick={() => setPickingLocation(true)}><Icon name="pin" size={16} /><strong>{selectedLocation?.path || "Inherit / none"}</strong></button>{editDefaultLocation && <button type="button" className="text-button" onClick={() => onEditDefaultLocation("")}>Clear</button>}</div>
      <div className="category-data-title"><div><strong>Required metadata</strong><small>{category.capabilities.override ? "customized here" : `inherits ${category.capabilities.inherited_label}`}</small></div><button type="button" onClick={() => onResetCapabilities(category)}>Reset</button></div>
      <div className="capability-grid">{(Object.keys(CATEGORY_DATA_FIELD_LABELS) as Array<keyof typeof CATEGORY_DATA_FIELD_LABELS>).map((field) => <label className="toggle compact-toggle" key={field}><input type="checkbox" checked={Boolean(capabilities[field])} onChange={(event) => onCapability(category, field, event.target.checked)} /><span><strong>{CATEGORY_DATA_FIELD_LABELS[field]}</strong></span></label>)}</div>
      <div className="button-row"><button type="button" onClick={onCancel}>Cancel</button><button className="secondary" disabled={!editName.trim() || busy}>Save category</button></div>
    </form>
    {pickingLocation && <HierarchyPicker title="Choose default location" nodes={locationNodes} selectedId={editDefaultLocation} emptyLabel="No child locations here" chooseLabel="Use location" currentChooseLabel="Use this location" onChoose={onEditDefaultLocation} onClose={() => setPickingLocation(false)} />}
  </>;
}

function CategoryBranch({ category, expanded, busy, depth = 0, onToggle, onOpen, onEdit, onDelete, onDeleteTree }: {
  category: CategoryNode;
  expanded: Set<number>;
  busy: boolean;
  depth?: number;
  onToggle: (categoryId: number) => void;
  onOpen: (categoryId: number) => void;
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
  onDeleteTree: (category: Category) => void;
}) {
  const isOpen = expanded.has(category.id);
  const canDelete = category.children.length === 0 && category.item_count === 0;
  return <div className="category-branch" style={{ "--depth": depth } as CSSProperties}><div className="category-node"><span className="hierarchy-rail" aria-hidden="true" />{category.children.length > 0 ? <button type="button" className={`tree-toggle ${isOpen ? "open" : ""}`} onClick={() => onToggle(category.id)} aria-label={`${isOpen ? "Collapse" : "Expand"} ${category.name}`} aria-expanded={isOpen}><Icon name="chevron" size={16} /></button> : <span className="tree-toggle-spacer" />}<button type="button" className="category-open" onClick={() => onOpen(category.id)}><span className="location-kind"><Icon name="tag" size={17} /></span><span><strong>{category.name}</strong><small>Level {depth + 1} · {category.total_item_count} item{category.total_item_count === 1 ? "" : "s"} · {category.children.length} child{category.children.length === 1 ? "" : "ren"}</small><em>{categoryOptionLabel(category)}</em></span></button><div className="category-actions"><button type="button" onClick={() => onEdit(category)}><Icon name="settings" size={14} /><span>Edit</span></button><button type="button" disabled={busy || !canDelete} title={canDelete ? "Delete category" : "Move children and items first"} onClick={() => onDelete(category)}><Icon name="close" size={14} /><span>Delete</span></button><button type="button" className="danger-button" disabled={busy} onClick={() => onDeleteTree(category)}><Icon name="close" size={14} /><span>Subtree</span></button></div></div>{isOpen && category.children.map((child) => <CategoryBranch key={child.id} category={child} expanded={expanded} busy={busy} depth={depth + 1} onToggle={onToggle} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} onDeleteTree={onDeleteTree} />)}</div>;
}

function CategoryDetailView({ categoryId, categories, busy, onOpenItem, onOpenCategory, onInventory, onCreateCategoryHere, onBack }: {
  categoryId: number;
  categories: Category[];
  busy: boolean;
  onOpenItem: (item: Item) => void;
  onOpenCategory: (categoryId: number) => void;
  onInventory: (categoryId: number) => void;
  onCreateCategoryHere: (name: string, parentId: number) => Promise<void>;
  onBack: () => void;
}) {
  const [contents, setContents] = useState<CategoryContents | null>(null);
  const [quickPhotos, setQuickPhotos] = useState(false);
  const [showCreateChild, setShowCreateChild] = useState(false);
  const [childName, setChildName] = useState("");
  const missingPhotoItems = useMemo(() => contents?.items.filter((item) => !item.primary_photo_url) || [], [contents]);
  const load = useCallback(async () => {
    setContents(await api.categoryContents(categoryId));
  }, [categoryId]);
  useEffect(() => {
    let active = true;
    setContents(null);
    load().catch(() => { if (active) setContents(null); });
    return () => { active = false; };
  }, [categories, load]);
  if (!contents) return <section className="locations-page"><button className="text-button" onClick={onBack}>Back to categories</button><EmptyState icon="tag" title={busy ? "Loading category" : "Category unavailable"} text="Open a category from the hierarchy." /></section>;
  async function createChildCategory(event: FormEvent) {
    event.preventDefault();
    if (!contents || !childName.trim()) return;
    await onCreateCategoryHere(childName.trim(), contents.category.id);
    setChildName("");
    setShowCreateChild(false);
    await load();
  }
  return (
    <section className="locations-page">
      <button className="text-button" onClick={onBack}>Back to categories</button>
      <div className="detail-hero"><div><p className="eyebrow">CATEGORY</p><h1>{contents.category.name}</h1><CategoryCrumbs category={contents.category} categories={categories} onOpen={onOpenCategory} /></div><div className="detail-hero-actions"><button className="primary button-with-icon" onClick={() => setShowCreateChild((value) => !value)}><Icon name="plus" size={16} />Add category here</button><button className="secondary" onClick={() => onInventory(contents.category.id)}>Show in inventory</button><button className="secondary button-with-icon" disabled={missingPhotoItems.length === 0} onClick={() => setQuickPhotos(true)}><Icon name="camera" size={16} />Photos {missingPhotoItems.length}</button></div></div>
      {showCreateChild && <form className="inline-detail-create" onSubmit={createChildCategory}><label>New child category<input required autoFocus value={childName} onChange={(event) => setChildName(event.target.value)} placeholder={`Inside ${contents.category.name}`} /></label><div className="button-row"><button type="button" onClick={() => { setShowCreateChild(false); setChildName(""); }}>Cancel</button><button className="secondary" disabled={busy || !childName.trim()}>Create category</button></div></form>}
      <div className="location-overview"><div><span>Direct items</span><strong>{contents.category.item_count}</strong></div><div><span>Including children</span><strong>{contents.category.total_item_count}</strong></div><div><span>Default location</span><strong>{contents.category.default_location?.name || "Inherited"}</strong></div></div>
      {contents.children.length > 0 && <section className="detail-section"><div className="section-heading"><div><h2>Child categories</h2><span>{contents.children.length} below this level</span></div></div><div className="child-location-grid">{contents.children.map((child) => <button key={child.id} onClick={() => onOpenCategory(child.id)}><Icon name="tag" size={18} /><strong>{child.name}</strong><small>{child.total_item_count} item{child.total_item_count === 1 ? "" : "s"}</small></button>)}</div></section>}
      <DetailItemsBrowser items={contents.items} groupMode="location" emptyText="Items assigned to this category or its children will appear here." onOpenItem={onOpenItem} busy={busy} />
      {quickPhotos && <QuickPhotoSession title={contents.category.name} items={missingPhotoItems} onDone={async () => { setQuickPhotos(false); await load(); }} onClose={() => setQuickPhotos(false)} />}
    </section>
  );
}

function LocationDetailView({ locationId, locations, categories, locationTypes, busy, onQueuePrint, onOpenItem, onOpenLocation, onAddHere, onCreateLocationHere, onDefaultsChanged, onBack }: {
  locationId: string;
  locations: LocationNode[];
  categories: Category[];
  locationTypes: LocationType[];
  busy: boolean;
  onQueuePrint: (location: LocationNode) => void;
  onOpenItem: (item: Item) => void;
  onOpenLocation: (publicId: string) => void;
  onAddHere: (publicId: string) => void;
  onCreateLocationHere: (body: { name: string; kind: string; parent_public_id: string | null }) => Promise<void>;
  onDefaultsChanged: () => Promise<void>;
  onBack: () => void;
}) {
  const [contents, setContents] = useState<LocationContents | null>(null);
  const [rules, setRules] = useState<LocationRule[]>([]);
  const [defaultType, setDefaultType] = useState<"category" | "name" | "barcode">("category");
  const [defaultCategoryId, setDefaultCategoryId] = useState("");
  const [defaultMatch, setDefaultMatch] = useState("");
  const [editingDefaultId, setEditingDefaultId] = useState("");
  const [editingDefaultType, setEditingDefaultType] = useState<"category" | "name" | "barcode">("category");
  const [editingDefaultCategoryId, setEditingDefaultCategoryId] = useState("");
  const [editingDefaultMatch, setEditingDefaultMatch] = useState("");
  const [error, setError] = useState("");
  const [quickPhotos, setQuickPhotos] = useState(false);
  const [aiScanOpen, setAiScanOpen] = useState(false);
  const [showCreateChild, setShowCreateChild] = useState(false);
  const [childName, setChildName] = useState("");
  const [childKind, setChildKind] = useState(locationTypes[0]?.name || "location");
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const missingPhotoItems = useMemo(() => contents?.items.filter((item) => !item.primary_photo_url) || [], [contents]);
  const load = useCallback(async () => {
    try {
      setError("");
      setContents(await api.locationContents(locationId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load location");
    }
  }, [locationId]);
  const loadDefaults = useCallback(async () => {
    setRules(await api.locationRules());
  }, []);
  useEffect(() => { void load(); void loadDefaults(); }, [load, loadDefaults]);
  useEffect(() => {
    if (!locationTypes.some((entry) => entry.name === childKind)) {
      setChildKind(locationTypes[0]?.name || "location");
    }
  }, [childKind, locationTypes]);
  if (error) return <section className="location-detail-page"><button className="text-button" onClick={onBack}>Back to Places</button><div className="inline-alert">{error}</div></section>;
  if (!contents) return <div className="dashboard-skeleton" aria-label="Loading Place"><span /><span /><span /></div>;
  const currentLocation = contents.location;
  const currentLocationChain = findLocationChain(currentLocation.path, flatLocations);
  const locationRules = rules.filter((rule) => rule.location_public_id === currentLocation.public_id);
  const categoryDefaults = locationRules.filter((rule) => rule.rule_type === "category");
  const itemDefaults = locationRules.filter((rule) => rule.rule_type !== "category");
  async function addDefault(event: FormEvent) {
    event.preventDefault();
    const category = categories.find((entry) => String(entry.id) === defaultCategoryId);
    const match = defaultType === "category" ? category && categoryOptionLabel(category) : defaultMatch.trim();
    if (!match) return;
    await api.createLocationRule({
      rule_type: defaultType,
      match_value: match,
      location_public_id: currentLocation.public_id,
      priority: defaultType === "barcode" ? 500 : 100,
    });
    setDefaultMatch("");
    setDefaultCategoryId("");
    await loadDefaults();
    await onDefaultsChanged();
  }
  function startEditDefault(rule: LocationRule) {
    setEditingDefaultId(rule.public_id);
    setEditingDefaultType(rule.rule_type);
    setEditingDefaultMatch(rule.match_value);
    setEditingDefaultCategoryId(
      rule.rule_type === "category"
        ? String(categories.find((entry) => categoryOptionLabel(entry) === rule.match_value)?.id || "")
        : "",
    );
  }
  async function saveDefault(event: FormEvent) {
    event.preventDefault();
    const category = categories.find((entry) => String(entry.id) === editingDefaultCategoryId);
    const match = editingDefaultType === "category" ? category && categoryOptionLabel(category) : editingDefaultMatch.trim();
    if (!editingDefaultId || !match) return;
    await api.updateLocationRule(editingDefaultId, {
      rule_type: editingDefaultType,
      match_value: match,
      location_public_id: currentLocation.public_id,
      priority: editingDefaultType === "barcode" ? 500 : 100,
    });
    setEditingDefaultId("");
    await loadDefaults();
    await onDefaultsChanged();
  }
  async function removeDefault(rule: LocationRule) {
    if (!window.confirm(`Delete this ${rule.rule_type} default?\n\n${rule.match_value} → ${rule.location_name}`)) return;
    await api.deleteLocationRule(rule.public_id);
    await loadDefaults();
    await onDefaultsChanged();
  }
  async function createChildLocation(event: FormEvent) {
    event.preventDefault();
    if (!childName.trim()) return;
    await onCreateLocationHere({
      name: childName.trim(),
      kind: childKind,
      parent_public_id: currentLocation.public_id,
    });
    setChildName("");
    setShowCreateChild(false);
    await load();
  }
  function defaultRuleRow(rule: LocationRule) {
    if (editingDefaultId === rule.public_id) {
      return <form className="default-chip editing" key={rule.public_id} onSubmit={saveDefault}><label>Type<select value={editingDefaultType} onChange={(event) => setEditingDefaultType(event.target.value as "category" | "name" | "barcode")}><option value="category">Category</option><option value="name">Item name contains</option><option value="barcode">Exact barcode</option></select></label>{editingDefaultType === "category" ? <label>Category<select required value={editingDefaultCategoryId} onChange={(event) => setEditingDefaultCategoryId(event.target.value)}><option value="">Choose category</option>{categories.map((category) => <option key={category.id} value={category.id}>{categoryOptionLabel(category)}</option>)}</select></label> : <label>Match<input required value={editingDefaultMatch} onChange={(event) => setEditingDefaultMatch(event.target.value)} /></label>}<div><button type="button" onClick={() => setEditingDefaultId("")}>Cancel</button><button className="secondary" disabled={editingDefaultType === "category" ? !editingDefaultCategoryId : !editingDefaultMatch.trim()}>Save</button></div></form>;
    }
    return <p className="default-chip" key={rule.public_id}><span>{rule.rule_type === "category" ? rule.match_value : `${rule.rule_type}: ${rule.match_value}`}</span><button type="button" onClick={() => startEditDefault(rule)} aria-label={`Edit ${rule.match_value} default`}><Icon name="settings" size={13} /></button><button type="button" onClick={() => void removeDefault(rule)} aria-label={`Remove ${rule.match_value} default`}><Icon name="close" size={13} /></button></p>;
  }
  return (
    <section className="location-detail-page">
      <div className="page-heading"><div><h1>{currentLocation.name}</h1><LocationCrumbs chain={currentLocationChain} fallback={currentLocation.path} onOpen={onOpenLocation} /><p>{contents.items.length} Item{contents.items.length === 1 ? "" : "s"} including nested Places.</p></div><button className="icon-button" onClick={onBack} aria-label="Back to Places"><Icon name="close" /></button></div>
      <div className="location-actions"><button className="primary button-with-icon" onClick={() => onAddHere(currentLocation.public_id)}><Icon name="plus" size={17} />Add Item</button><button className="ai-scan-action button-with-icon" onClick={() => setAiScanOpen(true)}><Icon name="spark" size={17} />AI Scan</button><button className="secondary button-with-icon" onClick={() => setShowCreateChild((value) => !value)}><Icon name="plus" size={17} />Add Place</button><button className="secondary button-with-icon" disabled={missingPhotoItems.length === 0} onClick={() => setQuickPhotos(true)}><Icon name="camera" size={17} />Photos {missingPhotoItems.length}</button><button type="button" className="secondary button-with-icon" onClick={() => onQueuePrint(currentLocation)}><Icon name="qr" size={17} />Print QR</button></div>
      {showCreateChild && <form className="inline-detail-create" onSubmit={createChildLocation}><label>New Place<input required autoFocus value={childName} onChange={(event) => setChildName(event.target.value)} placeholder={`Inside ${currentLocation.name}`} /></label><label>Type<select value={childKind} onChange={(event) => setChildKind(event.target.value)}>{locationTypes.map((entry) => <option value={entry.name} key={entry.name}>{entry.name}</option>)}</select></label><div className="button-row"><button type="button" onClick={() => { setShowCreateChild(false); setChildName(""); }}>Cancel</button><button className="secondary" disabled={busy || !childName.trim()}>Create Place</button></div></form>}
      <details className="detail-section defaults-section"><summary><span><Icon name="settings" size={16} />Defaults here</span><Icon name="chevron" size={16} /></summary><div className="defaults-section-body"><div className="defaults-grid"><div><strong>Categories</strong>{categoryDefaults.length ? categoryDefaults.map(defaultRuleRow) : <small>No category defaults</small>}</div><div><strong>Items and barcodes</strong>{itemDefaults.length ? itemDefaults.map(defaultRuleRow) : <small>No item defaults</small>}</div></div><form className="default-rule-form" onSubmit={addDefault}><label>Default type<select value={defaultType} onChange={(event) => setDefaultType(event.target.value as "category" | "name" | "barcode")}><option value="category">Category</option><option value="name">Item name contains</option><option value="barcode">Exact barcode</option></select></label>{defaultType === "category" ? <label>Category<select required value={defaultCategoryId} onChange={(event) => setDefaultCategoryId(event.target.value)}><option value="">Choose category</option>{categories.map((category) => <option key={category.id} value={category.id}>{categoryOptionLabel(category)}</option>)}</select></label> : <label>Match<input required inputMode={defaultType === "barcode" ? "numeric" : "text"} value={defaultMatch} onChange={(event) => setDefaultMatch(event.target.value)} placeholder={defaultType === "barcode" ? "8023263000534" : "SanBenedetto"} /></label>}<button className="secondary" disabled={defaultType === "category" ? !defaultCategoryId : !defaultMatch.trim()}>Add default</button></form></div></details>
      {contents.children.length > 0 && <section className="detail-section"><div className="section-heading"><div><h2>Inside this place</h2></div></div><div className="child-location-grid">{contents.children.map((child) => <button type="button" key={child.public_id} onClick={() => onOpenLocation(child.public_id)}><Icon name={child.kind === "box" || child.kind === "container" ? "box" : "pin"} /><strong>{child.name}</strong><small>{child.kind}</small></button>)}</div></section>}
      <DetailItemsBrowser items={contents.items} groupMode="category" emptyText="Scan this Place’s QR later to add Items directly here." onOpenItem={onOpenItem} busy={busy} />
      {quickPhotos && <QuickPhotoSession title={currentLocation.name} items={missingPhotoItems} onDone={async () => { setQuickPhotos(false); await load(); }} onClose={() => setQuickPhotos(false)} />}
      {aiScanOpen && <AIScanSession location={currentLocation} onClose={() => setAiScanOpen(false)} />}
    </section>
  );
}

type LocalAIScan = {
  id: string;
  preview: string;
  status: "uploading" | "queued" | "error";
  error?: string;
};

function AIScanSession({ location, onClose }: {
  location: LocationNode;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const pulseTimerRef = useRef<number | null>(null);
  const [scans, setScans] = useState<LocalAIScan[]>([]);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState("");
  const [pulse, setPulse] = useState(false);
  const uploading = scans.filter((entry) => entry.status === "uploading").length;
  const queued = scans.filter((entry) => entry.status === "queued").length;

  useEffect(() => {
    mountedRef.current = true;
    let stopped = false;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch {
        if (!stopped) setError("Live camera is unavailable. You can still use your phone’s camera below.");
      }
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Live camera is unavailable. You can still use your phone’s camera below.");
    } else {
      void startCamera();
    }
    return () => {
      stopped = true;
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewsRef.current.clear();
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    };
  }, []);

  function flash() {
    setPulse(true);
    if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setPulse(false);
      pulseTimerRef.current = null;
    }, 260);
  }

  function queue(blob: Blob, width?: number, height?: number, originalSizeBytes?: number) {
    const id = uid("ai-scan");
    const preview = URL.createObjectURL(blob);
    previewsRef.current.add(preview);
    setScans((current) => [{ id, preview, status: "uploading" as const }, ...current].slice(0, 12));
    flash();
    void api.createAiScan(location.public_id, blob, width, height, originalSizeBytes).then(() => {
      if (!mountedRef.current) return;
      setScans((current) => current.map((entry) => entry.id === id ? { ...entry, status: "queued" } : entry));
    }).catch((reason) => {
      if (!mountedRef.current) return;
      setScans((current) => current.map((entry) => entry.id === id ? {
        ...entry,
        status: "error",
        error: reason instanceof Error ? reason.message : "Upload failed",
      } : entry));
    });
  }

  async function snap() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const sourceSize = Math.min(video.videoWidth, video.videoHeight);
    const sourceX = Math.max(0, (video.videoWidth - sourceSize) / 2);
    const sourceY = Math.max(0, (video.videoHeight - sourceSize) / 2);
    const width = Math.max(1, Math.min(1280, sourceSize));
    const height = width;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(
      video,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      width,
      height,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not capture photo")), "image/jpeg", 0.78),
    );
    queue(blob, width, height, blob.size);
  }

  async function choosePhoto(file: File) {
    try {
      const resized = await prepareAiScanPhoto(file);
      queue(resized.blob, resized.width, resized.height, file.size);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not prepare photo");
    }
  }

  return (
    <div className="quick-photo-backdrop ai-scan-backdrop" role="dialog" aria-modal="true" aria-label="AI scan mode">
      <section className="quick-photo-sheet ai-scan-sheet">
        <button className="icon-button ai-scan-close" onClick={onClose} aria-label="Close AI scan mode"><Icon name="close" /></button>
        <div className={`quick-photo-camera ai-scan-camera ${pulse ? "pulsing" : ""}`}>
          <video ref={videoRef} playsInline muted />
          {!cameraReady && <div className="ai-camera-placeholder"><Icon name="camera" size={38} /><strong>{error ? "Camera unavailable" : "Opening camera…"}</strong></div>}
          <div className="ai-scan-target">
            <div className="ai-scan-frame" aria-hidden="true"><span>One item</span></div>
            <button className="primary ai-overlay-shutter" disabled={!cameraReady} onClick={() => void snap()} aria-label="Photograph item"><Icon name="camera" size={22} />Snap Item</button>
          </div>
        </div>
        {error && <div className="inline-alert">{error}</div>}
        <div className="ai-scan-status"><div><strong>{queued}</strong><span>sent to Inbox</span></div><div><strong>{uploading}</strong><span>{uploading === 1 ? "Uploading 1 photo" : `Uploading ${uploading} photos`}</span></div>{uploading > 0 && <small>AI processing continues in the background.</small>}</div>
        {scans.length > 0 && <div className="ai-scan-strip">{scans.map((entry) => <div className={entry.status} key={entry.id}><img src={entry.preview} alt="AI scan capture" /><span>{entry.status === "uploading" ? "Sending" : entry.status === "queued" ? "Queued" : "Failed"}</span>{entry.error && <small>{entry.error}</small>}</div>)}</div>}
        <div className="ai-scan-controls"><label className="secondary button-with-icon"><Icon name="camera" size={18} />Choose photo<input type="file" accept="image/*" capture="environment" hidden onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void choosePhoto(file); }} /></label><button onClick={onClose}>Done</button></div>
      </section>
    </div>
  );
}

function QuickPhotoSession({ title, items, onDone, onClose }: {
  title: string;
  items: Item[];
  onDone: () => Promise<void> | void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const [index, setIndex] = useState(0);
  const [captured, setCaptured] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pulse, setPulse] = useState("");
  const remaining = items.filter((item) => !captured.has(item.public_id) && !skipped.has(item.public_id));
  const current = remaining[index] || remaining[0] || null;
  const upcoming = remaining.filter((item) => item.public_id !== current?.public_id).slice(0, 3);
  useEffect(() => {
    let stopped = false;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        if (!stopped) setError("Camera access is blocked or unavailable.");
      }
    }
    if (!navigator.mediaDevices?.getUserMedia) setError("Camera is not available in this browser.");
    else void startCamera();
    return () => {
      stopped = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    };
  }, []);
  async function finish() {
    await onDone();
  }
  function videoCropRect(video: HTMLVideoElement) {
    const frame = frameRef.current;
    if (!frame) {
      const side = Math.min(video.videoWidth, video.videoHeight);
      return { sx: (video.videoWidth - side) / 2, sy: (video.videoHeight - side) / 2, side };
    }
    const videoBox = video.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    const renderedScale = Math.max(videoBox.width / video.videoWidth, videoBox.height / video.videoHeight);
    const renderedWidth = video.videoWidth * renderedScale;
    const renderedHeight = video.videoHeight * renderedScale;
    const offsetX = videoBox.left + (videoBox.width - renderedWidth) / 2;
    const offsetY = videoBox.top + (videoBox.height - renderedHeight) / 2;
    const sx = (frameBox.left - offsetX) / renderedScale;
    const sy = (frameBox.top - offsetY) / renderedScale;
    const side = frameBox.width / renderedScale;
    const clampedSide = Math.max(1, Math.min(side, video.videoWidth, video.videoHeight));
    return {
      sx: Math.max(0, Math.min(video.videoWidth - clampedSide, sx)),
      sy: Math.max(0, Math.min(video.videoHeight - clampedSide, sy)),
      side: clampedSide,
    };
  }
  function showPulse(message: string) {
    setPulse(message);
    if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => {
      setPulse("");
      pulseTimerRef.current = null;
    }, 520);
  }
  async function skipCurrent() {
    if (!current || busy) return;
    showPulse("Skipped");
    setSkipped((currentSet) => new Set(currentSet).add(current.public_id));
    setIndex(0);
    if (remaining.length <= 1) await finish();
  }
  async function capture() {
    if (!current || !videoRef.current || busy) return;
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) return;
    setBusy(true);
    setError("");
    showPulse("Captured");
    try {
      const crop = videoCropRect(video);
      const scale = Math.min(1, 1200 / crop.side);
      const width = Math.max(1, Math.round(crop.side * scale));
      const height = width;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")?.drawImage(video, crop.sx, crop.sy, crop.side, crop.side, 0, 0, width, height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not capture photo")), "image/jpeg", 0.86),
      );
      await api.uploadPhoto(current, blob, width, height);
      showPulse("Uploaded");
      setCaptured((currentSet) => new Set(currentSet).add(current.public_id));
      setIndex(0);
      if (remaining.length <= 1) await finish();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Photo upload failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="quick-photo-backdrop" role="dialog" aria-modal="true" aria-label="Quick photo mode">
      <section className="quick-photo-sheet">
        <header><div><p className="eyebrow">QUICK PHOTOS</p><h2>{title}</h2><span>{current ? `${captured.size + skipped.size + 1} of ${items.length}` : "All photos done"}</span></div><button className="icon-button" onClick={onClose} aria-label="Close quick photo mode"><Icon name="close" /></button></header>
        <div className={`quick-photo-camera ${pulse ? "pulsing" : ""}`}><video ref={videoRef} playsInline muted />{current && <div ref={frameRef} className="thumbnail-frame" aria-hidden="true"><span>Thumbnail crop</span></div>}{pulse && <div className="quick-photo-pulse"><Icon name={pulse === "Skipped" ? "chevron" : "check"} size={24} /><span>{pulse}</span></div>}{!current && <div><Icon name="check" size={38} /><strong>All set</strong></div>}</div>
        {current ? <div className="quick-photo-item"><strong>{current.name}</strong><small>{categoryLabel(current) || "Uncategorised"} · {current.location_path}</small></div> : <button className="primary wide" onClick={() => void finish()}>Done</button>}
        {upcoming.length > 0 && <div className="quick-photo-queue"><strong>Next</strong>{upcoming.map((item) => <span key={item.public_id}>{item.name}</span>)}</div>}
        {error && <div className="inline-alert">{error}</div>}
        {current && <div className="quick-photo-controls"><button className="secondary" disabled={busy} onClick={() => void skipCurrent()}>Skip</button><button className="primary quick-shutter" disabled={busy || Boolean(error)} onClick={() => void capture()}><Icon name="camera" size={22} />{busy ? "Uploading..." : "Take photo"}</button></div>}
      </section>
    </div>
  );
}

async function resizePhoto(file: File): Promise<{ blob: Blob; width?: number; height?: number }> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not resize photo")), "image/jpeg", 0.84),
    );
    return { blob, width, height };
  } catch {
    return { blob: file };
  }
}

async function prepareAiScanPhoto(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  const bitmap = await createImageBitmap(file);
  try {
    const sourceSize = Math.min(bitmap.width, bitmap.height);
    const sourceX = Math.max(0, (bitmap.width - sourceSize) / 2);
    const sourceY = Math.max(0, (bitmap.height - sourceSize) / 2);
    const size = Math.max(1, Math.min(1280, sourceSize));
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare photo");
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      size,
      size,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error("Could not prepare photo")),
        "image/jpeg",
        0.78,
      ),
    );
    return { blob, width: size, height: size };
  } finally {
    bitmap.close();
  }
}

function findLocationChain(path: string, flatLocations: LocationNode[]): LocationNode[] {
  const parts = path.split(">").map((part) => part.trim()).filter(Boolean);
  const chain: LocationNode[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const partial = parts.slice(0, index + 1).join(" > ");
    const match = flatLocations.find((location) => location.path === partial);
    if (match) chain.push(match);
  }
  return chain;
}

function LocationCrumbs({ chain, fallback, onOpen, compact = false }: {
  chain: LocationNode[];
  fallback: string;
  onOpen: (publicId: string) => void;
  compact?: boolean;
}) {
  if (chain.length === 0) {
    return <span className="location-crumbs"><Icon name="pin" size={13} />{fallback || "Unassigned"}</span>;
  }
  return (
    <span className={`location-crumbs ${compact ? "compact" : ""}`}>
      <Icon name="pin" size={13} />
      {chain.map((location, index) => (
        <span key={location.public_id} className="crumb-part">
          {index > 0 && <span aria-hidden="true">/</span>}
          <button type="button" onClick={() => onOpen(location.public_id)}>{location.name}</button>
        </span>
      ))}
    </span>
  );
}

function CategoryCrumbs({ category, categories, onOpen }: {
  category: Category;
  categories: Category[];
  onOpen: (categoryId: number) => void;
}) {
  const chain: Category[] = [];
  let current: Category | undefined = category;
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parent_id === null ? undefined : categories.find((entry) => entry.id === current?.parent_id);
  }
  return (
    <span className="location-crumbs">
      <Icon name="tag" size={13} />
      {chain.map((entry, index) => (
        <span key={entry.id} className="crumb-part">
          {index > 0 && <span aria-hidden="true">/</span>}
          <button type="button" onClick={() => onOpen(entry.id)}>{entry.name}</button>
        </span>
      ))}
    </span>
  );
}

function DetailItemsBrowser({ items, groupMode, emptyText, onOpenItem, busy }: {
  items: Item[];
  groupMode: "category" | "location";
  emptyText: string;
  onOpenItem: (item: Item) => void;
  busy: boolean;
}) {
  const [sort, setSort] = useState<DetailItemSort>("name");
  const [view, setView] = useState<DetailItemView>("grid");
  const sortedItems = useMemo(() => {
    const next = [...items];
    next.sort((left, right) => {
      if (sort === "quantity-asc") return Number(left.quantity) - Number(right.quantity) || left.name.localeCompare(right.name);
      if (sort === "quantity-desc") return Number(right.quantity) - Number(left.quantity) || left.name.localeCompare(right.name);
      if (sort === "location") return left.location_path.localeCompare(right.location_path) || left.name.localeCompare(right.name);
      if (sort === "category") return categoryLabel(left).localeCompare(categoryLabel(right)) || left.name.localeCompare(right.name);
      return left.name.localeCompare(right.name);
    });
    return next;
  }, [items, sort]);
  const grouped = useMemo(() => {
    const groups = new Map<string, Item[]>();
    for (const item of sortedItems) {
      const label = groupMode === "category" ? categoryLabel(item) || "Uncategorised" : item.location_path || "Unassigned";
      groups.set(label, [...(groups.get(label) || []), item]);
    }
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [groupMode, sortedItems]);
  return (
    <section className="detail-section">
      <div className="section-heading detail-items-heading"><div><h2>Items here</h2><span>{items.length} item{items.length === 1 ? "" : "s"} including nested levels</span></div><div className="detail-item-controls"><select value={sort} onChange={(event) => setSort(event.target.value as DetailItemSort)} aria-label="Sort items"><option value="name">Name</option><option value="quantity-asc">Quantity low</option><option value="quantity-desc">Quantity high</option><option value="location">Location</option><option value="category">Category</option></select><div><button type="button" className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>Grid</button><button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")}>List</button></div></div></div>
      {items.length === 0 ? <EmptyState icon="box" title="No items here" text={emptyText} /> : grouped.map(([group, groupItems]) => <div className="detail-item-group" key={group}><h3>{group}<span>{groupItems.length}</span></h3><div className={view === "grid" ? "location-item-grid" : "location-item-list"}>{groupItems.map((item) => <button type="button" className={view === "grid" ? "location-item-card" : "location-item-row"} key={item.public_id} onClick={() => onOpenItem(item)} disabled={busy}>{item.primary_photo_url ? <img src={item.primary_photo_url} alt="" loading="lazy" /> : <span><Icon name="box" size={view === "grid" ? 24 : 18} /></span>}<strong>{item.name}</strong><small>{groupMode === "category" ? item.location_path : categoryLabel(item) || "Uncategorised"}</small><em>{item.quantity} {item.unit}</em></button>)}</div></div>)}
    </section>
  );
}

function offFieldLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function OffDataValue({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (value === null || value === undefined || value === "") return <span className="off-empty">—</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "string" || typeof value === "number") return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.every((entry) => ["string", "number", "boolean"].includes(typeof entry))) {
      return <div className="off-value-chips">{value.map((entry, index) => <span key={`${index}-${String(entry)}`}>{String(entry)}</span>)}</div>;
    }
    return <div className="off-nested-list">{value.map((entry, index) => <div key={index}><strong>#{index + 1}</strong><OffDataValue value={entry} depth={depth + 1} /></div>)}</div>;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (depth >= 3) return <pre>{JSON.stringify(value, null, 2)}</pre>;
    return <dl className="off-nested-data">{entries.map(([key, entry]) => <div key={key}><dt>{offFieldLabel(key)}</dt><dd><OffDataValue value={entry} depth={depth + 1} /></dd></div>)}</dl>;
  }
  return <span>{String(value)}</span>;
}

function ProductDataExplorer({ payload, onClose }: {
  payload: FullOffProduct;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const preferred = ["product_name", "brands", "quantity", "categories", "ingredients_text", "ingredients", "allergens", "traces", "nutriments", "nutriscore_grade", "nova_group", "environmental_score_grade"];
  const entries = Object.entries(payload.product).sort(([left], [right]) => {
    const leftRank = preferred.indexOf(left);
    const rightRank = preferred.indexOf(right);
    return (leftRank < 0 ? 999 : leftRank) - (rightRank < 0 ? 999 : rightRank) || left.localeCompare(right);
  });
  const term = query.trim().toLocaleLowerCase();
  const visible = entries.filter(([key, value]) => !term || `${key} ${JSON.stringify(value)}`.toLocaleLowerCase().includes(term));
  return <div className="modal-backdrop product-data-backdrop" role="dialog" aria-modal="true" aria-label="All Open Food Facts product data" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><article className="product-data-sheet"><header><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button><div><p className="eyebrow">{payload.source}</p><h2>All product data</h2><span>{entries.length} top-level fields</span></div>{payload.source_url && <a href={payload.source_url} target="_blank" rel="noreferrer">Open source</a>}</header><label className="search"><Icon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ingredients, allergens, nutrition, packaging…" /></label><div className="off-field-list">{visible.map(([key, value]) => <details key={key} open={preferred.includes(key)}><summary><strong>{offFieldLabel(key)}</strong><code>{key}</code></summary><div><OffDataValue value={value} /></div></details>)}</div></article></div>;
}

function ItemDetail({ item, allItems, locations, categories, units, busy, embedded = false, onClose, onChanged, onQuickAdjust, onQuickMove, onAddShopping, onMarkLost, onMarkFound, onForeverLost, onDeleteItem, onOpenLocation, onOpenTag, run }: {
  item: Item;
  allItems: Item[];
  locations: LocationNode[];
  categories: Category[];
  units: string[];
  busy: boolean;
  embedded?: boolean;
  onClose: () => void;
  onChanged: (item: Item) => Promise<void>;
  onQuickAdjust: (item: Item, delta: number) => Promise<void>;
  onQuickMove: (item: Item, destinationPublicId: string) => Promise<void>;
  onAddShopping: (item: Item) => Promise<void>;
  onMarkLost: (item: Item) => Promise<void>;
  onMarkFound: (item: Item) => Promise<void>;
  onForeverLost: (item: Item) => Promise<void>;
  onDeleteItem: (item: Item) => Promise<void>;
  onOpenLocation: (publicId: string) => void;
  onOpenTag: (tag: string) => void;
  run: (action: () => Promise<unknown>, success: string, scope?: RefreshScope, options?: ActionOptions) => Promise<void>;
}) {
  const photoRail = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [detailTab, setDetailTab] = useState<"overview" | "details" | "activity" | "more">("overview");
  const [picker, setPicker] = useState<"move" | "category" | "editCategory" | null>(null);
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description);
  const [notes, setNotes] = useState(item.notes);
  const [brand, setBrand] = useState(item.brand);
  const [model, setModel] = useState(item.model);
  const [serial, setSerial] = useState(item.serial_number);
  const [expiration, setExpiration] = useState(item.expiration_date || "");
  const [threshold, setThreshold] = useState(item.low_stock_threshold || "");
  const [unit, setUnit] = useState(item.unit);
  const [category, setCategory] = useState(item.category_id ? String(item.category_id) : "");
  const [tags, setTags] = useState(item.tags.join(", "));
  const [linksValue, setLinksValue] = useState(linkText(item.links || []));
  const [purchasePrice, setPurchasePrice] = useState(item.purchase_price_minor === null ? "" : String(item.purchase_price_minor / 100));
  const [estimatedPrice, setEstimatedPrice] = useState(item.estimated_price_minor === null ? "" : String(item.estimated_price_minor / 100));
  const [weight, setWeight] = useState(item.weight_g === null ? "" : String(item.weight_g));
  const [dimensions, setDimensions] = useState<string[]>(
    [item.length_mm, item.width_mm, item.height_mm].map((value) =>
      value === null ? "" : String(value),
    ),
  );
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [documents, setDocuments] = useState<ItemDocument[]>([]);
  const [lots, setLots] = useState<ItemLot[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceTask[]>([]);
  const [lotQuantity, setLotQuantity] = useState("1");
  const [lotExpiration, setLotExpiration] = useState("");
  const [lotNote, setLotNote] = useState("");
  const [maintenanceTitle, setMaintenanceTitle] = useState("");
  const [maintenanceInterval, setMaintenanceInterval] = useState("30");
  const [maintenanceNotes, setMaintenanceNotes] = useState("");
  const [enrichment, setEnrichment] = useState<Enrichment>({ product: null, full_product_available: false, jobs: [], candidates: [] });
  const [showAllProductData, setShowAllProductData] = useState(false);
  const [fullProductData, setFullProductData] = useState<FullOffProduct | null>(null);
  const [related, setRelated] = useState<RelatedItem[]>([]);
  const [relatedGroupMode, setRelatedGroupMode] = useState<"category" | "location">("category");
  const [relatedQuery, setRelatedQuery] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [reservations, setReservations] = useState<ItemReservation[]>([]);
  const [defaultRules, setDefaultRules] = useState<LocationRule[]>([]);
  const [reservationProject, setReservationProject] = useState("");
  const [reservationQuantity, setReservationQuantity] = useState("1");
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const locationNodes = useMemo(() => locationPickerNodes(locations), [locations]);
  const categoryNodes = useMemo(() => categoryPickerNodes(categories), [categories]);
  const locationChain = useMemo(() => findLocationChain(item.location_path, flatLocations), [flatLocations, item.location_path]);
  const detailCapabilities = capabilitiesForCategory(categories, item.category_id);
  const editCapabilities = capabilitiesForCategory(categories, category);

  useEffect(() => {
    if (embedded && window.matchMedia("(min-width: 1100px)").matches) return;
    const scrollTop = window.scrollY;
    const previous = {
      bodyOverflow: document.body.style.overflow,
      bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top,
      bodyWidth: document.body.style.width,
    };
    document.documentElement.classList.add("item-detail-open");
    document.body.classList.add("item-detail-open");
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollTop}px`;
    document.body.style.width = "100%";
    return () => {
      document.documentElement.classList.remove("item-detail-open");
      document.body.classList.remove("item-detail-open");
      document.body.style.overflow = previous.bodyOverflow;
      document.body.style.position = previous.bodyPosition;
      document.body.style.top = previous.bodyTop;
      document.body.style.width = previous.bodyWidth;
      window.scrollTo(0, scrollTop);
    };
  }, [embedded]);

  useEffect(() => {
    if (photos.length) photoRail.current?.scrollTo({ left: 0 });
  }, [photos.length]);
  const editingCategory = category ? categories.find((entry) => String(entry.id) === category) || null : null;
  const activeProjects = useMemo(() => projects.filter((project) => project.status === "active"), [projects]);
  const showBatchData = detailCapabilities.batches;
  const showMaintenanceData = detailCapabilities.maintenance || maintenance.length > 0;
  const showReservationData = reservations.length > 0;
  const itemLinks = item.links || [];
  const showLinksData = detailCapabilities.links || itemLinks.length > 0;
  const showEnrichmentData = detailCapabilities.enrichment;
  const itemDefaultRule = defaultRules.find((rule) => (
    rule.rule_type === (item.barcode ? "barcode" : "name") &&
    rule.match_value.toLocaleLowerCase() === (item.barcode || item.name).toLocaleLowerCase()
  )) || null;
  const relatedIds = useMemo(() => new Set(related.map((entry) => entry.public_id)), [related]);
  const relatedCandidates = useMemo(() => {
    const query = relatedQuery.trim().toLocaleLowerCase();
    return allItems
      .filter((entry) => entry.public_id !== item.public_id && !relatedIds.has(entry.public_id))
      .filter((entry) => {
        if (!query) return true;
        return [
          entry.name,
          entry.location_path,
          categoryLabel(entry),
          entry.brand,
          entry.model,
          ...entry.tags,
        ].join(" ").toLocaleLowerCase().includes(query);
      })
      .slice(0, 8);
  }, [allItems, item.public_id, relatedIds, relatedQuery]);
  const relatedGroups = useMemo(() => {
    const groups = new Map<string, RelatedItem[]>();
    for (const entry of related) {
      const label = relatedGroupMode === "category"
        ? categoryLabel(entry) || "Uncategorised"
        : entry.location_path || "Unassigned";
      groups.set(label, [...(groups.get(label) || []), entry]);
    }
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [related, relatedGroupMode]);

  const loadExtras = useCallback(async () => {
    try {
      const [detail, nextProjects, nextRules] = await Promise.all([api.itemDetail(item.public_id), api.projects(), api.locationRules()]);
      setHistory(detail.history);
      setPhotos(detail.photos);
      setDocuments(detail.documents);
      setEnrichment(detail.enrichment);
      setLots(detail.lots);
      setMaintenance(detail.maintenance);
      setReservations(detail.reservations);
      setRelated(detail.related);
      setProjects(nextProjects);
      setDefaultRules(nextRules);
      setReservationProject((current) => (
        current && nextProjects.some((project) => project.public_id === current && project.status === "active")
          ? current
          : nextProjects.find((project) => project.status === "active")?.public_id || ""
      ));
    } catch {
      // The core item is already visible; keep the sheet usable if optional data fails.
    }
  }, [item.public_id]);
  useEffect(() => { void loadExtras(); }, [loadExtras]);
  useEffect(() => {
    if (embedded && window.matchMedia("(min-width: 1100px)").matches) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [embedded, onClose]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const updated = await api.updateItem(item, {
      name,
      description,
      notes,
      brand: editCapabilities.identity ? brand : "",
      model: editCapabilities.specs ? model : "",
      unit,
      serial_number: editCapabilities.identity ? serial : "",
      expiration_date: editCapabilities.expiration ? expiration || null : null,
      low_stock_threshold: threshold || null,
      category_id: category ? Number(category) : null,
      purchase_price_minor: editCapabilities.price && purchasePrice ? Math.round(Number(purchasePrice) * 100) : null,
      purchase_currency: editCapabilities.price && purchasePrice ? "EUR" : null,
      estimated_price_minor: editCapabilities.price && estimatedPrice ? Math.round(Number(estimatedPrice) * 100) : null,
      estimated_price_currency: editCapabilities.price && estimatedPrice ? "EUR" : null,
      weight_g: editCapabilities.specs && weight ? Number(weight) : null,
      length_mm: editCapabilities.specs && dimensions[0] !== "" ? Number(dimensions[0]) : null,
      width_mm: editCapabilities.specs && dimensions[1] !== "" ? Number(dimensions[1]) : null,
      height_mm: editCapabilities.specs && dimensions[2] !== "" ? Number(dimensions[2]) : null,
      links: editCapabilities.links ? parseLinkText(linksValue) : [],
    });
    const tagged = await api.setTags(updated, tags.split(",").map((tag) => tag.trim()).filter(Boolean));
    await onChanged(tagged);
    setEditing(false);
  }

  async function upload(file: File) {
    const resized = await resizePhoto(file);
    await api.uploadPhoto(item, resized.blob, resized.width, resized.height);
    await loadExtras();
  }

  async function addLot(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.createLot(item, {
        quantity: lotQuantity,
        expiration_date: lotExpiration || null,
        note: lotNote,
      });
      const refreshed = await api.item(item.public_id);
      await onChanged(refreshed);
      await loadExtras();
    }, "Batch added");
    setLotQuantity("1");
    setLotExpiration("");
    setLotNote("");
  }

  async function addMaintenance(event: FormEvent) {
    event.preventDefault();
    const interval = Math.max(1, Number(maintenanceInterval) || 30);
    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + interval);
    await run(async () => {
      await api.createMaintenance(item, {
        title: maintenanceTitle,
        notes: maintenanceNotes,
        interval_days: interval,
        last_completed_at: null,
        next_due_at: nextDue.toISOString().slice(0, 10),
      });
      await loadExtras();
    }, "Maintenance task added");
    setMaintenanceTitle("");
    setMaintenanceInterval("30");
    setMaintenanceNotes("");
  }

  async function addReservation(event: FormEvent) {
    event.preventDefault();
    const project = activeProjects.find((entry) => entry.public_id === reservationProject);
    if (!project) return;
    await run(async () => {
      await api.reserveItem(project, item, reservationQuantity);
      await loadExtras();
    }, "Reservation saved");
  }

  async function removeReservation(reservation: ItemReservation) {
    const project = projects.find((entry) => entry.public_id === reservation.project_public_id);
    if (!project) return;
    await run(async () => {
      await api.removeReservation(project, item.public_id);
      await loadExtras();
    }, "Reservation removed");
  }

  async function addRelatedItem(relatedItem: Item) {
    await run(async () => {
      await api.relateItem(item, relatedItem.public_id);
      setRelatedQuery("");
      await loadExtras();
    }, "Related item linked", "inventory");
  }

  async function removeRelatedItem(relatedItem: RelatedItem) {
    await run(async () => {
      await api.deleteRelationship(item, relatedItem.relationship_public_id);
      await loadExtras();
    }, "Related item removed", "inventory");
  }

  async function setItemDefault() {
    await run(async () => {
      await api.setDefaultLocation(item, item.location_public_id);
      setDefaultRules(await api.locationRules());
    }, "Default location saved for future adds");
  }

  async function removeItemDefault(rule: LocationRule) {
    if (!window.confirm(`Delete this ${rule.rule_type} default?\n\n${rule.match_value} → ${rule.location_name}`)) return;
    await run(async () => {
      await api.deleteLocationRule(rule.public_id);
      setDefaultRules(await api.locationRules());
    }, "Default location removed");
  }

  async function openAllProductData() {
    try {
      setFullProductData(await api.fullEnrichment(item));
      setShowAllProductData(true);
    } catch {
      run(async () => {
        await api.queueEnrichment(item);
        await api.runEnrichment();
        await loadExtras();
        setFullProductData(await api.fullEnrichment(item));
        setShowAllProductData(true);
      }, "Full Open Food Facts data downloaded");
    }
  }

  const lost = hasLostTag(item);
  const brandPrefix = item.brand.trim() && !item.name.trim().toLocaleLowerCase().startsWith(item.brand.trim().toLocaleLowerCase())
    ? item.brand.trim()
    : "";

  async function moveToLocation(locationPublicId: string) {
    if (locationPublicId === item.location_public_id) return;
    await onQuickMove(item, locationPublicId);
  }

  async function changeCategory(categoryId: string) {
    const nextCategoryId = categoryId ? Number(categoryId) : null;
    if ((item.category_id ?? null) === nextCategoryId) return;
    await run(async () => {
      const updated = await api.updateItem(item, { category_id: nextCategoryId });
      await onChanged(updated);
    }, "Category updated", "inventory");
  }

  const desktopEmbedded = embedded && window.matchMedia("(min-width: 1100px)").matches;
  return (
    <div className={embedded ? "embedded-item-detail item-detail-backdrop" : "modal-backdrop item-detail-backdrop"} role="dialog" aria-modal={desktopEmbedded ? undefined : "true"} aria-label={item.name} onMouseDown={(event) => { if (!desktopEmbedded && event.target === event.currentTarget) onClose(); }}>
      <article className="detail-sheet">
        <div className="sheet-handle" aria-hidden="true" />
        <header className="detail-header"><button className="icon-button" onClick={onClose} aria-label="Close item"><Icon name="close" /></button><div><small>{categoryLabel(item) || "Uncategorised"}</small><h1>{brandPrefix && <span className="item-brand-prefix">{brandPrefix} </span>}{item.name}</h1><LocationCrumbs chain={locationChain} fallback={item.location_path} onOpen={onOpenLocation} /></div><button className="text-button" onClick={() => setEditing(!editing)}>{editing ? "Cancel" : "Edit"}</button></header>
        {(detailCapabilities.photos || photos.length > 0) && <section className="detail-photo-hero" aria-label="Item photos">
          <div className="detail-photo-rail" ref={photoRail}>
            {photos.map((photo, index) => <figure key={photo.public_id}><img src={photo.url} alt={`${item.name} photo ${index + 1}`} /><button aria-label={`Delete photo ${index + 1}`} onClick={() => run(() => api.deletePhoto(photo).then(loadExtras), "Photo removed")}><Icon name="close" size={15} /></button></figure>)}
            {detailCapabilities.photos && <label className="photo-add-tile"><Icon name="camera" size={28} /><span>{photos.length ? "Add photo" : "Add a photo"}</span><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} /></label>}
          </div>
        </section>}
        {editing ? (
          <form className="form-card" onSubmit={save}>
            <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
            <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
            {(editCapabilities.identity || editCapabilities.specs) && <div className="form-row">{editCapabilities.identity && <label>Brand<input value={brand} onChange={(event) => setBrand(event.target.value)} /></label>}{editCapabilities.specs && <label>Model<input value={model} onChange={(event) => setModel(event.target.value)} /></label>}</div>}
            {editCapabilities.identity && <label>Serial number<input value={serial} onChange={(event) => setSerial(event.target.value)} /></label>}
            <div className="form-row">{editCapabilities.expiration && <label>Expiration<input type="date" value={expiration} onChange={(event) => setExpiration(event.target.value)} /></label>}<label>Low stock at<input inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label></div>
            <label>Unit<select value={unit} onChange={(event) => setUnit(event.target.value)}>{units.includes(unit) ? null : <option value={unit}>{unit}</option>}{units.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
            <div className="picker-field"><span>Category</span><button type="button" onClick={() => setPicker("editCategory")}><Icon name="tag" size={16} /><strong>{editingCategory ? categoryOptionLabel(editingCategory) : "No category"}</strong></button>{category && <button type="button" className="text-button" onClick={() => setCategory("")}>Clear category</button>}</div>
            <label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="electronics, project, spare" /></label>
            {editCapabilities.links && <label>Links<textarea rows={3} value={linksValue} onChange={(event) => setLinksValue(event.target.value)} placeholder="Manual | https://example.com/manual.pdf" /></label>}
            {editCapabilities.price && <div className="form-row"><label>Purchase price (€)<input inputMode="decimal" value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} /></label><label>Current estimate (€)<input inputMode="decimal" value={estimatedPrice} onChange={(event) => setEstimatedPrice(event.target.value)} /></label></div>}
            {editCapabilities.specs && <><label>Weight (g)<input inputMode="numeric" value={weight} onChange={(event) => setWeight(event.target.value)} /></label><div className="form-row dimensions"><label>Length mm<input inputMode="numeric" value={dimensions[0]} onChange={(event) => setDimensions([event.target.value, dimensions[1], dimensions[2]])} /></label><label>Width mm<input inputMode="numeric" value={dimensions[1]} onChange={(event) => setDimensions([dimensions[0], event.target.value, dimensions[2]])} /></label><label>Height mm<input inputMode="numeric" value={dimensions[2]} onChange={(event) => setDimensions([dimensions[0], dimensions[1], event.target.value])} /></label></div></>}
            <button className="primary wide" disabled={busy}>Save changes</button>
          </form>
        ) : (
          <>
            <nav className="detail-tabs" role="tablist" aria-label="Item sections">{(["overview", "details", "activity", "more"] as const).map((tab) => <button type="button" role="tab" aria-selected={detailTab === tab} className={detailTab === tab ? "active" : ""} key={tab} onClick={() => setDetailTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}{tab === "activity" && history.length > 0 ? <span>{history.length}</span> : null}</button>)}</nav>
            <div className="detail-tab-panel" hidden={detailTab !== "overview"}>
            {(item.expiration_date || item.barcode) && <div className="detail-facts compact-facts">{item.expiration_date && <div><span>Next expiry</span><strong>{item.expiration_date}</strong>{expirationState(item) && <small className="fact-warning">{expirationState(item) === "expired" ? "Expired" : "Use within 7 days"}</small>}</div>}{item.barcode && <div className="barcode-fact"><span>Barcode</span><BarcodeGraphic value={item.barcode} /></div>}</div>}
            {item.tags.length > 0 && <section className="detail-section tag-section"><div className="section-heading"><div><h2>Tags</h2></div></div><div className="tag-list">{item.tags.map((tag) => <button type="button" key={tag} onClick={() => onOpenTag(tag)}><Icon name="tag" size={13} /><span>{tag}</span></button>)}</div></section>}
            {(item.description || item.notes || item.model) && <div className="prose">{item.model && <p className="product-identity">{item.model}</p>}{item.description && <p>{item.description}</p>}{item.notes && <p><strong>Notes</strong><br />{item.notes}</p>}</div>}
            {(!photos.length || item.location_public_id === "unassigned" || item.low_stock_threshold === null) && <section className="detail-prompts"><strong>Complete this item</strong><div>{!photos.length && detailCapabilities.photos && <label><Icon name="camera" size={15} />Add photo<input type="file" accept="image/*" capture="environment" hidden onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} /></label>}{item.location_public_id === "unassigned" && <button onClick={() => setPicker("move")}><Icon name="pin" size={15} />Choose location</button>}{item.low_stock_threshold === null && <button onClick={() => { setThreshold("1"); setEditing(true); }}><Icon name="minus" size={15} />Set low stock</button>}</div></section>}
            </div>
            <div className="detail-tab-panel" hidden={detailTab !== "details"}>
            {showLinksData && <section className="detail-section"><div className="section-heading"><div><h2>Links</h2><span>{itemLinks.length ? `${itemLinks.length} saved` : "Manuals, datasheets, and references"}</span></div>{detailCapabilities.links && <button type="button" className="text-button" onClick={() => setEditing(true)}>{itemLinks.length ? "Edit" : "Add link"}</button>}</div>{itemLinks.length ? <div className="link-list">{itemLinks.map((link, index) => <a key={`${index}-${link.url}`} href={link.url} target="_blank" rel="noreferrer"><Icon name="spark" size={14} /><span>{link.label}</span></a>)}</div> : <div className="empty-inline"><span>No links yet</span></div>}</section>}
            <DocumentSection item={item} documents={documents} onReload={loadExtras} onItemChanged={onChanged} notify={(message) => { void run(async () => undefined, message, "none"); }} />
            {showReservationData && <section className="detail-section"><div className="section-heading"><div><h2>Reservations</h2><span>{reservations.length ? `${reservations.length} project hold${reservations.length === 1 ? "" : "s"}` : "No project holds yet"}</span></div></div><div className="reservation-list">{reservations.length === 0 && <div className="empty-inline"><span>Nothing reserved</span></div>}{reservations.map((reservation) => <div className="reservation" key={reservation.project_public_id}><span>{reservation.project_name}</span><small>{reservation.quantity} {reservation.unit} · {reservation.project_status}</small><button aria-label={`Remove ${reservation.project_name} reservation`} onClick={() => void removeReservation(reservation)}><Icon name="close" size={15} /></button></div>)}</div>{detailCapabilities.reservation && activeProjects.length > 0 && <form className="inline-lot-form" onSubmit={addReservation}><select value={reservationProject} onChange={(event) => setReservationProject(event.target.value)} aria-label="Project">{activeProjects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}</select><input inputMode="decimal" value={reservationQuantity} onChange={(event) => setReservationQuantity(event.target.value)} aria-label="Reservation quantity" /><button className="secondary" disabled={!reservationProject || !reservationQuantity.trim()}>Reserve</button></form>}{detailCapabilities.reservation && activeProjects.length === 0 && <div className="empty-inline"><span>Create an active project to reserve this item</span></div>}</section>}
            {showBatchData && <section className="detail-section"><div className="section-heading"><div><h2>Expiration batches</h2><span>{lots.length ? `${lots.length} batch${lots.length === 1 ? "" : "es"}` : "Track multiple dates for one item"}</span></div></div><div className="lot-list">{lots.length === 0 && <div className="empty-inline"><span>No batches recorded</span></div>}{lots.map((lot) => <div className="lot-row" key={lot.public_id}><div><strong>{lot.quantity} {item.unit}</strong><small>{lot.expiration_date ? `Expires ${lot.expiration_date}` : "No expiration date"}</small>{lot.note && <em>{lot.note}</em>}</div><button aria-label="Remove batch" onClick={() => run(async () => { await api.deleteLot(item, lot); const refreshed = await api.item(item.public_id); await onChanged(refreshed); await loadExtras(); }, "Batch removed")}><Icon name="close" size={14} /></button></div>)}</div>{detailCapabilities.batches && <form className="inline-lot-form" onSubmit={addLot}><input inputMode="decimal" value={lotQuantity} onChange={(event) => setLotQuantity(event.target.value)} aria-label="Batch quantity" /><input type="date" value={lotExpiration} onChange={(event) => setLotExpiration(event.target.value)} aria-label="Batch expiration date" /><input value={lotNote} onChange={(event) => setLotNote(event.target.value)} placeholder="batch note" aria-label="Batch note" /><button className="secondary" disabled={!lotQuantity}>Add batch</button></form>}</section>}
            {showMaintenanceData && <section className="detail-section"><div className="section-heading"><div><h2>Maintenance</h2><span>{maintenance.length ? `${maintenance.length} recurring task${maintenance.length === 1 ? "" : "s"}` : "Optional schedules for tools and equipment"}</span></div></div><div className="maintenance-list">{maintenance.length === 0 && <div className="empty-inline"><span>No maintenance tasks</span></div>}{maintenance.map((task) => <article className={`maintenance-row ${new Date(`${task.next_due_at}T23:59:59`).getTime() < Date.now() ? "overdue" : ""}`} key={task.public_id}><div><strong>{task.title}</strong><small>Every {task.interval_days} days · next {task.next_due_at}</small>{task.notes && <p>{task.notes}</p>}</div><button className="secondary" onClick={() => run(async () => { await api.completeMaintenance(item, task); await loadExtras(); }, "Maintenance completed")}>Done</button></article>)}</div>{detailCapabilities.maintenance && <form className="maintenance-form" onSubmit={addMaintenance}><input required value={maintenanceTitle} onChange={(event) => setMaintenanceTitle(event.target.value)} placeholder="Lube rails" aria-label="Maintenance title" /><input inputMode="numeric" value={maintenanceInterval} onChange={(event) => setMaintenanceInterval(event.target.value)} aria-label="Interval days" /><input value={maintenanceNotes} onChange={(event) => setMaintenanceNotes(event.target.value)} placeholder="notes" aria-label="Maintenance notes" /><button className="secondary" disabled={!maintenanceTitle.trim()}>Add task</button></form>}</section>}
            <details className="detail-section related-section"><summary><span><h2>Open related</h2><small>{related.length ? `${related.length} linked item${related.length === 1 ? "" : "s"}` : "Link tools, parts, accessories, and consumables"}</small></span><Icon name="chevron" size={16} /></summary><div className="related-controls"><div><button className={relatedGroupMode === "category" ? "active" : ""} onClick={() => setRelatedGroupMode("category")}>By category</button><button className={relatedGroupMode === "location" ? "active" : ""} onClick={() => setRelatedGroupMode("location")}>By location</button></div><input value={relatedQuery} onChange={(event) => setRelatedQuery(event.target.value)} placeholder="Find item to relate" aria-label="Find related item" /></div>{relatedQuery.trim() && <div className="related-candidates">{relatedCandidates.length === 0 && <div className="empty-inline"><span>No matching items</span></div>}{relatedCandidates.map((candidate) => <button key={candidate.public_id} onClick={() => void addRelatedItem(candidate)}><Icon name="plus" size={15} /><span><strong>{candidate.name}</strong><small>{categoryLabel(candidate) || "Uncategorised"} · {candidate.location_path}</small></span></button>)}</div>}{relatedGroups.length === 0 ? <div className="empty-inline"><span>No related items yet</span></div> : <div className="related-groups">{relatedGroups.map(([group, entries]) => <div className="related-group" key={group}><h3>{group}<span>{entries.length}</span></h3>{entries.map((entry) => <article className="related-item-row" key={entry.relationship_public_id}>{entry.primary_photo_url ? <img src={entry.primary_photo_url} alt="" /> : <span><Icon name="box" size={18} /></span>}<div><strong>{entry.name}</strong><small>{relatedGroupMode === "category" ? entry.location_path : categoryLabel(entry) || "Uncategorised"} · {entry.quantity} {entry.unit}</small></div><button aria-label={`Remove ${entry.name} relation`} onClick={() => void removeRelatedItem(entry)}><Icon name="close" size={14} /></button></article>)}</div>)}</div>}</details>
            </div>
            <div className="detail-tab-panel" hidden={detailTab !== "more"}>
            <section className="detail-section qr-section"><div><h2>QR label</h2><p>Print or scan to open this item.</p></div><a href={`/api/v1/labels/items/${item.public_id}`} target="_blank" rel="noreferrer"><img src={`/api/v1/qr/items/${item.public_id}.svg`} alt={`QR code for ${item.name}`} /></a></section>
            </div>
            <div className="detail-tab-panel" hidden={detailTab !== "details"}>
            {showEnrichmentData && <details className="detail-section enrichment-section">
              <summary>
                <span><h2>Open Food Facts</h2><small>{enrichment.product ? "Ingredients, nutrition, and source data" : "Optional external product lookup"}</small></span>
                <Icon name="chevron" size={16} />
              </summary>
              <div className="enrichment-content">
                {detailCapabilities.enrichment && <div className="enrichment-toolbar"><button className="text-button" onClick={() => run(async () => { await api.queueEnrichment(item); await api.runEnrichment(); await loadExtras(); }, "Product lookup completed")}>Look up data</button></div>}
                {enrichment.product && <div className="enrichment-product">
                  <strong>{enrichment.product.name || item.name}</strong>
                  <small>{[enrichment.product.brand, enrichment.product.package_quantity].filter(Boolean).join(" · ") || "Product details saved"}</small>
                  <div className="off-source-actions">
                    {enrichment.product.source_url && <a href={enrichment.product.source_url} target="_blank" rel="noreferrer">View source</a>}
                    <button type="button" className="off-data-button" onClick={() => void openAllProductData()}>{enrichment.full_product_available ? "Show all Open Food Facts data" : "Download all Open Food Facts data"}</button>
                  </div>
                  {[enrichment.product.nutriscore_grade && `Nutri-Score ${enrichment.product.nutriscore_grade.toUpperCase()}`, enrichment.product.nova_group && `NOVA ${enrichment.product.nova_group}`, enrichment.product.ecoscore_grade && `Eco ${enrichment.product.ecoscore_grade.toUpperCase()}`].filter(Boolean).length > 0 && <div className="nutrition-badges">{[enrichment.product.nutriscore_grade && `Nutri-Score ${enrichment.product.nutriscore_grade.toUpperCase()}`, enrichment.product.nova_group && `NOVA ${enrichment.product.nova_group}`, enrichment.product.ecoscore_grade && `Eco ${enrichment.product.ecoscore_grade.toUpperCase()}`].filter(Boolean).map((label) => <span key={String(label)}>{label}</span>)}</div>}
                  {enrichment.product.ingredients_text && <p className="ingredients-text"><strong>Ingredients</strong>{enrichment.product.ingredients_text}</p>}
                  {Object.keys(enrichment.product.nutrition || {}).length > 0 && <><p className="nutrition-heading">Nutrition per 100 g/ml</p><dl className="nutrition-grid">{Object.entries(enrichment.product.nutrition).map(([key, value]) => <div key={key}><dt>{nutritionLabel(key)}</dt><dd>{nutritionValueLabel(key, value)}</dd></div>)}</dl></>}
                </div>}
                {enrichment.candidates.filter((candidate) => candidate.status === "proposed" && Object.keys(candidate.proposed).length > 0).map((candidate) => <div className="candidate" key={candidate.public_id}><div><strong>{candidate.source_label}</strong><dl>{Object.entries(candidate.proposed).map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{String(value)}</dd></div>)}</dl>{candidate.source_url && <a href={candidate.source_url} target="_blank" rel="noreferrer">View source</a>}</div><button className="primary" onClick={() => run(() => api.applyEnrichment(candidate.public_id).then(onChanged).then(loadExtras), "Enrichment applied")}>Apply</button></div>)}
              </div>
            </details>}
            </div>
            <div className="detail-tab-panel" hidden={detailTab !== "activity"}>
            <details className="detail-section history-section"><summary><span><h2>History</h2><small>Permanent activity log</small></span><Icon name="chevron" size={16} /></summary><div className="event-list">{history.length ? history.map((event) => <div className="event" key={event.public_id}><span>{activityLabel(event.action)}</span><strong>{event.quantity_delta ? `${Number(event.quantity_delta) > 0 ? "+" : ""}${event.quantity_delta}` : event.to_location || "Changed"}</strong><time>{new Date(`${event.created_at}Z`).toLocaleString()}</time></div>) : <div className="empty-inline"><span>No changes recorded yet</span></div>}</div></details>
            </div>
            <div className="detail-tab-panel" hidden={detailTab !== "more"}>
            <div className={`lost-controls ${lost ? "active" : ""}`}><div><strong>{lost ? "Marked lost" : "Item actions"}</strong><small>{lost ? "Keep it here until it turns up, or let it go forever." : "Move, categorise, shop, and manage this item."}</small></div><div><button className="secondary" disabled={busy} onClick={() => setPicker("move")}><Icon name="pin" size={15} />Move</button><button className="secondary" disabled={busy} onClick={() => setPicker("category")}><Icon name="tag" size={15} />Category</button>{itemDefaultRule ? <button className="secondary" disabled={busy} onClick={() => void removeItemDefault(itemDefaultRule)}><Icon name="close" size={15} />Delete default ({itemDefaultRule.rule_type}: {itemDefaultRule.match_value})</button> : <button className="secondary" disabled={busy} onClick={() => void setItemDefault()}><Icon name="pin" size={15} />Set default</button>}{detailCapabilities.shopping_list && <button className="secondary" disabled={busy} onClick={() => void onAddShopping(item)}><Icon name="plus" size={15} />Add to shopping list</button>}{item.low_stock_threshold === null && <button className="secondary" disabled={busy} onClick={() => { setThreshold("1"); setEditing(true); }}><Icon name="minus" size={15} />Set low stock</button>}{lost ? <><button className="secondary" disabled={busy} onClick={() => void onMarkFound(item)}><Icon name="check" size={15} />Found</button><button disabled={busy} onClick={() => void onForeverLost(item)}><Icon name="close" size={15} />Forever lost</button></> : <button disabled={busy} onClick={() => void onMarkLost(item)}><Icon name="search" size={15} />Mark lost</button>}</div></div>
            <section className="danger-zone"><div><strong>Remove item</strong><small>Archive keeps history. Delete removes this item permanently.</small></div><div className="danger-actions"><button disabled={busy} onClick={() => { if (window.confirm(`Archive ${item.name}? It will disappear from regular search but remain in history and exports.`)) void run(() => api.archive(item).then(onClose), `${item.name} archived`); }}>Archive</button><button disabled={busy} onClick={() => void onDeleteItem(item)}>Delete</button></div></section>
            </div>
            <div className="detail-primary-actions" aria-label="Primary item actions"><button disabled={Number(item.quantity) <= 0} onClick={() => void onQuickAdjust(item, -1)} aria-label="Remove one"><Icon name="minus" size={17} /></button><strong>{item.quantity} {item.unit}</strong><button onClick={() => void onQuickAdjust(item, 1)} aria-label="Add one"><Icon name="plus" size={17} /></button><button onClick={() => setPicker("move")}><Icon name="pin" size={16} /><span>Move</span></button><button onClick={() => setEditing(true)}><Icon name="settings" size={16} /><span>Edit</span></button><button onClick={() => setDetailTab("more")}><Icon name="more" size={16} /><span>More</span></button></div>
          </>
        )}
        {picker === "move" && <HierarchyPicker title="Move item" nodes={locationNodes} selectedId={item.location_public_id} emptyLabel="No child locations here" chooseLabel="Move here" currentChooseLabel="Move here" onChoose={(id) => { void moveToLocation(id); }} onClose={() => setPicker(null)} />}
        {picker === "category" && <HierarchyPicker title="Change category" nodes={categoryNodes} selectedId={item.category_id ? String(item.category_id) : ""} emptyLabel="No child categories here" chooseLabel="Use category" currentChooseLabel="Use this category" onChoose={(id) => { void changeCategory(id); }} onClose={() => setPicker(null)} />}
        {picker === "editCategory" && <HierarchyPicker title="Choose category" nodes={categoryNodes} selectedId={category} emptyLabel="No child categories here" chooseLabel="Use category" currentChooseLabel="Use this category" onChoose={(id) => setCategory(id)} onClose={() => setPicker(null)} />}
      </article>
      {showAllProductData && fullProductData && <ProductDataExplorer payload={fullProductData} onClose={() => setShowAllProductData(false)} />}
    </div>
  );
}

function OffCategoryMappingsView({ categories, busy, onBack, onOpenItem, onNotice }: {
  categories: Category[];
  busy: boolean;
  onBack: () => void;
  onOpenItem: (item: Item) => void;
  onNotice: (message: string) => void;
}) {
  const [mappings, setMappings] = useState<OffCategoryMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "explicit" | "automatic" | "unmapped">("all");
  const [pickerTag, setPickerTag] = useState("");
  const [itemsTag, setItemsTag] = useState("");
  const [mappingItems, setMappingItems] = useState<Item[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [importPayload, setImportPayload] = useState<unknown>(null);
  const [importResult, setImportResult] = useState<OffCategoryMappingImportResult | null>(null);
  const categoryNodes = useMemo(() => categoryPickerNodes(categories), [categories]);
  const activeMapping = mappings.find((mapping) => mapping.off_tag === pickerTag) || null;
  const load = useCallback(async () => {
    try {
      const result = await api.offCategoryMappings();
      setMappings(result.mappings);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not load category mappings");
    } finally {
      setLoading(false);
    }
  }, [onNotice]);
  useEffect(() => { void load(); }, [load]);
  const visibleMappings = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return mappings.filter((mapping) => {
      if (scope !== "all" && mapping.mapping_source !== scope) return false;
      if (!term) return true;
      return [mapping.off_tag, mapping.label, mapping.effective_category?.path || ""]
        .join(" ").toLocaleLowerCase().includes(term);
    });
  }, [mappings, query, scope]);
  async function assign(offTag: string, categoryId: string) {
    try {
      await api.setOffCategoryMapping(offTag, Number(categoryId));
      setPickerTag("");
      await load();
      onNotice("Open Food Facts category assigned");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not save category mapping");
    }
  }
  async function clearAssignment(mapping: OffCategoryMapping) {
    try {
      await api.setOffCategoryMapping(mapping.off_tag, null);
      await load();
      onNotice("Explicit assignment removed; automatic mapping will be used");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not clear category mapping");
    }
  }
  async function showItems(mapping: OffCategoryMapping) {
    setItemsTag(mapping.off_tag);
    setItemsLoading(true);
    try {
      setMappingItems(await api.offCategoryMappingItems(mapping.off_tag));
    } catch (error) {
      setMappingItems([]);
      onNotice(error instanceof Error ? error.message : "Could not load matching items");
    } finally {
      setItemsLoading(false);
    }
  }
  async function downloadExport() {
    try {
      const payload = await api.exportOffCategoryMappings();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "findstuff-off-category-mappings.json";
      anchor.click();
      URL.revokeObjectURL(url);
      onNotice("Category mapping JSON exported");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not export mappings");
    }
  }
  async function readImport(file: File) {
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const result = await api.importOffCategoryMappings(payload);
      setImportPayload(payload);
      setImportResult(result);
    } catch (error) {
      setImportPayload(null);
      setImportResult(null);
      onNotice(error instanceof Error ? error.message : "Invalid category mapping JSON");
    }
  }
  async function applyImport() {
    if (!importPayload || !importResult || importResult.errors) return;
    try {
      const result = await api.importOffCategoryMappings(importPayload, true);
      setImportResult(result);
      setImportPayload(null);
      await load();
      onNotice(`${result.applied} category mappings imported`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not import mappings");
    }
  }
  return <section className="off-mapping-page">
    <div className="subpage-header"><button type="button" className="text-button" onClick={onBack}>Back to Settings</button><div><p className="eyebrow">OPEN FOOD FACTS</p><h1>Category mapping</h1><p>Every category observed during barcode scans appears here. Automatic matches can be overridden with your own category hierarchy.</p></div></div>
    <div className="mapping-actions"><button type="button" className="secondary button-with-icon" onClick={() => void downloadExport()}><Icon name="qr" size={16} />Export JSON</button><label className="upload-import compact-upload"><strong>Import mapping JSON</strong><input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void readImport(file); }} /></label></div>
    {importResult && <section className={`mapping-import-preview ${importResult.errors ? "has-errors" : ""}`}><div><strong>{importResult.errors ? "Import needs corrections" : "Import ready"}</strong><span>{importResult.ready} assignments · {importResult.errors} errors</span></div><div className="import-detail-list">{importResult.details.slice(0, 20).map((detail) => <article className={`import-detail ${detail.status}`} key={`${detail.index}-${detail.off_tag || "row"}`}><b>{detail.status}</b><div><strong>{detail.off_tag || `Row ${detail.index + 1}`}</strong><small>{detail.message}</small></div></article>)}</div><div className="button-row"><button type="button" onClick={() => { setImportPayload(null); setImportResult(null); }}>Cancel</button><button type="button" className="primary" disabled={Boolean(importResult.errors) || !importPayload} onClick={() => void applyImport()}>Apply import</button></div></section>}
    <div className="mapping-toolbar"><label className="search"><Icon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search OFF or Findstuff categories" /></label><div className="filter-row"><button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>All <span>{mappings.length}</span></button><button className={scope === "explicit" ? "active" : ""} onClick={() => setScope("explicit")}>Assigned <span>{mappings.filter((entry) => entry.mapping_source === "explicit").length}</span></button><button className={scope === "automatic" ? "active" : ""} onClick={() => setScope("automatic")}>Automatic <span>{mappings.filter((entry) => entry.mapping_source === "automatic").length}</span></button><button className={scope === "unmapped" ? "active" : ""} onClick={() => setScope("unmapped")}>Unmapped <span>{mappings.filter((entry) => entry.mapping_source === "unmapped").length}</span></button></div></div>
    <div className="mapping-list">
      {loading && <div className="empty-inline"><span>Loading observed categories…</span></div>}
      {!loading && visibleMappings.length === 0 && <EmptyState icon="tag" title={mappings.length ? "No mappings in this view" : "No Open Food Facts categories scanned yet"} text={mappings.length ? "Change the filter or search term." : "Scan a food barcode and its deepest category will appear here."} />}
      {visibleMappings.map((mapping) => <article className="mapping-card compact" key={mapping.off_tag}>
        <div className="mapping-source"><strong>{mapping.label}</strong><code>{mapping.off_tag}</code></div>
        <button type="button" className="mapping-target" disabled={busy} onClick={() => setPickerTag(mapping.off_tag)}><span>Our category</span><strong>{mapping.effective_category?.path || "Click to assign"}</strong></button>
        <span className={`status-badge ${mapping.mapping_source === "unmapped" ? "warning" : mapping.mapping_source === "explicit" ? "active" : "quiet"}`}>{mapping.mapping_source === "explicit" ? "manual" : mapping.mapping_source}</span>
        <button type="button" className="mapping-see-items" onClick={() => void showItems(mapping)}>See items</button>
        {mapping.explicit_category && <button type="button" className="mapping-auto-reset" disabled={busy} onClick={() => void clearAssignment(mapping)} title="Remove the manual override">Use automatic</button>}
      </article>)}
    </div>
    {activeMapping && <HierarchyPicker title={`Map ${activeMapping.label}`} nodes={categoryNodes} selectedId={String(activeMapping.effective_category?.id || "")} emptyLabel="No child categories here" chooseLabel="Assign" currentChooseLabel="Assign this category" onChoose={(id) => void assign(activeMapping.off_tag, id)} onClose={() => setPickerTag("")} />}
    {itemsTag && <div className="modal-backdrop picker-backdrop" role="dialog" aria-modal="true" aria-label="Items in Open Food Facts category" onMouseDown={(event) => { if (event.target === event.currentTarget) setItemsTag(""); }}><article className="picker-sheet mapping-items-sheet"><header><button className="icon-button" type="button" onClick={() => setItemsTag("")} aria-label="Close"><Icon name="close" /></button><div><h2>Items tagged {mappings.find((entry) => entry.off_tag === itemsTag)?.label || itemsTag}</h2><small>{mappingItems.length} matching item{mappingItems.length === 1 ? "" : "s"}</small></div></header><div className="picker-list">{itemsLoading && <div className="empty-inline"><span>Loading items…</span></div>}{!itemsLoading && mappingItems.length === 0 && <div className="empty-inline"><span>No saved items currently use this barcode category.</span></div>}{mappingItems.map((item) => <button type="button" className="mapping-item-row" key={item.public_id} onClick={() => { setItemsTag(""); onOpenItem(item); }}><span><strong>{item.name}</strong><small>{categoryLabel(item) || "Uncategorised"} · {item.location_path}</small></span><Icon name="chevron" size={16} /></button>)}</div></article></div>}
  </section>;
}

function AIScanProposalCard({ scan, categories, locations, units, busy, onSave, onApprove, onReject, onRetry }: {
  scan: AIScanProposal;
  categories: Category[];
  locations: LocationNode[];
  units: string[];
  busy: boolean;
  onSave: (changes: Record<string, unknown>) => Promise<void>;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onRetry: () => Promise<void>;
}) {
  const item = scan.proposal?.item;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item?.name || "");
  const [description, setDescription] = useState(item?.description || "");
  const [notes, setNotes] = useState(item?.notes || "");
  const [brand, setBrand] = useState(item?.brand || "");
  const [model, setModel] = useState(item?.model || "");
  const [barcode, setBarcode] = useState(item?.barcode || "");
  const [quantity, setQuantity] = useState(item?.quantity || "1");
  const [unit, setUnit] = useState(item?.unit || "pcs");
  const [categoryId, setCategoryId] = useState(item?.category_id ? String(item.category_id) : "");
  const [locationId, setLocationId] = useState(scan.location_public_id);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeSettling, setSwipeSettling] = useState(false);
  const swipeOffsetRef = useRef(0);
  const swipeFrame = useRef<number | null>(null);
  const swipeStart = useRef<{ x: number; y: number; pointerId: number; axis: "x" | "y" | null } | null>(null);
  const category = item?.category_id ? categories.find((entry) => entry.id === item.category_id) : null;

  useEffect(() => () => {
    if (swipeFrame.current !== null) window.cancelAnimationFrame(swipeFrame.current);
  }, []);

  useEffect(() => {
    if (editing || !item) return;
    setName(item.name);
    setDescription(item.description);
    setNotes(item.notes);
    setBrand(item.brand);
    setModel(item.model);
    setBarcode(item.barcode);
    setQuantity(item.quantity);
    setUnit(item.unit);
    setCategoryId(item.category_id ? String(item.category_id) : "");
    setLocationId(scan.location_public_id);
  }, [editing, item, scan.location_public_id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    await onSave({
      name,
      description,
      notes,
      brand,
      model,
      barcode,
      quantity,
      unit,
      category_id: categoryId ? Number(categoryId) : null,
      location_public_id: locationId,
    });
    setEditing(false);
  }

  function moveSwipe(offset: number) {
    swipeOffsetRef.current = offset;
    if (swipeFrame.current !== null) window.cancelAnimationFrame(swipeFrame.current);
    swipeFrame.current = window.requestAnimationFrame(() => {
      setSwipeOffset(offset);
      swipeFrame.current = null;
    });
  }

  function finishSwipe() {
    const offset = swipeOffsetRef.current;
    const threshold = Math.min(110, Math.max(76, window.innerWidth * 0.2));
    const action = offset > threshold ? onApprove : offset < -threshold ? onReject : null;
    const direction = offset > 0 ? 1 : -1;
    swipeStart.current = null;
    if (action && scan.status === "pending" && !busy && !editing) {
      setSwipeSettling(true);
      moveSwipe(direction * Math.max(window.innerWidth, 520));
      window.setTimeout(() => {
        void action().finally(() => {
          moveSwipe(0);
          setSwipeSettling(false);
        });
      }, 180);
      return;
    }
    setSwipeSettling(true);
    moveSwipe(0);
    window.setTimeout(() => setSwipeSettling(false), 180);
  }

  return <div
    className={`ai-swipe-shell ${swipeOffset > 0 ? "swiping-right" : swipeOffset < 0 ? "swiping-left" : ""}`}
    style={{ "--swipe-offset": `${swipeOffset}px`, "--swipe-opacity": Math.min(1, Math.abs(swipeOffset) / 70) } as CSSProperties}
  >
    <div className="ai-swipe-underlay approve" aria-hidden="true"><Icon name="check" size={24} /><strong>Approve</strong></div>
    <div className="ai-swipe-underlay reject" aria-hidden="true"><Icon name="close" size={24} /><strong>Reject</strong></div>
    <article
      className={`ai-proposal-card ${scan.status} ${swipeSettling ? "swipe-settling" : ""}`}
      onPointerDown={(event) => {
        if (editing || scan.status !== "pending" || busy || swipeSettling || !event.isPrimary) return;
        if (event.target instanceof Element && event.target.closest("button, input, select, textarea, label, a")) return;
        swipeStart.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, axis: null };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = swipeStart.current;
        if (!start || start.pointerId !== event.pointerId || editing || scan.status !== "pending") return;
        const x = event.clientX - start.x;
        const y = event.clientY - start.y;
        if (!start.axis && Math.max(Math.abs(x), Math.abs(y)) > 8) start.axis = Math.abs(x) > Math.abs(y) + 4 ? "x" : "y";
        if (start.axis === "x") {
          event.preventDefault();
          const resistance = 1 - Math.min(0.28, Math.abs(x) / Math.max(window.innerWidth, 1) * 0.28);
          moveSwipe(Math.max(-180, Math.min(180, x * resistance)));
        }
      }}
      onPointerUp={(event) => {
        if (swipeStart.current?.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        finishSwipe();
      }}
      onPointerCancel={() => { moveSwipe(0); swipeStart.current = null; }}
    >
      <div className="ai-proposal-photo">
        <img src={scan.photo_url} alt={item?.name || "Scanned Item"} />
        <span>{scan.status === "processing" ? "AI processing" : scan.status === "failed" ? "Needs attention" : `${Math.round((scan.proposal?.confidence || 0) * 100)}% confidence`}</span>
      </div>
      <div className="ai-proposal-main">
        {scan.status === "processing" && <>
          <div className="ai-proposal-context single"><span><Icon name="pin" size={17} /><small>Place</small><strong>{scan.location_path}</strong></span></div>
          <div className="ai-proposal-wait"><strong>Analyzing photo…</strong><small>You can leave this page while AI works.</small></div>
        </>}
        {scan.status === "failed" && <>
          <div className="ai-proposal-context single"><span><Icon name="pin" size={17} /><small>Place</small><strong>{scan.location_path}</strong></span></div>
          <div className="ai-proposal-wait error"><strong>Scan could not be analyzed</strong><small>{scan.error || "The AI provider did not return a result."}</small><div><button className="primary" disabled={busy} onClick={() => void onRetry()}>Retry</button><button disabled={busy} onClick={() => void onReject()}>Reject</button></div></div>
        </>}
        {scan.status === "pending" && item && <>
          {!editing ? <>
            <div className="ai-item-identity"><small>Suggested Item</small><h2>{item.name}</h2></div>
            <div className="ai-proposal-context">
              <span><Icon name="pin" size={17} /><small>Place</small><strong>{scan.location_path}</strong></span>
              <span><Icon name="tag" size={17} /><small>Category</small><strong>{category?.path || "Uncategorized"}</strong></span>
            </div>
            <div className="ai-item-details">
              <small className="ai-section-label">Item details</small>
              <div className="ai-proposal-facts">
                <span><small>Quantity</small><strong>{item.quantity} {item.unit}</strong></span>
                {item.brand && <span><small>Brand</small><strong>{item.brand}</strong></span>}
                {item.model && <span><small>Model</small><strong>{item.model}</strong></span>}
                {item.barcode && <span><small>Barcode</small><strong>{item.barcode}</strong></span>}
              </div>
              {item.description && <p>{item.description}</p>}
              {item.notes && <div className="ai-item-specifications"><small>Specifications</small>{item.notes.split("\n").filter(Boolean).map((line) => <span key={line}>{line}</span>)}</div>}
              {scan.proposal?.research?.url && <a href={scan.proposal.research.url} target="_blank" rel="noreferrer">{scan.proposal.research.label}</a>}
              {scan.proposal?.warnings.map((warning) => <em key={warning}>{warning}</em>)}
            </div>
          </> : <form className="ai-proposal-form" onSubmit={save}>
            <div className="ai-edit-heading"><strong>Edit suggestion</strong><small>Nothing is saved as an Item until you approve it.</small></div>
            <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
            <div className="form-row"><label>Brand<input value={brand} onChange={(event) => setBrand(event.target.value)} /></label><label>Model<input value={model} onChange={(event) => setModel(event.target.value)} /></label></div>
            <div className="form-row"><label>Quantity<input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label>Unit<select value={unit} onChange={(event) => setUnit(event.target.value)}>{Array.from(new Set([unit, ...units, "pcs"])).map((entry) => <option value={entry} key={entry}>{entry}</option>)}</select></label></div>
            <label>Category<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Uncategorized</option>{categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.path}</option>)}</select></label>
            <label>Place<select value={locationId} onChange={(event) => setLocationId(event.target.value)}>{locations.map((entry) => <option key={entry.public_id} value={entry.public_id}>{entry.path}</option>)}</select></label>
            <label>Barcode<input inputMode="numeric" value={barcode} onChange={(event) => setBarcode(event.target.value)} /></label>
            <label>Description<textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <label>Specifications<textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Material: Steel&#10;Size: 10 mm" /></label>
            <div className="button-row"><button type="button" onClick={() => setEditing(false)}>Cancel</button><button className="secondary" disabled={busy || !name.trim()}>Save changes</button></div>
          </form>}
          {!editing && <>
            <small className="ai-swipe-help">Swipe left to reject · right to approve</small>
            <div className="ai-proposal-actions">
              <button disabled={busy} onClick={() => void onReject()}><Icon name="close" size={16} />Reject</button>
              <button className="secondary" disabled={busy} onClick={() => setEditing(true)}><Icon name="settings" size={16} />Edit</button>
              <button className="primary" disabled={busy} onClick={() => void onApprove()}><Icon name="check" size={16} />Approve</button>
            </div>
          </>}
        </>}
      </div>
    </article>
  </div>;
}

function AIScanInboxView({ categories, locations, units, busy, onBack, onInventoryChanged, notify }: {
  categories: Category[];
  locations: LocationNode[];
  units: string[];
  busy: boolean;
  onBack: () => void;
  onInventoryChanged: () => Promise<void>;
  notify: (message: string, action?: Omit<RetryNotice, "message">) => void;
}) {
  const [scans, setScans] = useState<AIScanProposal[]>([]);
  const [reviewBusy, setReviewBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const load = useCallback(async () => {
    try {
      setScans(await api.aiScans());
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load the AI Inbox");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);
  const processing = scans.some((scan) => scan.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [load, processing]);

  async function performScan(
    action: () => Promise<unknown>,
    success: string,
    inventoryChanged = false,
  ) {
    setReviewBusy("Updating Inbox…");
    try {
      await action();
      notify(success);
      await load();
      if (inventoryChanged) await onInventoryChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The AI scan action could not be completed");
    } finally {
      setReviewBusy("");
    }
  }

  async function approveScan(scan: AIScanProposal) {
    if (scan.status !== "pending" || reviewBusy) return;
    setReviewBusy("Approving Item…");
    try {
      const created = await api.approveAiScan(scan.public_id);
      await load();
      await onInventoryChanged();
      notify(`${created.name} approved`, {
        label: "Undo",
        action: async () => {
          const current = await api.item(created.public_id);
          await api.archive(current);
          await load();
          await onInventoryChanged();
          notify(`${created.name} approval undone`);
        },
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Item could not be approved");
      await load();
      await onInventoryChanged();
    } finally {
      setReviewBusy("");
    }
  }

  const orderedScans = useMemo(() => [...scans].sort((left, right) => {
    const priority = { pending: 0, failed: 1, processing: 2 } as Record<string, number>;
    return (priority[left.status] ?? 3) - (priority[right.status] ?? 3);
  }), [scans]);
  const currentScan = orderedScans[0] || null;
  return <section className="ai-inbox-page">
    <div className="ai-inbox-nav">
      <button type="button" className="ai-inbox-back" onClick={onBack}><Icon name="chevron" size={17} />Back</button>
      {orderedScans.length > 1 && <span>{orderedScans.length} remaining</span>}
    </div>
    {loading && <div className="inline-activity" role="status"><span className="activity-spinner" />Loading Inbox…</div>}
    {!loading && scans.length === 0 && <EmptyState icon="spark" title="Your Inbox is clear" text="New AI Scan results will appear here automatically." />}
    {currentScan && <div className="ai-card-stage">
      {reviewBusy && <div className="ai-review-progress" role="status"><span className="activity-spinner" />{reviewBusy}</div>}
      <AIScanProposalCard
        key={currentScan.public_id}
        scan={currentScan}
        categories={categories}
        locations={flatLocations}
        units={units}
        busy={busy || Boolean(reviewBusy)}
        onSave={(changes) => performScan(() => api.updateAiScan(currentScan.public_id, changes), "AI scan proposal updated")}
        onApprove={() => approveScan(currentScan)}
        onReject={() => performScan(() => api.rejectAiScan(currentScan.public_id), "AI scan proposal rejected")}
        onRetry={() => performScan(() => api.retryAiScan(currentScan.public_id), "AI scan queued again")}
      />
    </div>}
  </section>;
}

type LocationRuleDraft = {
  rule_type: "name" | "barcode" | "category";
  match_value: string;
  location_public_id: string;
  priority: string;
  enabled: boolean;
};

function DefaultRulesView({ locations, categories, busy, onBack, onChanged, notify }: {
  locations: LocationNode[];
  categories: Category[];
  busy: boolean;
  onBack: () => void;
  onChanged: () => Promise<void>;
  notify: (message: string, action?: Omit<RetryNotice, "message">) => void;
}) {
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const [rules, setRules] = useState<LocationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | LocationRule["rule_type"]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorPicker, setEditorPicker] = useState<"category" | "location" | null>(null);
  const [draft, setDraft] = useState<LocationRuleDraft>({
    rule_type: "name",
    match_value: "",
    location_public_id: flatLocations[0]?.public_id || "unassigned",
    priority: "100",
    enabled: true,
  });

  const loadRules = useCallback(async () => {
    try {
      setError("");
      setRules(await api.locationRules());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load default rules");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void loadRules(); }, [loadRules]);

  const selectedRule = rules.find((rule) => rule.public_id === selectedId) || null;
  const filteredRules = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return rules.filter((rule) => {
      if (typeFilter !== "all" && rule.rule_type !== typeFilter) return false;
      if (statusFilter === "enabled" && !rule.enabled) return false;
      if (statusFilter === "disabled" && rule.enabled) return false;
      if (locationFilter !== "all" && rule.location_public_id !== locationFilter) return false;
      if (!search) return true;
      const location = flatLocations.find((entry) => entry.public_id === rule.location_public_id);
      return [rule.match_value, rule.rule_type, rule.location_name, location?.path || "", String(rule.priority)]
        .some((value) => value.toLocaleLowerCase().includes(search));
    });
  }, [flatLocations, locationFilter, query, rules, statusFilter, typeFilter]);
  const hasFilters = Boolean(query.trim() || typeFilter !== "all" || statusFilter !== "all" || locationFilter !== "all");

  function startCreate() {
    setSelectedId("");
    setDraft({
      rule_type: "name",
      match_value: "",
      location_public_id: flatLocations[0]?.public_id || "unassigned",
      priority: "100",
      enabled: true,
    });
    setEditorMode("create");
  }

  function startEdit(rule: LocationRule) {
    setDraft({
      rule_type: rule.rule_type,
      match_value: rule.match_value,
      location_public_id: rule.location_public_id,
      priority: String(rule.priority),
      enabled: rule.enabled,
    });
    setEditorMode("edit");
  }

  async function saveRule(event: FormEvent) {
    event.preventDefault();
    const matchValue = draft.match_value.trim();
    const priority = Number(draft.priority);
    if (!matchValue || !draft.location_public_id || !Number.isInteger(priority) || priority < 0 || priority > 10000) return;
    setSaving(true);
    try {
      const body = {
        rule_type: draft.rule_type,
        match_value: matchValue,
        location_public_id: draft.location_public_id,
        priority,
        enabled: draft.enabled,
      };
      const saved = editorMode === "edit" && selectedRule
        ? await api.updateLocationRule(selectedRule.public_id, body)
        : await api.createLocationRule(body);
      await loadRules();
      await onChanged();
      setSelectedId(saved.public_id);
      setEditorMode(null);
      notify(editorMode === "edit" ? "Default rule updated" : "Default rule created");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Could not save default rule");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule(rule: LocationRule) {
    if (!window.confirm(`Delete this default rule?\n\n${rule.match_value} → ${rule.location_name}`)) return;
    setSaving(true);
    try {
      await api.deleteLocationRule(rule.public_id);
      setSelectedId("");
      await loadRules();
      await onChanged();
      notify("Default rule deleted");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Could not delete default rule");
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule: LocationRule) {
    setSaving(true);
    try {
      const updated = await api.updateLocationRule(rule.public_id, { enabled: !rule.enabled });
      setRules((current) => current.map((entry) => entry.public_id === updated.public_id ? updated : entry));
      await onChanged();
      notify(updated.enabled ? "Default rule enabled" : "Default rule disabled");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Could not update default rule");
    } finally {
      setSaving(false);
    }
  }

  function ruleDescription(rule: LocationRule): string {
    if (rule.rule_type === "barcode") return `An Item with barcode ${rule.match_value} goes to this Place. Barcode matches are exact.`;
    if (rule.rule_type === "category") return `Items in ${rule.match_value}, including its child Categories, go to this Place.`;
    return `An Item whose name contains “${rule.match_value}” goes to this Place. Matching ignores letter case.`;
  }

  const selectedLocation = selectedRule
    ? flatLocations.find((entry) => entry.public_id === selectedRule.location_public_id) || null
    : null;

  return <section className="default-rules-page">
    <header className="default-rules-header">
      <button type="button" className="text-button" onClick={onBack}><Icon name="chevron" size={16} />Back to More</button>
      <div><p className="eyebrow">DEFAULT LOCATIONS</p><h1>Default rules</h1><span>Choose where matching Items should go automatically.</span></div>
      <button type="button" className="primary button-with-icon" onClick={startCreate}><Icon name="plus" size={16} />New rule</button>
    </header>

    <div className="default-rules-toolbar">
      <label className="default-rules-search"><Icon name="search" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search rules or Places" aria-label="Search default rules" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear rule search"><Icon name="close" size={14} /></button>}</label>
      <label><span>Type</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}><option value="all">All types</option><option value="name">Item name</option><option value="barcode">Barcode</option><option value="category">Category</option></select></label>
      <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">Any status</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></label>
      <label><span>Place</span><select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="all">Every Place</option>{flatLocations.map((location) => <option value={location.public_id} key={location.public_id}>{location.path}</option>)}</select></label>
      {hasFilters && <button type="button" className="outline-button" onClick={() => { setQuery(""); setTypeFilter("all"); setStatusFilter("all"); setLocationFilter("all"); }}>Clear filters</button>}
    </div>

    <div className={`default-rules-layout ${selectedRule ? "has-detail" : ""}`}>
      <div className="default-rule-list-pane">
        <div className="default-rule-list-summary"><strong>{filteredRules.length} rule{filteredRules.length === 1 ? "" : "s"}</strong><small>{rules.length} total</small></div>
        {loading && <div className="inline-activity"><span className="activity-spinner" />Loading rules…</div>}
        {error && <div className="inline-alert">{error}<button type="button" onClick={() => void loadRules()}>Try again</button></div>}
        {!loading && !error && filteredRules.length === 0 && <EmptyState icon="filter" title={rules.length ? "No matching rules" : "No default rules yet"} text={rules.length ? "Try clearing one of the filters." : "Create a rule to automatically suggest a Place."} />}
        <div className="default-rule-list">
          {filteredRules.map((rule) => {
            const location = flatLocations.find((entry) => entry.public_id === rule.location_public_id);
            return <button type="button" className={`${selectedId === rule.public_id ? "selected" : ""} ${rule.enabled ? "" : "disabled"}`} key={rule.public_id} onClick={() => setSelectedId(rule.public_id)}>
              <span className="default-rule-type"><Icon name={rule.rule_type === "category" ? "tag" : rule.rule_type === "barcode" ? "qr" : "search"} size={17} /></span>
              <span className="default-rule-copy"><small>{rule.rule_type === "name" ? "ITEM NAME" : rule.rule_type.toUpperCase()}</small><strong>{rule.match_value}</strong><em><Icon name="pin" size={12} />{location?.path || rule.location_name}</em></span>
              <span className={`rule-state ${rule.enabled ? "ready" : ""}`}>{rule.enabled ? "On" : "Off"}</span>
              <Icon name="chevron" size={15} />
            </button>;
          })}
        </div>
      </div>

      {selectedRule ? <aside className="default-rule-detail">
        <button type="button" className="default-rule-mobile-back" onClick={() => setSelectedId("")}><Icon name="chevron" size={15} />All rules</button>
        <div className="default-rule-detail-heading"><span><Icon name={selectedRule.rule_type === "category" ? "tag" : selectedRule.rule_type === "barcode" ? "qr" : "search"} size={20} /></span><div><small>{selectedRule.rule_type === "name" ? "ITEM NAME RULE" : `${selectedRule.rule_type.toUpperCase()} RULE`}</small><h2>{selectedRule.match_value}</h2></div><b className={`integration-status ${selectedRule.enabled ? "ready" : ""}`}>{selectedRule.enabled ? "Enabled" : "Disabled"}</b></div>
        <p>{ruleDescription(selectedRule)}</p>
        <div className="default-rule-route"><div><span>When this matches</span><strong>{selectedRule.match_value}</strong></div><Icon name="chevron" /><div><span>Send to</span><strong>{selectedLocation?.path || selectedRule.location_name}</strong></div></div>
        <dl className="default-rule-facts"><div><dt>Match type</dt><dd>{selectedRule.rule_type}</dd></div><div><dt>Priority</dt><dd>{selectedRule.priority} · tie-breaker</dd></div><div><dt>Place</dt><dd>{selectedLocation?.path || selectedRule.location_name}</dd></div><div><dt>Status</dt><dd>{selectedRule.enabled ? "Enabled" : "Disabled"}</dd></div></dl>
        <small className="default-rule-priority-note">You normally do not need to change priority. It only decides between equally specific matching rules; the higher number wins.</small>
        <details className="nested-form default-rule-technical"><summary>Technical details</summary><div><span>Rule ID</span><code>{selectedRule.public_id}</code><small>Internal identifier used by the app and API. You do not need to manage it.</small></div></details>
        <div className="default-rule-detail-actions"><button type="button" className="primary" disabled={busy || saving} onClick={() => startEdit(selectedRule)}><Icon name="settings" size={15} />Edit rule</button><button type="button" className="secondary" disabled={busy || saving} onClick={() => void toggleRule(selectedRule)}>{selectedRule.enabled ? "Disable" : "Enable"}</button><button type="button" className="danger-button" disabled={busy || saving} onClick={() => void deleteRule(selectedRule)}><Icon name="close" size={14} />Delete</button></div>
      </aside> : <aside className="default-rule-detail-empty"><span><Icon name="settings" size={25} /></span><h2>Select a rule</h2><p>Its match behavior, destination, priority, and controls will appear here.</p></aside>}
    </div>

    {editorMode && <div className="rule-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditorMode(null); }}><form className="rule-editor-sheet" onSubmit={saveRule}>
      <header><div><p className="eyebrow">{editorMode === "edit" ? "EDIT DEFAULT" : "NEW DEFAULT"}</p><h2>{editorMode === "edit" ? "Modify rule" : "Create a rule"}</h2></div><button type="button" className="icon-button" onClick={() => setEditorMode(null)} aria-label="Close rule editor"><Icon name="close" /></button></header>
      <label>Match type<select value={draft.rule_type} onChange={(event) => { const ruleType = event.target.value as LocationRuleDraft["rule_type"]; setDraft((current) => ({ ...current, rule_type: ruleType, match_value: "", priority: editorMode === "create" ? ruleType === "barcode" ? "500" : "100" : current.priority })); if (ruleType === "category") setEditorPicker("category"); }}><option value="name">Item name contains</option><option value="barcode">Exact barcode</option><option value="category">Category or child Category</option></select></label>
      {draft.rule_type === "category" ? <div className="picker-field rule-editor-picker-field"><span>Category or child Category</span><button type="button" onClick={() => setEditorPicker("category")}><Icon name="tag" size={16} /><strong>{draft.match_value || "Choose a Category"}</strong><Icon name="chevron" size={15} /></button><small>Matches the selected Category and all Categories below it.</small></div> : <label>Match value<input required autoFocus inputMode={draft.rule_type === "barcode" ? "numeric" : "text"} value={draft.match_value} onChange={(event) => setDraft((current) => ({ ...current, match_value: event.target.value }))} placeholder={draft.rule_type === "barcode" ? "807680…" : "pasta, cable, ESP32…"} /><small>{draft.rule_type === "barcode" ? "Must match the barcode exactly." : "Matches anywhere in the Item name, ignoring case."}</small></label>}
      <div className="picker-field rule-editor-picker-field"><span>Destination Place</span><button type="button" onClick={() => setEditorPicker("location")}><Icon name="pin" size={16} /><strong>{flatLocations.find((location) => location.public_id === draft.location_public_id)?.path || "Choose a Place"}</strong><Icon name="chevron" size={15} /></button></div>
      <label className="toggle rule-enabled-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} /><span><strong>Enabled</strong><small>Use this rule for suggestions</small></span></label>
      <details className="nested-form rule-editor-advanced"><summary>Advanced</summary><div><label>Priority<input required type="number" min="0" max="10000" value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))} /><small>Only a tie-breaker between equally specific matches. Higher wins; most users can leave this unchanged.</small></label></div></details>
      <div className="button-row"><button type="button" onClick={() => setEditorMode(null)}>Cancel</button><button className="primary" disabled={busy || saving || !draft.match_value.trim() || !draft.location_public_id}>{saving ? "Saving…" : editorMode === "edit" ? "Save changes" : "Create rule"}</button></div>
    </form></div>}
    {editorPicker === "category" && <SearchableFilterPicker title="Choose a Category" icon="tag" selectedId={String(categories.find((category) => categoryOptionLabel(category) === draft.match_value)?.id || "")} emptyLabel="No Category selected" emptyDetail="Return without choosing" contextLabel="DEFAULT RULE" topLayer options={categories.map((category) => ({ id: String(category.id), label: category.name, detail: category.path }))} onChoose={(id) => { const category = categories.find((entry) => String(entry.id) === id); if (category) setDraft((current) => ({ ...current, match_value: categoryOptionLabel(category) })); }} onClose={() => setEditorPicker(null)} />}
    {editorPicker === "location" && <SearchableFilterPicker title="Choose destination Place" icon="pin" selectedId={draft.location_public_id} emptyLabel="No Place selected" emptyDetail="Return without choosing" contextLabel="DEFAULT RULE" topLayer options={flatLocations.map((location) => ({ id: location.public_id, label: location.name, detail: location.path }))} onChoose={(id) => { if (id) setDraft((current) => ({ ...current, location_public_id: id })); }} onClose={() => setEditorPicker(null)} />}
  </section>;
}

function ManageView({ items, dashboard, locations, categories, locationTypes, units, busy, theme, setNotice, notify, onThemeChange, onInventoryChanged, onLocations, onCategories, onDefaultRules, onOffCategoryMappings, onInbox, onOpenItem, onMarkFound, onForeverLost, onUnitsChanged }: {
  items: Item[];
  dashboard: Dashboard | null;
  locations: LocationNode[];
  categories: Category[];
  locationTypes: LocationType[];
  units: string[];
  busy: boolean;
  theme: ThemePreference;
  setNotice: (message: string) => void;
  notify: (message: string, action?: Omit<RetryNotice, "message">) => void;
  onThemeChange: (theme: ThemePreference) => void;
  onInventoryChanged: () => Promise<void>;
  onLocations: () => void;
  onCategories: () => void;
  onDefaultRules: () => void;
  onOffCategoryMappings: () => void;
  onInbox: () => void;
  onOpenItem: (item: Item) => void;
  onMarkFound: (item: Item) => Promise<void>;
  onForeverLost: (item: Item) => Promise<void>;
  onUnitsChanged: (units: string[]) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [settings, setSettings] = useState<ApplicationSettings | null>(null);
  const [rules, setRules] = useState<LocationRule[]>([]);
  const [suggestions, setSuggestions] = useState<EnrichmentSuggestion[]>([]);
  const [archivedItems, setArchivedItems] = useState<Item[]>([]);
  const [missingEnrichmentCount, setMissingEnrichmentCount] = useState<number | null>(null);
  const [softwareUpdate, setSoftwareUpdate] = useState<SoftwareUpdateStatus | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [reserveProject, setReserveProject] = useState("");
  const [reserveItem, setReserveItem] = useState("");
  const [reserveQuantity, setReserveQuantity] = useState("1");
  const [loanItem, setLoanItem] = useState("");
  const [loanPerson, setLoanPerson] = useState("");
  const [loanDirection, setLoanDirection] = useState<"lent" | "borrowed">("lent");
  const [loanDue, setLoanDue] = useState("");
  const [notificationUrl, setNotificationUrl] = useState("");
  const [notificationToken, setNotificationToken] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [expirationDays, setExpirationDays] = useState("7");
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiEndpoint, setAiEndpoint] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiDiagnostic, setAiDiagnostic] = useState<AIConnectionDiagnostic | null>(null);
  const [mqttEnabled, setMqttEnabled] = useState(false);
  const [mqttHost, setMqttHost] = useState("");
  const [mqttPort, setMqttPort] = useState("1883");
  const [mqttUsername, setMqttUsername] = useState("");
  const [mqttPassword, setMqttPassword] = useState("");
  const [mqttBaseTopic, setMqttBaseTopic] = useState("findstuff");
  const [mqttDiscoveryPrefix, setMqttDiscoveryPrefix] = useState("homeassistant");
  const [mqttClientId, setMqttClientId] = useState("findstuff");
  const [mqttPublishInterval, setMqttPublishInterval] = useState("60");
  const [currentAdminPassword, setCurrentAdminPassword] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [confirmAdminPassword, setConfirmAdminPassword] = useState("");
  const [importPayload, setImportPayload] = useState<unknown>(null);
  const [importSummary, setImportSummary] = useState<Record<string, number> | null>(null);
  const [importDetails, setImportDetails] = useState<ImportPreviewDetail[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([]);
  const [dataActivity, setDataActivity] = useState("");
  const [manageActivity, setManageActivity] = useState("");
  const [enrichmentFile, setEnrichmentFile] = useState<unknown>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [customPlaceType, setCustomPlaceType] = useState("");
  const [customUnit, setCustomUnit] = useState("");
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const reservableItems = useMemo(
    () => items.filter((item) => capabilitiesForCategory(categories, item.category_id).reservation),
    [categories, items],
  );
  const lostItems = useMemo(() => items.filter(hasLostTag), [items]);

  const load = useCallback(async () => {
    try {
      const [nextProjects, nextLoans, nextSettings, nextRules, nextSuggestions, nextArchivedItems, nextEnrichmentStatus, nextUpdate, nextImports] = await Promise.all([
        api.projects(),
        api.loans(),
        api.settings(),
        api.locationRules(),
        api.enrichmentSuggestions("pending"),
        api.archivedItems(),
        api.enrichmentStatus(),
        api.softwareUpdateStatus(),
        api.importBatches(),
      ]);
      setProjects(nextProjects);
      setLoans(nextLoans);
      setSettings(nextSettings);
      setSoftwareUpdate(nextUpdate);
      onUnitsChanged(nextSettings.units);
      setRules(nextRules);
      setSuggestions(nextSuggestions);
      setArchivedItems(nextArchivedItems);
      setMissingEnrichmentCount(nextEnrichmentStatus.missing);
      setImportBatches(nextImports);
      setNotificationsEnabled(nextSettings.notifications.enabled);
      setNotificationUrl(nextSettings.notifications.ntfy_url);
      setExpirationDays(String(nextSettings.notifications.expiration_days));
      setAiEnabled(nextSettings.integrations.ai.enabled);
      setAiEndpoint(nextSettings.integrations.ai.endpoint);
      setAiModel(nextSettings.integrations.ai.model);
      setMqttEnabled(nextSettings.integrations.mqtt.enabled);
      setMqttHost(nextSettings.integrations.mqtt.host);
      setMqttPort(String(nextSettings.integrations.mqtt.port));
      setMqttUsername(nextSettings.integrations.mqtt.username);
      setMqttBaseTopic(nextSettings.integrations.mqtt.base_topic);
      setMqttDiscoveryPrefix(nextSettings.integrations.mqtt.discovery_prefix);
      setMqttClientId(nextSettings.integrations.mqtt.client_id);
      setMqttPublishInterval(String(nextSettings.integrations.mqtt.publish_interval_seconds));
      if (!reserveProject && nextProjects[0]) setReserveProject(nextProjects[0].public_id);
      if (!reserveItem && reservableItems[0]) setReserveItem(reservableItems[0].public_id);
      if (!loanItem && items[0]) setLoanItem(items[0].public_id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load management data");
    }
  }, [items, loanItem, reservableItems, reserveItem, reserveProject, setNotice]);
  useEffect(() => { void load(); }, []);

  async function perform(action: () => Promise<unknown>, success: string) {
    setManageActivity("Saving changes…");
    try {
      await action();
      setNotice(success);
      void load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The action could not be completed");
    } finally {
      setManageActivity("");
    }
  }

  async function restoreArchivedItem(item: Item) {
    await perform(async () => {
      await api.restoreItem(item.public_id);
      await onInventoryChanged();
    }, `${item.name} restored to Inventory`);
  }

  async function permanentlyDeleteArchivedItem(item: Item) {
    if (!window.confirm(
      `Delete ${item.name} forever?\n\nThis permanently removes the Item, its photos, and its history. This cannot be undone.`,
    )) return;
    await perform(async () => {
      await api.hardDeleteItem(item);
      await onInventoryChanged();
    }, `${item.name} permanently deleted`);
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    await perform(() => api.createProject(projectName, projectDescription), "Project created");
    setProjectName(""); setProjectDescription("");
  }

  async function requestUpdate() {
    if (!window.confirm("Install the latest FindStuffer release? The app will restart when the update finishes.")) return;
    await perform(async () => {
      const status = await api.requestSoftwareUpdate();
      setSoftwareUpdate(status);
    }, "Software update queued");
  }

  async function restoreFullBackup(file: File) {
    if (!window.confirm(
      "Restore this full backup? Every current item, location, category, history record, setting, and saved photo will be replaced. Findstuff will create a safety backup first and then restart.",
    )) return;
    setDataActivity(`Uploading ${file.name}…`);
    try {
      const result = await api.restoreBackup(file);
      const summary = result.counts
        ? `${result.counts.items} items, ${result.counts.locations} locations, ${result.counts.photos} photos`
        : "backup contents";
      setNotice(`Backup validated (${summary}). Findstuff is restarting…`);
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        try {
          const status = await api.restoreStatus();
          if (status.status === "complete") {
            window.location.reload();
            return;
          }
          if (status.status === "failed") {
            setNotice(`Restore failed safely: ${status.message}`);
            return;
          }
        } catch {
          // The temporary connection failure is expected while Docker restarts.
        }
      }
      setNotice("Restore was queued. Reload Findstuff after its container finishes restarting.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not restore this backup");
    } finally {
      setDataActivity("");
    }
  }

  async function downloadData(path: string, filename: string, kind: "Backup" | "Export") {
    setDataActivity(kind === "Backup" ? "Preparing your Backup…" : "Preparing your export…");
    try {
      const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(payload?.detail || `${kind} could not be prepared`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice(kind === "Backup" ? "Backup completed" : "Export downloaded");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${kind} failed`);
    } finally {
      setDataActivity("");
    }
  }

  async function removeProject(project: Project) {
    if (!window.confirm(`Permanently delete ${project.name}? Reservations for it will be removed too.`)) return;
    await perform(() => api.deleteProject(project), "Project deleted");
  }

  async function reserve(event: FormEvent) {
    event.preventDefault();
    const project = projects.find((entry) => entry.public_id === reserveProject);
    const item = reservableItems.find((entry) => entry.public_id === reserveItem);
    if (!project || !item) return;
    await perform(() => api.reserveItem(project, item, reserveQuantity), `${item.name} reserved`);
  }

  async function createLoan(event: FormEvent) {
    event.preventDefault();
    await perform(() => api.createLoan({
      item_public_id: loanItem,
      direction: loanDirection,
      person: loanPerson,
      quantity: "1",
      due_date: loanDue || null,
      notes: "",
    }), "Loan recorded");
    setLoanPerson(""); setLoanDue("");
  }

  async function saveNotifications(event: FormEvent) {
    event.preventDefault();
    await perform(() => api.saveNotifications({
      enabled: notificationsEnabled,
      ntfy_url: notificationUrl,
      ntfy_token: notificationToken,
      expiration_days: Number(expirationDays),
      notify_low_stock: true,
      notify_expiration: true,
      notify_warranty: true,
    }), "Notification settings saved");
    setNotificationToken("");
  }

  async function changeAdminPassword(event: FormEvent) {
    event.preventDefault();
    if (newAdminPassword !== confirmAdminPassword) {
      setNotice("The new passwords do not match");
      return;
    }
    if (newAdminPassword.length < 10) {
      setNotice("The new password must be at least 10 characters");
      return;
    }
    try {
      await api.changeAdminPassword(currentAdminPassword, newAdminPassword);
      setCurrentAdminPassword("");
      setNewAdminPassword("");
      setConfirmAdminPassword("");
      setNotice("Password changed. Sign in again with the new password.");
      window.setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not change the password");
    }
  }

  async function saveAiSettings(event: FormEvent) {
    event.preventDefault();
    await perform(() => api.saveAiSettings({
      enabled: aiEnabled,
      endpoint: aiEndpoint,
      model: aiModel,
      api_key: aiApiKey,
      clear_api_key: false,
    }), "AI settings saved");
    setAiApiKey("");
  }

  async function clearAiKey() {
    await perform(() => api.saveAiSettings({
      enabled: aiEnabled,
      endpoint: aiEndpoint,
      model: aiModel,
      api_key: "",
      clear_api_key: true,
    }), "Saved AI key removed");
    setAiApiKey("");
  }

  function showAiDiagnostic(diagnostic: AIConnectionDiagnostic) {
    setAiDiagnostic(diagnostic);
    window.setTimeout(() => {
      document.getElementById("ai-test-diagnostic")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 50);
  }

  async function testAiConnection() {
    setManageActivity("Testing the AI connection…");
    setAiDiagnostic(null);
    try {
      const diagnostic = await api.testAiSettings();
      notify("AI connection successful", {
        label: "Details",
        action: async () => {
          showAiDiagnostic(diagnostic);
          notify("Provider details opened");
        },
      });
    } catch (error) {
      const diagnostic = error instanceof HttpRequestError ? error.diagnostic : null;
      const message = error instanceof Error ? error.message : "AI connection test failed";
      if (diagnostic) {
        notify(message, {
          label: "Details",
          action: async () => {
            showAiDiagnostic(diagnostic);
            notify("Provider response opened");
          },
        });
      } else {
        notify(message);
      }
    } finally {
      setManageActivity("");
      void load();
    }
  }

  async function saveMqttSettings(event: FormEvent) {
    event.preventDefault();
    await perform(() => api.saveMqttSettings({
      enabled: mqttEnabled,
      host: mqttHost,
      port: Number(mqttPort),
      username: mqttUsername,
      password: mqttPassword,
      clear_password: false,
      base_topic: mqttBaseTopic,
      discovery_prefix: mqttDiscoveryPrefix,
      client_id: mqttClientId,
      publish_interval_seconds: Number(mqttPublishInterval),
    }), "MQTT settings saved and publisher reloaded");
    setMqttPassword("");
  }

  async function clearMqttPassword() {
    await perform(() => api.saveMqttSettings({
      enabled: mqttEnabled,
      host: mqttHost,
      port: Number(mqttPort),
      username: mqttUsername,
      password: "",
      clear_password: true,
      base_topic: mqttBaseTopic,
      discovery_prefix: mqttDiscoveryPrefix,
      client_id: mqttClientId,
      publish_interval_seconds: Number(mqttPublishInterval),
    }), "Saved MQTT password removed");
    setMqttPassword("");
  }

  async function addUnit(event: FormEvent) {
    event.preventDefault();
    const next = customUnit.trim();
    if (!next) return;
    await perform(async () => {
      const result = await api.saveUnits([...units, next]);
      onUnitsChanged(result.units);
    }, "Unit added");
    setCustomUnit("");
  }

  async function addPlaceType(event: FormEvent) {
    event.preventDefault();
    const name = customPlaceType.trim();
    if (!name) return;
    await perform(async () => {
      await api.createLocationType(name);
      await onInventoryChanged();
    }, "Place type added");
    setCustomPlaceType("");
  }

  async function removeUnit(unit: string) {
    await perform(async () => {
      const result = await api.saveUnits(units.filter((entry) => entry !== unit));
      onUnitsChanged(result.units);
    }, "Unit removed");
  }

  async function readImport(file: File) {
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const preview = await api.importPreview(payload);
      setImportPayload(payload);
      setImportSummary(preview.counts);
      setImportDetails(preview.details || []);
      setImportErrors(preview.errors || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid import file";
      setImportPayload(null); setImportSummary({}); setImportDetails([]); setImportErrors([message]);
      setNotice(message);
    }
  }

  async function mergeImport() {
    if (!importPayload) return;
    try {
      const result = await api.importMerge(importPayload);
      setImportSummary(result.created);
      setImportErrors(result.errors || []);
      await onInventoryChanged();
      if (result.errors?.length) {
        setNotice(`Import finished with ${result.errors.length} issue(s)`);
      } else {
        setImportPayload(null);
        setImportSummary(null);
        setImportDetails([]);
        setImportErrors([]);
        await load();
        setNotice(result.import_public_id ? "Import merged successfully; undo is available below" : "Import merged successfully");
      }
    } catch (error) {
      setImportErrors([error instanceof Error ? error.message : "Import failed"]);
      setNotice("Import needs fixes");
    }
  }

  function downloadJsonTemplate(filename: string, payload: unknown) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadImportTemplate() {
    const availableCategories = categories.map((category) => ({
      id: category.id,
      path: categoryOptionLabel(category),
      default_location: category.default_location?.name || null,
      metadata_enabled: Object.fromEntries(
        Object.keys(CATEGORY_DATA_FIELD_LABELS).map((field) => [
          field,
          Boolean(category.capabilities[field as keyof typeof CATEGORY_DATA_FIELD_LABELS]),
        ]),
      ),
    }));
    const availableLocations = flatLocations.map((location) => ({
      public_id: location.public_id,
      path: location.path,
      kind: location.kind,
    }));
    const templateHelp = {
      purpose: "Give this file to a chatbot together with a plain-language list of the inventory changes you want. The chatbot must return one completed findstuff-ops-v1 JSON document for Findstuff to preview.",
      suggested_chatbot_prompt: [
        "Read the instructions and available values in the attached Findstuff operations template.",
        "Create the operations needed for the changes I describe below.",
        "Return only valid JSON with format exactly findstuff-ops-v1 and an operations array. Do not return Markdown, commentary, or code fences.",
        "Do not guess ambiguous existing records. Use IDs or full paths from the template where possible, and ask me for clarification if a safe match is not possible.",
        "My requested changes:",
        "- Replace this line with what to add, adjust, move, update, archive, or reorganize.",
      ],
      workflow: [
        "In Findstuff, open Manage > Backup & data > Import operations with a chatbot.",
        "Download this template. It is generated with the current categories, locations, location kinds, and units.",
        "Attach the template to a chatbot and describe the changes in ordinary language. You can request several kinds of change in one conversation.",
        "Save the chatbot's JSON response as a .json file without reformatting it.",
        "Back in Findstuff, choose that JSON under Import data. Findstuff previews every operation against a temporary copy of the current inventory.",
        "Review all counts and dry-run details. If there are errors, do not merge; give the errors to the chatbot and ask it for corrected JSON.",
        "When the preview is clean, click Merge into this inventory.",
        "If needed, use Undo under Recent imports. Findstuff retains the latest five tracked imports.",
      ],
      file_format: {
        format: "The root object must keep format exactly equal to findstuff-ops-v1. This tells Findstuff this is an operations import, not a full database export.",
        operations: "The root operations field must be an array. Each array entry is one change to preview and then apply in order.",
        comments: "JSON does not support comments. Put guidance only in the instructions object, then keep operations valid JSON.",
        unknown_fields: "Do not invent field names. Use only the fields documented here unless the user explicitly asks for custom notes text.",
      },
      how_to_use: [
        "Fill the root operations array with only the changes requested by the user.",
        "The examples are reference material inside instructions.operation_examples; do not copy examples unless the user actually requested those changes.",
        "Use category path strings from _available_categories.path and location path strings from _available_locations.path whenever possible.",
        "For add item operations, do not create an item if the same name already exists in the same category. Use modify with add_quantity or remove_quantity to change stock.",
        "For modify/delete operations, include match. Prefer public_id/id when known; otherwise use a unique path, name, or barcode.",
        "All booleans must be real JSON booleans true or false, not strings like \"true\".",
        "Preview the file in Findstuff before merging. If preview reports errors, fix the JSON and import again.",
      ],
      operation_shape: {
        op: ["add", "modify", "delete"],
        type: ["item", "category", "location"],
        match: "Required for modify/delete. Not used for add. The match object identifies the existing record.",
        data: "Required for add/modify. Contains fields to create or change. Delete operations normally only need match.",
        examples: [
          { op: "add", type: "item", data: { name: "USB-C cable", category: "Electronics > Cables", location: "Studio > Drawer", quantity: "2", unit: "pcs" } },
          { op: "modify", type: "item", match: { name: "USB-C cable" }, data: { add_quantity: "3" } },
          { op: "delete", type: "location", match: { path: "Garage > Old box" } },
        ],
      },
      operation_examples: {
        add_items: [
          {
            op: "add",
            type: "item",
            data: {
              name: "Example item name",
              category: availableCategories[0]?.path || "",
              location: availableLocations[0]?.path || "",
              quantity: "1",
              unit: units[0] || "pcs",
              notes: "",
              tags: ["example"],
              barcode: "",
            },
          },
        ],
        adjust_quantities: [
          {
            op: "modify",
            type: "item",
            match: { name: "Existing item name" },
            data: { add_quantity: "3" },
          },
          {
            op: "modify",
            type: "item",
            match: { barcode: "1234567890123" },
            data: { remove_quantity: "1" },
          },
        ],
        move_or_update_items: [
          {
            op: "modify",
            type: "item",
            match: { name: "Existing item name" },
            data: {
              location: availableLocations[0]?.path || "",
              category: availableCategories[0]?.path || "",
              notes: "Updated note",
            },
          },
        ],
        add_categories_and_locations: [
          {
            op: "add",
            type: "category",
            data: {
              name: "New subcategory",
              parent: availableCategories[0]?.path || "",
              default_location: availableLocations[0]?.path || null,
            },
          },
          {
            op: "add",
            type: "location",
            data: {
              name: "New box or shelf",
              kind: locationTypes[0]?.name || "location",
              parent: availableLocations[0]?.path || "",
              description: "",
            },
          },
        ],
      },
      item_match_fields: ["public_id", "name", "barcode"],
      category_match_fields: ["id", "path", "name"],
      location_match_fields: ["public_id", "path", "name"],
      item_data_fields: {
        name: "required when adding an item",
        quantity: "absolute quantity, string or number, for add or modify",
        add_quantity: "positive quantity delta for modify, for example 3",
        remove_quantity: "positive quantity to subtract for modify, for example 1",
        unit: units.length ? units : ["pcs", "g", "kg", "ml", "l", "m", "cm"],
        category: "category path from _available_categories, or empty/null for no category",
        location: "location path from _available_locations. If omitted on add, Findstuff uses category default or Unassigned.",
        description: "free text",
        notes: "free text",
        tags: ["array", "of", "short labels"],
        barcode: "retail or custom barcode text",
        low_stock_threshold: "number or null",
        brand: "identity metadata",
        model: "spec metadata",
        serial_number: "identity metadata",
        expiration_date: "YYYY-MM-DD or null",
        purchase_price_minor: "integer cents, for example 1299 for EUR 12.99",
        purchase_currency: "3-letter currency code, for example EUR",
        estimated_price_minor: "integer cents",
        estimated_price_currency: "3-letter currency code, for example EUR",
        links: [{ label: "Manual", url: "https://example.com/manual.pdf" }],
      },
      item_rules: [
        "name is required for add item.",
        "category may be a category path, category id, or empty/null for no category.",
        "location may be a location path or public_id. If omitted during add, Findstuff uses the category default location when available, otherwise Unassigned.",
        "quantity replaces the current quantity. add_quantity and remove_quantity adjust the current quantity and should be used for stock changes.",
        "links must be an array of objects. Each link object needs label and url.",
        "expiration_date must be YYYY-MM-DD or null.",
        "purchase_price_minor and estimated_price_minor are integer minor currency units, for example cents.",
      ],
      category_data_fields: {
        name: "required when adding a category",
        parent: "category path, empty/null for top level",
        default_location: "location path, public_id, or null to clear",
        metadata_enabled: Object.fromEntries(
          Object.keys(CATEGORY_DATA_FIELD_LABELS).map((field) => [field, "true or false"]),
        ),
      },
      category_rules: [
        "Use op add/type category to create a category. Use op modify/type category to rename, move, set default_location, or set metadata_enabled.",
        "parent is a category path. Use empty string or null for a top-level category.",
        "default_location is a location path or public_id. Use null to clear it.",
        "metadata_enabled is optional. When provided, it must be an object whose keys are metadata field names and whose values are true or false.",
        "metadata_enabled on a parent category becomes the inherited behavior for children unless a child has its own metadata_enabled override.",
        "Use metadata_enabled: {} or metadata_enabled: null to clear a category-specific override and return to inherited/default behavior.",
      ],
      location_data_fields: {
        name: "required when adding a location",
        kind: locationTypes.map((entry) => entry.name),
        parent: "location path, empty/null for top level",
        description: "free text",
      },
      location_rules: [
        "Use op add/type location to create a place or container.",
        "kind must be one of _available_location_kinds when possible.",
        "parent is a location path. Use empty string or null for a top-level location.",
        "Use op modify/type location to rename, move by changing parent, change kind, or update description.",
      ],
      metadata_meaning: CATEGORY_DATA_FIELD_LABELS,
    };
    const base = {
      format: "findstuff-ops-v1",
      instructions: templateHelp,
      _available_units: units,
      _available_location_kinds: locationTypes.map((entry) => entry.name),
      _available_categories: availableCategories,
      _available_locations: availableLocations,
      operations: [],
    };
    downloadJsonTemplate("findstuff-operations-template.json", base);
    setNotice("Operations template downloaded");
  }

  async function undoImport(batch: ImportBatch) {
    if (batch.undone_at) return;
    if (!window.confirm("Undo this JSON import? This only reverses records that were tracked for this import.")) return;
    await perform(async () => {
      await api.undoImport(batch.public_id);
      await onInventoryChanged();
      await load();
    }, "Import undone");
  }

  async function downloadEnrichmentExport() {
    const payload = await api.createEnrichmentExport();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `findstuff-enrichment-${payload.export_id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice(`Exported ${payload.items.length} item(s) for enrichment`);
  }

  async function readEnrichmentResponse(file: File) {
    try {
      setEnrichmentFile(JSON.parse(await file.text()) as unknown);
    } catch (error) {
      setEnrichmentFile(null);
      setNotice(error instanceof Error ? error.message : "Invalid enrichment response JSON");
    }
  }

  function importBatchSummary(batch: ImportBatch) {
    return Object.entries(batch.summary)
      .filter(([, count]) => count > 0)
      .map(([name, count]) => `${count} ${name}`)
      .join(" · ") || `${batch.undo_count} tracked change${batch.undo_count === 1 ? "" : "s"}`;
  }

  const system = settings?.system;
  const diskFreePercent = system?.storage.disk_total_bytes
    ? Math.round((system.storage.disk_free_bytes / system.storage.disk_total_bytes) * 100)
    : 0;
  const setupHealth = settings && system ? [
    {
      label: "HTTPS",
      status: window.location.protocol === "https:" ? "Ready" : "Needs attention",
      detail: window.location.protocol === "https:" ? "This connection is protected" : "Open Findstuff through HTTPS, such as Tailscale Serve",
    },
    {
      label: "Authentication",
      status: settings.setup.authentication.required && settings.setup.authentication.configured ? "Ready" : "Needs attention",
      detail: settings.setup.authentication.required ? "Sign-in protection is active" : "Turn on sign-in protection before sharing access",
    },
    {
      label: "Backup",
      status: settings.setup.backup.enabled && settings.setup.backup.last_backup_at ? "Ready" : "Needs attention",
      detail: settings.setup.backup.last_backup_at ? `Last automatic Backup ${new Date(settings.setup.backup.last_backup_at).toLocaleString()}` : settings.setup.backup.enabled ? "Waiting for the first automatic Backup" : "Automatic Backups are off",
    },
    {
      label: "AI",
      status: settings.integrations.ai.enabled && settings.integrations.ai.endpoint && settings.integrations.ai.model && settings.integrations.ai.api_key_set ? "Ready" : settings.integrations.ai.enabled ? "Needs attention" : "Optional",
      detail: settings.integrations.ai.enabled ? "AI Scan is configured" : "Set up AI to use automatic photo recognition",
    },
    {
      label: "MQTT",
      status: settings.integrations.mqtt.enabled && settings.integrations.mqtt.host ? "Ready" : settings.integrations.mqtt.enabled ? "Needs attention" : "Optional",
      detail: settings.integrations.mqtt.enabled ? "Home Assistant publishing is configured" : "Connect Home Assistant when you want it",
    },
    {
      label: "Updates",
      status: softwareUpdate?.enabled ? "Ready" : "Optional",
      detail: softwareUpdate?.enabled ? "In-app updates are available" : "Update from the Linux machine",
    },
    {
      label: "Storage",
      status: diskFreePercent >= 10 && system.storage.disk_free_bytes >= 1024 ** 3 ? "Ready" : "Needs attention",
      detail: `${formatBytes(system.storage.disk_free_bytes)} free`,
    },
    {
      label: "App version",
      status: "Ready",
      detail: system.app.version,
    },
  ] : [];
  const updateLabel = softwareUpdate?.status === "queued" || softwareUpdate?.status === "running"
    ? "Updating…"
    : softwareUpdate?.status === "failed" || softwareUpdate?.status === "attention"
      ? "Needs attention"
      : softwareUpdate?.update_available === true
        ? "Update available"
        : softwareUpdate?.update_available === false
          ? "Up to date"
          : "Check for updates";

  return (
    <section className="manage-page">
      {manageActivity && <div className="inline-activity manage-activity" role="status"><span className="activity-spinner" />{manageActivity}</div>}
      <button className="feature-link ai-inbox-link" onClick={onInbox}><span><Icon name="spark" /></span><div><strong>AI Inbox</strong><small>Review photos and approve, edit, or reject suggested Items</small></div><Icon name="chevron" /></button>
      <button className="feature-link" onClick={onLocations}><span><Icon name="pin" /></span><div><strong>Places</strong><small>Build your room, shelf, drawer, and box hierarchy</small></div><Icon name="chevron" /></button>
      <button className="feature-link" onClick={onCategories}><span><Icon name="tag" /></span><div><strong>Categories</strong><small>{categories.length} Categories · hierarchy, details, and default Places</small></div><Icon name="chevron" /></button>
      <button className="feature-link" onClick={onOffCategoryMappings}><span><Icon name="spark" /></span><div><strong>Open Food Facts category mapping</strong><small>Review scanned categories, assignments, and JSON imports</small></div><Icon name="chevron" /></button>

      <details><summary><span className="summary-icon"><Icon name="settings" /></span><span><strong>Appearance</strong><small>{theme === "system" ? "Follows this device" : `${theme[0].toUpperCase()}${theme.slice(1)} theme`}</small></span><Icon name="chevron" /></summary><div className="manage-panel"><div className="theme-options" role="radiogroup" aria-label="Color theme">{(["light", "dark", "system"] as ThemePreference[]).map((option) => <button type="button" role="radio" aria-checked={theme === option} className={theme === option ? "active" : ""} key={option} onClick={() => onThemeChange(option)}><span className={`theme-preview ${option}`} aria-hidden="true" /><strong>{option === "system" ? "Device" : option[0].toUpperCase() + option.slice(1)}</strong><small>{option === "system" ? "Match system setting" : `${option} colors`}</small></button>)}</div></div></details>

      <details><summary><span className="summary-icon"><Icon name="search" /></span><span><strong>Search language</strong><small>Aliases, nicknames, and household terms</small></span><Icon name="chevron" /></summary><div className="manage-panel"><SearchAliasManager items={items} locations={locations} /></div></details>

      <details><summary><span className="summary-icon"><Icon name="user" /></span><span><strong>Security</strong><small>Change the administrator password</small></span><Icon name="chevron" /></summary><div className="manage-panel">
        <p className="panel-copy">Change the password used to open Findstuff and call its API. It stays write-only and is excluded from exports and backup ZIPs.</p>
        <form className="form-card compact-form" onSubmit={changeAdminPassword}>
          <label>Current password<input required type="password" autoComplete="current-password" value={currentAdminPassword} onChange={(event) => setCurrentAdminPassword(event.target.value)} /></label>
          <label>New password<input required minLength={10} maxLength={256} type="password" autoComplete="new-password" value={newAdminPassword} onChange={(event) => setNewAdminPassword(event.target.value)} /><small>At least 10 characters.</small></label>
          <label>Confirm new password<input required minLength={10} maxLength={256} type="password" autoComplete="new-password" value={confirmAdminPassword} onChange={(event) => setConfirmAdminPassword(event.target.value)} /></label>
          <button className="secondary" disabled={busy || !currentAdminPassword || newAdminPassword.length < 10 || newAdminPassword !== confirmAdminPassword}>Change password</button>
        </form>
        <p className="panel-copy">After saving, Findstuff will return to its sign-in page for the new password.</p>
      </div></details>

      <details><summary><span className="summary-icon"><Icon name="search" /></span><span><strong>Lost items</strong><small>{lostItems.length ? `${lostItems.length} marked lost` : "Nothing marked lost"}</small></span><Icon name="chevron" /></summary><div className="manage-panel"><div className="lost-list">{lostItems.length === 0 && <div className="empty-inline"><span>Everything is accounted for</span></div>}{lostItems.map((item) => <article className="lost-row" key={item.public_id}><button type="button" className="lost-main" onClick={() => onOpenItem(item)}><span><Icon name="search" size={17} /></span><div><strong>{item.name}</strong><small>{item.location_path}</small></div></button><div className="lost-actions"><button className="secondary" type="button" onClick={() => void onMarkFound(item)}><Icon name="check" size={14} />Found</button><button type="button" onClick={() => void onForeverLost(item)}><Icon name="close" size={14} />Forever lost</button></div></article>)}</div></div></details>
      <details><summary><span className="summary-icon"><Icon name="box" /></span><span><strong>Archived Items</strong><small>{archivedItems.length ? `${archivedItems.length} archived` : "Archive is empty"}</small></span><Icon name="chevron" /></summary><div className="manage-panel">
        <p className="panel-copy">Archived Items stay out of Inventory but remain available to restore. Delete forever permanently removes the Item, its photos, and its history.</p>
        <div className="archived-list">
          {archivedItems.length === 0 && <div className="empty-inline"><span>No archived Items</span></div>}
          {archivedItems.map((item) => <article className="archived-row" key={item.public_id}>
            {item.primary_photo_url ? <img src={item.primary_photo_url} alt="" /> : <span className="archived-placeholder"><Icon name="box" size={19} /></span>}
            <div className="archived-main"><strong>{item.name}</strong><small>{item.location_path}{item.category_path ? ` · ${item.category_path}` : ""}</small><time>Archived {item.archived_at ? new Date(`${item.archived_at}Z`).toLocaleString() : "recently"}</time></div>
            <div className="archived-actions"><button className="secondary" type="button" disabled={busy} onClick={() => void restoreArchivedItem(item)}><Icon name="check" size={14} />Restore</button><button className="danger-button" type="button" disabled={busy} onClick={() => void permanentlyDeleteArchivedItem(item)}><Icon name="close" size={14} />Delete forever</button></div>
          </article>)}
        </div>
      </div></details>
      <details><summary><span className="summary-icon"><Icon name="spark" /></span><span><strong>Recent activity</strong><small>{dashboard?.recent_events.length ? "Latest inventory changes" : "No changes yet"}</small></span><Icon name="chevron" /></summary><div className="manage-panel"><div className="event-list">{!dashboard?.recent_events.length && <div className="empty-inline"><span>Changes will appear here</span></div>}{dashboard?.recent_events.slice(0, 12).map((event, index) => <div className="event" key={`${event.created_at}-${index}`}><span>{activityLabel(event.action)}</span><strong>{event.item_name}</strong><time>{new Date(`${event.created_at}Z`).toLocaleString()}</time></div>)}</div></div></details>

      <button className="feature-link" onClick={onDefaultRules}><span><Icon name="settings" /></span><div><strong>Default locations</strong><small>{rules.length} rules · search, edit, and inspect automatic destinations</small></div><Icon name="chevron" /></button>

      <details><summary><span className="summary-icon"><Icon name="settings" /></span><span><strong>Customization</strong><small>{locationTypes.length} Place types · {units.length} units of measure</small></span><Icon name="chevron" /></summary><div className="manage-panel customization-panel">
        <section className="customization-group"><div><strong>Place types</strong><small>Names available when creating or editing a Place</small></div><div className="type-chip-row">{locationTypes.map((entry) => <span key={entry.name}>{entry.name}</span>)}</div><form className="form-card compact-form type-form" onSubmit={addPlaceType}><label>New Place type<input value={customPlaceType} onChange={(event) => setCustomPlaceType(event.target.value)} placeholder="crate, suitcase, rack…" maxLength={40} /></label><button className="secondary" disabled={!customPlaceType.trim()}>Add Place type</button></form></section>
        <section className="customization-group"><div><strong>Units of measure</strong><small>Units available when recording Item quantities</small></div><div className="type-chip-row">{units.map((entry) => <span key={entry}>{entry}<button type="button" aria-label={`Remove ${entry}`} onClick={() => void removeUnit(entry)}><Icon name="close" size={12} /></button></span>)}</div><form className="form-card compact-form type-form" onSubmit={addUnit}><label>New unit<input value={customUnit} onChange={(event) => setCustomUnit(event.target.value)} placeholder="tray, bottle, reel, sheet…" maxLength={24} /></label><button className="secondary" disabled={!customUnit.trim()}>Add unit</button></form></section>
      </div></details>

      <details><summary><span className="summary-icon"><Icon name="box" /></span><span><strong>Projects & reservations</strong><small>{projects.filter((project) => project.status === "active").length} active projects</small></span><Icon name="chevron" /></summary><div className="manage-panel">
        {projects.map((project) => <article className="manage-card" key={project.public_id}><header><div><strong>{project.name}</strong><small>{project.status}</small></div><div className="project-actions">{project.status === "active" && <button onClick={() => void perform(() => api.setProjectStatus(project, "completed"), "Project completed")}>Complete</button>}<button onClick={() => void removeProject(project)}>Delete</button></div></header>{project.description && <p>{project.description}</p>}{project.reservations.map((reservation) => <div className="reservation" key={reservation.item_public_id}><span>{reservation.item_name}</span><small>{reservation.quantity} {reservation.unit}</small><button aria-label={`Remove ${reservation.item_name} reservation`} onClick={() => void perform(() => api.removeReservation(project, reservation.item_public_id), "Reservation removed")}><Icon name="close" size={15} /></button></div>)}</article>)}
        {projects.length === 0 && <div className="empty-inline"><span>No projects yet</span></div>}
        <details className="nested-form"><summary>Create a project</summary><form className="form-card compact-form" onSubmit={createProject}><label>Project name<input required value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="e.g. Workbench power supply" /></label><label>Description<input value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} /></label><button className="secondary">Create project</button></form></details>
        {projects.some((project) => project.status === "active") && reservableItems.length > 0 && <details className="nested-form"><summary>Reserve inventory</summary><form className="form-card compact-form" onSubmit={reserve}><label>Project<select value={reserveProject} onChange={(event) => setReserveProject(event.target.value)}>{projects.filter((project) => project.status === "active").map((project) => <option value={project.public_id} key={project.public_id}>{project.name}</option>)}</select></label><label>Inventory item<select value={reserveItem} onChange={(event) => setReserveItem(event.target.value)}>{reservableItems.map((item) => <option value={item.public_id} key={item.public_id}>{item.name} · {item.quantity} {item.unit}</option>)}</select></label><label>Reserve quantity<input inputMode="decimal" value={reserveQuantity} onChange={(event) => setReserveQuantity(event.target.value)} /></label><button className="secondary">Reserve item</button></form></details>}
      </div></details>

      <details><summary><span className="summary-icon"><Icon name="user" /></span><span><strong>Borrowed & lent</strong><small>{loans.filter((loan) => !loan.returned_at).length} open records</small></span><Icon name="chevron" /></summary><div className="manage-panel">
        {loans.filter((loan) => !loan.returned_at).map((loan) => <article className="loan-card" key={loan.public_id}><div><strong>{loan.item_name}</strong><p>{loan.direction === "lent" ? `Lent to ${loan.person}` : `Borrowed from ${loan.person}`}</p><small>{loan.due_date ? `Due ${loan.due_date}` : "No due date"}</small></div><button onClick={() => void perform(() => api.returnLoan(loan), "Marked as returned")}>Returned</button></article>)}
        {loans.filter((loan) => !loan.returned_at).length === 0 && <div className="empty-inline"><span>Nothing is currently out</span></div>}
        <details className="nested-form"><summary>Record a loan</summary><form className="form-card compact-form" onSubmit={createLoan}><label>Item<select value={loanItem} onChange={(event) => setLoanItem(event.target.value)}>{items.map((item) => <option value={item.public_id} key={item.public_id}>{item.name}</option>)}</select></label><div className="form-row"><label>Direction<select value={loanDirection} onChange={(event) => setLoanDirection(event.target.value as "lent" | "borrowed")}><option value="lent">I lent it</option><option value="borrowed">I borrowed it</option></select></label><label>Person<input required value={loanPerson} onChange={(event) => setLoanPerson(event.target.value)} /></label></div><label>Due date<input type="date" value={loanDue} onChange={(event) => setLoanDue(event.target.value)} /></label><button className="secondary" disabled={!loanItem}>Record loan</button></form></details>
      </div></details>

      <details><summary><span className="summary-icon"><Icon name="settings" /></span><span><strong>Notifications</strong><small>{notificationsEnabled ? "ntfy alerts enabled" : "Alerts are off"}</small></span><Icon name="chevron" /></summary><div className="manage-panel"><form className="form-card compact-form" onSubmit={saveNotifications}><label className="toggle"><input type="checkbox" checked={notificationsEnabled} onChange={(event) => setNotificationsEnabled(event.target.checked)} /><span><strong>Enable notifications</strong><small>Low stock and upcoming expiration alerts</small></span></label><label>ntfy topic URL<input type="url" value={notificationUrl} onChange={(event) => setNotificationUrl(event.target.value)} placeholder="https://ntfy.sh/your-private-topic" /></label><label>Access token {settings?.notifications.ntfy_token_set && <small>(saved)</small>}<input type="password" value={notificationToken} onChange={(event) => setNotificationToken(event.target.value)} placeholder="Leave blank to keep existing" /></label><label>Warn before expiration<input type="number" min="0" max="365" value={expirationDays} onChange={(event) => setExpirationDays(event.target.value)} /><small>Days before the expiration date</small></label><button className="secondary">Save notifications</button></form><button className="outline-button" onClick={() => void perform(() => api.testNotification(), "Test notification sent")}>Send test notification</button></div></details>

      <details><summary><span className="summary-icon"><Icon name="qr" /></span><span><strong>Backup & data</strong><small>{settings?.setup.backup.last_backup_at ? `Automatic Backup: ${new Date(settings.setup.backup.last_backup_at).toLocaleDateString()}` : "Download, restore, import, and undo"}</small></span><Icon name="chevron" /></summary><div className="manage-panel">
        <div className="backup-status-card"><div><strong>Automatic Backups</strong><small>{settings?.setup.backup.enabled ? `${settings.setup.backup.backup_count} saved · keeps the latest ${settings.setup.backup.retention}` : "Not enabled on this installation"}</small></div><b className={`health-status ${settings?.setup.backup.enabled && settings.setup.backup.last_backup_at ? "ready" : "needs-attention"}`}>{settings?.setup.backup.last_backup_at ? `Last made ${new Date(settings.setup.backup.last_backup_at).toLocaleString()}` : settings?.setup.backup.enabled ? "Waiting for first Backup" : "Needs attention"}</b></div>
        {dataActivity && <div className="inline-activity" role="status"><span className="activity-spinner" />{dataActivity}</div>}
        <div className="button-row data-download-row"><button type="button" className="primary download-button" disabled={Boolean(dataActivity)} onClick={() => void downloadData("/api/v1/admin/export", "findstuff-export.json", "Export")}>Download JSON export</button><button type="button" className="secondary download-button" disabled={Boolean(dataActivity)} onClick={() => void downloadData("/api/v1/admin/backup", "findstuff-backup.zip", "Backup")}>Download full Backup</button></div>
        <div className="restore-backup-box"><div><strong>Restore a full Backup</strong><span>Choose a Findstuff Backup file to replace every Item, Place, Category, history record, and saved photo. A safety Backup is made first.</span></div><button type="button" className="danger-button" disabled={busy || Boolean(dataActivity)} onClick={() => restoreInputRef.current?.click()}>Choose Backup</button><input ref={restoreInputRef} hidden type="file" accept="application/zip,.zip" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void restoreFullBackup(file); }} /></div>
        <details className="nested-form import-template-box"><summary>Import operations with a chatbot</summary><div className="import-template-grid"><p className="panel-copy">Download one guide containing every operation type plus your current Categories, Places, Place types, and units. Attach it to a chatbot, describe the changes you want, then bring its JSON response back here for preview.</p><button type="button" className="secondary button-with-icon" onClick={downloadImportTemplate}><Icon name="spark" size={15} />Download operations template</button></div></details>
        <label className="upload-import"><strong>Import data</strong><span>Choose a Findstuff export or changes file to preview it first.</span><input type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && void readImport(event.target.files[0])} /></label>
        {importSummary && <div className="import-preview"><strong>{importErrors.length ? "Import needs fixes" : "Ready to merge"}</strong>{Object.entries(importSummary).map(([name, count]) => <p key={name}><span>{name}</span><b>{count}</b></p>)}{importDetails.length > 0 && <div className="import-detail-list"><span>Dry-run details</span>{importDetails.map((detail) => <article className={`import-detail ${detail.status}`} key={`${detail.index}-${detail.label}`}><b>{detail.status}</b><div><strong>{detail.label}</strong><small>{detail.message}</small></div></article>)}</div>}{importErrors.length > 0 && <div className="import-errors">{importErrors.map((error, index) => <small key={`${index}-${error}`}>{error}</small>)}</div>}<button className="primary" disabled={busy || !importPayload || importErrors.length > 0} onClick={() => void mergeImport()}>Merge into this inventory</button></div>}
        <div className="import-history"><strong>Recent imports</strong><small>Only the latest five are kept; older import history is removed automatically.</small>{importBatches.length === 0 && <div className="empty-inline"><span>No undoable imports yet</span></div>}{importBatches.map((batch) => <article className="import-batch" key={batch.public_id}><div><strong>{batch.mode === "operations" ? "Changes import" : "Data import"}</strong><small>{new Date(batch.created_at).toLocaleString()} · {importBatchSummary(batch)}</small>{batch.undone_at && <em>Undone {new Date(batch.undone_at).toLocaleString()}</em>}</div><button className="secondary" disabled={busy || Boolean(batch.undone_at)} onClick={() => void undoImport(batch)}>Undo</button></article>)}</div>
      </div></details>

      <details><summary><span className="summary-icon"><Icon name="settings" /></span><span><strong>Software update</strong><small>{updateLabel}</small></span><Icon name="chevron" /></summary><div className="manage-panel">
        <p className="panel-copy">{softwareUpdate?.enabled ? "Install published FindStuffer releases without leaving the app." : "In-app updates are disabled for this installation. Update safely on the Linux machine with ./update-docker.sh."}</p>
        <div className="integration-list update-status-list">
          <p><span>Status</span><b className={`integration-status ${updateLabel === "Up to date" ? "ready" : ""}`}>{updateLabel}</b></p>
          <p><span>Installed version</span><code>{softwareUpdate?.current_version || system?.app.version || "Unknown"}</code></p>
          {softwareUpdate?.latest_version && <p><span>Latest release</span>{softwareUpdate.release_url ? <a href={softwareUpdate.release_url} target="_blank" rel="noreferrer">v{softwareUpdate.latest_version}</a> : <code>{softwareUpdate.latest_version}</code>}</p>}
          {softwareUpdate?.completed_at && <p><span>Finished</span><small>{new Date(softwareUpdate.completed_at).toLocaleString()}</small></p>}
        </div>
        {softwareUpdate?.log_tail && softwareUpdate.log_tail.length > 0 && <details className="nested-form" open={softwareUpdate.status === "failed" || softwareUpdate.status === "attention"}><summary>Recent updater log · last 30 lines</summary><pre className="log-tail">{softwareUpdate.log_tail.join("\n")}</pre></details>}
        <div className="button-row">{softwareUpdate?.enabled && <button className="primary" disabled={busy || softwareUpdate?.status === "running" || softwareUpdate?.status === "queued" || softwareUpdate?.update_available === false} onClick={() => void requestUpdate()}><Icon name="spark" size={16} />Install update</button>}<button className="secondary" disabled={busy} onClick={() => void perform(async () => setSoftwareUpdate(await api.softwareUpdateStatus()), "Update status refreshed")}>Check again</button></div>
      </div></details>

      <details><summary><span className="summary-icon"><Icon name="spark" /></span><span><strong>Integrations</strong><small>Configure AI and Home Assistant MQTT</small></span><Icon name="chevron" /></summary><div className="manage-panel integration-settings">
        <section className="integration-config-card">
          <div className="integration-config-heading"><div><strong>AI parser & vision</strong><small>OpenAI-compatible chat-completions endpoint for commands and AI Scan</small></div><b className={`integration-status ${settings?.integrations.ai.enabled ? "ready" : ""}`}>{settings?.integrations.ai.enabled ? "Enabled" : "Disabled"}</b></div>
          <form className="form-card compact-form" onSubmit={saveAiSettings}>
            <label className="toggle"><input type="checkbox" checked={aiEnabled} onChange={(event) => setAiEnabled(event.target.checked)} /><span><strong>Enable AI</strong><small>Use this provider for text commands and image recognition</small></span></label>
            <label>API endpoint<input type="url" value={aiEndpoint} onChange={(event) => setAiEndpoint(event.target.value)} placeholder="https://api.openai.com/v1/chat/completions" /></label>
            <label>Model<input value={aiModel} onChange={(event) => setAiModel(event.target.value)} placeholder="gpt-4.1-mini" /></label>
            <label>API key {settings?.integrations.ai.api_key_set && <small>(saved)</small>}<input type="password" autoComplete="new-password" value={aiApiKey} onChange={(event) => setAiApiKey(event.target.value)} placeholder="Leave blank to keep the saved key" /></label>
            <div className="button-row"><button className="secondary" disabled={busy}>Save AI settings</button><button type="button" className="outline-button" disabled={busy || Boolean(manageActivity) || !settings?.integrations.ai.endpoint} onClick={() => void testAiConnection()}>Test connection</button>{settings?.integrations.ai.api_key_set && <button type="button" disabled={busy} onClick={() => void clearAiKey()}>Remove key</button>}</div>
          </form>
          {settings?.integrations.ai.usage && <div className="ai-usage-card">
            <div><strong>AI usage this month</strong><small>Provider-reported tokens when available; otherwise a text estimate.</small></div>
            <div className="ai-usage-grid">
              <span><small>Calls</small><strong>{settings.integrations.ai.usage.calls.toLocaleString()}</strong></span>
              <span><small>Input tokens</small><strong>{settings.integrations.ai.usage.input_tokens.toLocaleString()}</strong></span>
              <span><small>Output tokens</small><strong>{settings.integrations.ai.usage.output_tokens.toLocaleString()}</strong></span>
              <span className={settings.integrations.ai.usage.failed_calls ? "warning" : ""}><small>Failed</small><strong>{settings.integrations.ai.usage.failed_calls.toLocaleString()}</strong></span>
            </div>
            <p>{settings.integrations.ai.usage.scan_calls} image scan{settings.integrations.ai.usage.scan_calls === 1 ? "" : "s"} · {settings.integrations.ai.usage.command_calls} command{settings.integrations.ai.usage.command_calls === 1 ? "" : "s"} · {settings.integrations.ai.usage.all_time_calls} calls all time</p>
            {settings.integrations.ai.usage.image_bytes_saved > 0 && <p>{formatBytes(settings.integrations.ai.usage.image_bytes_saved)} of image upload data avoided by resizing and compression.</p>}
            <small>Vision-image token accounting varies by provider. Barcode scans are excluded because they use local decoding and Open Food Facts—not AI.</small>
          </div>}
          {aiDiagnostic && <details id="ai-test-diagnostic" className="ai-diagnostic" open><summary><span>Provider response</span><Icon name="chevron" size={15} /></summary><div><p><span>HTTP status</span><strong>{aiDiagnostic.http_status}</strong></p><p><span>Model</span><code>{aiDiagnostic.model}</code></p><p><span>Response type</span><code>{aiDiagnostic.response_type || "Not provided"}</code></p>{aiDiagnostic.provider_reply && <p><span>Provider reply</span><code>{aiDiagnostic.provider_reply}</code></p>}<small>{aiDiagnostic.hint}</small><label>Safe response preview<textarea readOnly rows={10} value={aiDiagnostic.response_preview || "No response body"} /></label><em>API keys, tokens, passwords, and secrets are redacted. The preview is limited to 4,000 characters.</em></div></details>}
        </section>
        <section className="integration-config-card">
          <div className="integration-config-heading"><div><strong>Home Assistant MQTT</strong><small>Publishes discovery, availability, and inventory counters to your broker</small></div><b className={`integration-status ${settings?.integrations.mqtt.enabled ? "ready" : ""}`}>{settings?.integrations.mqtt.enabled ? "Enabled" : "Disabled"}</b></div>
          <form className="form-card compact-form" onSubmit={saveMqttSettings}>
            <label className="toggle"><input type="checkbox" checked={mqttEnabled} onChange={(event) => setMqttEnabled(event.target.checked)} /><span><strong>Enable MQTT publishing</strong><small>Home Assistant discovers Findstuff sensors automatically</small></span></label>
            <div className="form-row"><label>Broker host<input value={mqttHost} onChange={(event) => setMqttHost(event.target.value)} placeholder="homeassistant.local" /></label><label>Port<input type="number" min="1" max="65535" value={mqttPort} onChange={(event) => setMqttPort(event.target.value)} /></label></div>
            <div className="form-row"><label>Username<input autoComplete="username" value={mqttUsername} onChange={(event) => setMqttUsername(event.target.value)} /></label><label>Password {settings?.integrations.mqtt.password_set && <small>(saved)</small>}<input type="password" autoComplete="new-password" value={mqttPassword} onChange={(event) => setMqttPassword(event.target.value)} placeholder="Leave blank to keep saved" /></label></div>
            <div className="form-row"><label>Base topic<input value={mqttBaseTopic} onChange={(event) => setMqttBaseTopic(event.target.value)} /></label><label>Discovery prefix<input value={mqttDiscoveryPrefix} onChange={(event) => setMqttDiscoveryPrefix(event.target.value)} /></label></div>
            <div className="form-row"><label>Client ID<input value={mqttClientId} onChange={(event) => setMqttClientId(event.target.value)} /></label><label>Publish every (seconds)<input type="number" min="15" max="86400" value={mqttPublishInterval} onChange={(event) => setMqttPublishInterval(event.target.value)} /></label></div>
            <small>Discovery: {mqttDiscoveryPrefix || "homeassistant"}/sensor/findstuff/# · State: {mqttBaseTopic || "findstuff"}/state</small>
            <div className="button-row"><button className="secondary" disabled={busy}>Save MQTT settings</button><button type="button" className="outline-button" disabled={busy || !settings?.integrations.mqtt.host} onClick={() => void perform(() => api.testMqttSettings(), "MQTT connection successful")}>Test connection</button>{settings?.integrations.mqtt.password_set && <button type="button" disabled={busy} onClick={() => void clearMqttPassword()}>Remove password</button>}</div>
          </form>
        </section>
        <div className="integration-list"><p><span>Open Food Facts</span><b className="integration-status ready">Ready</b></p><p><span>Speech-to-text</span><b className="integration-status">{settings?.integrations.stt_configured ? "Ready" : "Browser only"}</b></p></div>
        <p className="panel-copy">Secrets are write-only: the app never returns the AI key or MQTT password through its API, JSON exports, or backup ZIPs. Re-enter them after restoring a backup.</p>
      </div></details>
      <details><summary><span className="summary-icon"><Icon name="spark" /></span><span><strong>Enrichment queue</strong><small>{missingEnrichmentCount === null ? "Checking barcode Items…" : missingEnrichmentCount ? `${missingEnrichmentCount} barcode Item${missingEnrichmentCount === 1 ? "" : "s"} missing enrichment` : "No barcode Items are missing enrichment"}</small></span><Icon name="chevron" /></summary><div className="manage-panel"><div className={`enrichment-missing-card ${missingEnrichmentCount === 0 ? "complete" : ""}`}><span><Icon name={missingEnrichmentCount === 0 ? "check" : "qr"} size={21} /></span><div><strong>{missingEnrichmentCount ?? "—"}</strong><small>barcode Item{missingEnrichmentCount === 1 ? "" : "s"} missing enrichment</small></div></div><p className="panel-copy">Queue eligible barcode Items that Open Food Facts has not enriched yet, then process a small batch. Automatic maintenance handles this periodically.</p><div className="button-row"><button className="secondary" disabled={!missingEnrichmentCount} onClick={() => void perform(() => api.queueMissingEnrichment(), "Missing enrichment jobs queued")}>Queue missing</button><button className="primary" onClick={() => void perform(() => api.runEnrichment(), "Enrichment batch processed")}>Run batch now</button></div><small>Current provider: Open Food Facts.</small></div></details>
      <details><summary><span className="summary-icon"><Icon name="spark" /></span><span><strong>External enrichment review</strong><small>{suggestions.length} pending imported suggestion{suggestions.length === 1 ? "" : "s"}</small></span><Icon name="chevron" /></summary><div className="manage-panel">
        <p className="panel-copy">Export missing/weak metadata, let an external agent research it, import the response, then review patches before they change your inventory.</p>
        <div className="button-row"><button className="secondary" onClick={() => void perform(downloadEnrichmentExport, "Enrichment request downloaded")}>Export request JSON</button><label className="upload-import compact-upload"><strong>Import response JSON</strong><input type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && void readEnrichmentResponse(event.target.files[0])} /></label></div>
        {enrichmentFile !== null && <button className="primary wide" onClick={() => void perform(async () => { const result = await api.importEnrichmentResponse(enrichmentFile); setEnrichmentFile(null); await load(); return result; }, "Enrichment response imported")}>Validate and import suggestions</button>}
        <div className="suggestion-list">{suggestions.length === 0 && <div className="empty-inline"><span>No pending suggestions</span></div>}{suggestions.map((suggestion) => <article className="suggestion-row" key={suggestion.public_id}><div><strong>{suggestion.item_name}</strong><small>{suggestion.path} · {Math.round(suggestion.confidence * 100)}% confidence</small><code>{typeof suggestion.value === "object" ? JSON.stringify(suggestion.value) : String(suggestion.value)}</code>{suggestion.sources[0]?.url && <a href={suggestion.sources[0].url} target="_blank" rel="noreferrer">{suggestion.sources[0].label || "Source"}</a>}{suggestion.uncertainty && <em>{suggestion.uncertainty}</em>}</div><div><button className="primary" onClick={() => void perform(async () => { await api.acceptSuggestion(suggestion.public_id); await onInventoryChanged(); }, "Suggestion accepted")}>Accept</button><button onClick={() => void perform(() => api.rejectSuggestion(suggestion.public_id), "Suggestion rejected")}>Reject</button></div></article>)}</div>
      </div></details>
      <details className="app-info-section"><summary><span className="summary-icon"><Icon name="settings" /></span><span><strong>App info</strong><small>{setupHealth.some((entry) => entry.status === "Needs attention") ? `${setupHealth.filter((entry) => entry.status === "Needs attention").length} need attention` : system ? `Everything ready · version ${system.app.version}` : "Health, storage, resources, and version"}</small></span><Icon name="chevron" /></summary><div className="manage-panel app-info-panel">
        <section className="app-info-health"><div className="section-heading"><div><h2>Setup health</h2><span>Connection, protection, Backups, integrations, and updates</span></div></div><div className="setup-health-grid">{setupHealth.map((entry) => <article key={entry.label}><span>{entry.label}</span><b className={`health-status ${entry.status.toLowerCase().replace(" ", "-")}`}>{entry.status}</b><small>{entry.detail}</small></article>)}</div></section>
        {system ? <>
          <div className="section-heading app-info-metrics-heading"><div><h2>Storage & resources</h2><span>Current usage on this FindStuffer machine</span></div></div>
          <div className="app-metric-grid">
            <div><span>Total data</span><strong>{formatBytes(system.storage.total_managed_bytes)}</strong><small>Database + photos + documents</small></div>
            <div><span>Database</span><strong>{formatBytes(system.storage.database_bytes)}</strong><small>{formatBytes(system.storage.database_main_bytes)} main · {formatBytes(system.storage.database_wal_bytes)} WAL</small></div>
            <div><span>Photos</span><strong>{formatBytes(system.storage.photos_bytes)}</strong><small>{system.inventory.photos} saved photo{system.inventory.photos === 1 ? "" : "s"}</small></div>
            <div><span>Documents</span><strong>{formatBytes(system.storage.documents_bytes)}</strong><small>{system.inventory.documents} owned document{system.inventory.documents === 1 ? "" : "s"}</small></div>
            <div><span>App CPU</span><strong>{system.resources.cpu_percent.toFixed(1)}%</strong><small>{system.resources.cpu_count} CPU core{system.resources.cpu_count === 1 ? "" : "s"} available</small></div>
            <div><span>App RAM</span><strong>{formatBytes(system.resources.memory_rss_bytes)}</strong><small>Current resident memory</small></div>
            <div><span>Disk free</span><strong>{formatBytes(system.storage.disk_free_bytes)}</strong><small>{diskFreePercent}% of {formatBytes(system.storage.disk_total_bytes)}</small></div>
          </div>
          <div className="integration-list app-info-list"><p><span>Inventory</span><small>{system.inventory.items} Items · {system.inventory.locations} Places · {system.inventory.categories} Categories</small></p><p><span>Version</span><code>{system.app.version}</code></p><p><span>License</span><a href="https://github.com/MrFanfo/FindStuffer" target="_blank" rel="noreferrer">AGPL-3.0-only · Source code</a></p><p><span>Running for</span><small>{formatUptime(system.app.uptime_seconds)}</small></p></div>
          <details className="nested-form technical-details"><summary>Technical details</summary><div className="integration-list app-info-list">
            <p><span>Other data folder usage</span><small>{formatBytes(system.storage.other_data_bytes)}</small></p>
            <p><span>Database engine</span><small>{system.database.journal_mode.toUpperCase()} · {system.database.page_count.toLocaleString()} pages · {formatBytes(system.database.page_size)} page size</small></p>
            <p><span>Started</span><small>{new Date(system.app.started_at).toLocaleString()}</small></p>
            <p><span>Process</span><small>PID {system.app.process_id} · Python {system.app.python_version}</small></p>
            <p><span>Database path</span><code>{system.storage.database_path}</code></p>
            <p><span>Data folder</span><code>{system.storage.data_dir}</code></p>
          </div></details>
          <button className="outline-button" onClick={() => void load()}>Refresh info</button>
        </> : <div className="empty-inline"><span>Loading app information</span></div>}
      </div></details>
    </section>
  );
}

export default App;
