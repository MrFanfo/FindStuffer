import { applyQuantityOperation, persistQuantityChange } from "./features/inventory/quantityChanges";
import { AutoOfflineInventory } from './features/shell/AutoOfflineInventory';
import { restoreInventoryPage, rememberInventoryPage } from "./features/inventory/inventoryHistory";
import { HomeExtras } from "./features/dashboard/HomeExtras";
import { useNavigationHistory } from "./features/shell/useNavigationHistory";
import { applyCapture } from "./features/capture/durableSave";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { lazyView } from "./features/shell/lazyView";
import {
  api,
  flattenLocations,
  isAuthenticationError,
  isRequestAborted,
  setHeaderSession,
  type AuthStatus,
  type Bootstrap,
  type Category,
  type Dashboard,
  type Item,
  type InventoryQueryOptions,
  type LocationNode,
  type LocationType,
} from "./api";
import { Icon, type IconName } from "./components/Icon";
import { friendlyErrorMessage, isOfflineFailure } from "./domain/errors";
import { resizePhoto } from "./domain/photos";
import { LoginView } from "./features/auth/LoginView";
import { DashboardView } from "./features/dashboard/DashboardView";
import { ExtraView } from "./features/shell/ExtraView";
import { GlobalSearch } from "./features/search/GlobalSearch";
import { rememberRecentItem } from "./features/search/recents";
import type { ThemePreference } from "./features/manage/ManageView";
import type { PlacesSection } from "./features/places/PlacesView";
import { makeOfflineItem } from "./features/capture/offlineItem";
import type { CaptureMode } from "./features/capture/ScanView";
import { type InventoryFilter } from "./features/inventory/formula";
import { useInventoryState } from "./features/inventory/useInventoryState";
import { InventoryView } from "./features/inventory/InventoryView";
import {
  loadPrintQueue,
  loadPrintSettings,
  savePrintQueue,
  savePrintSettings,
  type PrintQueueItem,
  type PrintQueueSettings,
} from "./features/printing/printModel";
import {
  deleteOfflineOperation,
  listOfflineOperations,
  loadOfflineSnapshot,
  type OfflineOperation,
  offlineOperationId,
  putOfflineOperation,
  saveOfflineSnapshot,
  setOfflineOperationError,
} from "./offline";

const ProjectsView = lazyView(() => import("./features/planning/ProjectsView").then((module) => module.ProjectsView));
const CompatibilityView = lazyView(() => import("./features/planning/CompatibilityView").then((module) => module.CompatibilityView));
const TargetDetailView = lazyView(() => import("./features/planning/TargetDetailView").then((module) => module.TargetDetailView));
const ProjectDetailView = lazyView(() => import("./features/planning/ProjectDetailView").then((module) => module.ProjectDetailView));
const AnalyticsView = lazyView(() => import("./features/analytics/AnalyticsView").then((module) => module.AnalyticsView));
const DataView = lazyView(() => import("./features/data-tools/DataView").then((module) => module.DataView));
const ItemDetail = lazyView(() => import("./features/items/ItemDetail").then((module) => module.ItemDetail));
const InventoryManagementView = lazyView(() => import("./features/manage/InventoryManagementView").then((module) => module.InventoryManagementView));
const ManageView = lazyView(() => import("./features/manage/ManageView").then((module) => module.ManageView));
const AIScanInboxView = lazyView(() => import("./features/manage/AIScanInboxView").then((module) => module.AIScanInboxView));
const DefaultRulesView = lazyView(() => import("./features/manage/DefaultRulesView").then((module) => module.DefaultRulesView));
const OffCategoryMappingsView = lazyView(() => import("./features/manage/OffCategoryMappingsView").then((module) => module.OffCategoryMappingsView));
const CategoriesView = lazyView(() => import("./features/places/PlaceTrees").then((module) => module.CategoriesView));
const CategoryDetailView = lazyView(() => import("./features/places/PlacesView").then((module) => module.CategoryDetailView));
const LocationDetailView = lazyView(() => import("./features/places/PlacesView").then((module) => module.LocationDetailView));
const LocationsView = lazyView(() => import("./features/places/PlaceTrees").then((module) => module.LocationsView));
const PlacesView = lazyView(() => import("./features/places/PlacesView").then((module) => module.PlacesView));
const ScanView = lazyView(() => import("./features/capture/ScanView").then((module) => module.ScanView));
const PrintQueueDialog = lazyView(() => import("./features/printing/PrintQueueDialog").then((module) => module.PrintQueueDialog));

type View = "projects" | "project" | "compatibility" | "target" | "inventory" | "capture" | "add" | "scan" | "places" | "locations" | "location" | "categories" | "category" | "default-rules" | "off-category-mappings" | "ai-inbox" | "dashboard" | "extra" | "analytics" | "data" | "inventory-management" | "manage";
type InventorySearchOptions = { showBusy?: boolean };
type AdjustmentQueue = { displayed: Item; pending: number };
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

function viewFromParameter(value: string | null): View | null {
  if (!value) return null;
  const views: Record<string, View> = {
    add: "capture",
    capture: "capture",
    categories: "categories",
    category: "category",
    dashboard: "dashboard",
    "default-rules": "default-rules",
    defaults: "default-rules",
    find: "inventory",
    home: "dashboard",
    inventory: "inventory",
    projects: "projects",
    project: "project",
    compatibility: "compatibility",
    target: "target",
    locations: "locations",
    location: "location",
    "ai-inbox": "ai-inbox",
    manage: "manage",
    more: "extra",
    extra: "extra",
    analytics: "analytics",
    data: "data",
    "inventory-management": "inventory-management",
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
  { id: "extra", label: "Tools", icon: "more" },
];

function App() {
  const [inventoryScope, setInventoryScope] = useState<InventoryQueryOptions>({});
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [matchingTotal, setMatchingTotal] = useState<number | null>(null);
  const [inventoryError, setInventoryError] = useState("");
  // Separate from searchBusy so appending a page keeps the rendered list (and scroll position).
  const [inventoryLoadingMore, setInventoryLoadingMore] = useState(false);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [view, setView] = useState<View>(() => viewFromParameter(new URLSearchParams(location.search).get("view")) || "dashboard");
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
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(() => new URLSearchParams(location.search).get("target"));
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => new URLSearchParams(location.search).get("project"));
  const [captureMode, setCaptureMode] = useState<CaptureMode>("scan");
  const [placesSection, setPlacesSection] = useState<PlacesSection>("locations");
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [printQueue, setPrintQueue] = useState<PrintQueueItem[]>(loadPrintQueue);
  const [printSettings, setPrintSettings] = useState<PrintQueueSettings>(loadPrintSettings);
  const [printQueueOpen, setPrintQueueOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "light";
  });
  const itemsRef = useRef<Item[]>([]);
  const refreshTimer = useRef<number | null>(null);
  const inventoryRefreshTimer = useRef<number | null>(null);
  const refreshController = useRef<AbortController | null>(null);
  const inventoryRefreshController = useRef<AbortController | null>(null);
  const refreshGeneration = useRef(0);
  const inventoryRefreshGeneration = useRef(0);
  const adjustmentQueue = useRef<Map<string, AdjustmentQueue>>(new Map());

  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { if (selectedItem) rememberRecentItem(selectedItem.public_id); }, [selectedItem]);
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
  }, []);
  // Planning detail pages keep their own query parameter so a refresh, a shared
  // link or the browser Back button all resolve to the same record.
  const openPlanningDetail = useCallback((key: "target" | "project", publicId: string) => {
    if (key === "target") setSelectedTargetId(publicId); else setSelectedProjectId(publicId);
    setView(key);
  }, []);
  const openTarget = useCallback((publicId: string) => openPlanningDetail("target", publicId), [openPlanningDetail]);
  const openProject = useCallback((publicId: string) => openPlanningDetail("project", publicId), [openPlanningDetail]);
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
      setInventoryScope((scope) => ({ ...scope }));
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
    if (offlineMode) return;
    const showBusy = options.showBusy ?? false;
    setInventorySearchBusy(true);
    setInventoryError("");
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
      const inventoryRequest = restoreInventoryPage(search, inventoryScope, inventoryIncludeZero, controller.signal);
      const [nextItems, nextDashboard] = await Promise.allSettled([
        inventoryRequest,
        api.dashboard({ signal: controller.signal }),
      ]);
      if (generation !== inventoryRefreshGeneration.current) return;
      if (nextItems.status === "fulfilled") {
        rememberInventoryPage(search, inventoryScope, inventoryIncludeZero, nextItems.value.items.length);
        setItems(nextItems.value.items.map((item) => (
          adjustmentQueue.current.has(item.public_id)
            ? itemsRef.current.find((entry) => entry.public_id === item.public_id) || item
            : item
        )));
        setMatchingTotal(nextItems.value.total);
        setAvailableTags(nextItems.value.available_tags || []);
        setInventoryNextCursor(nextItems.value.next_cursor);
        setInventoryHasMore(nextItems.value.has_more);
      }
      if (nextDashboard.status === "fulfilled") setDashboard(nextDashboard.value);
      const failure = [nextItems, nextDashboard].find((result) => (
        result.status === "rejected" && !isRequestAborted(result.reason)
      ));
      if (failure?.status === "rejected") {
        if (isOfflineFailure(failure.reason)) {
          const cache = await loadOfflineSnapshot().catch(() => null);
          if (cache && generation === inventoryRefreshGeneration.current) {
            applyBootstrap(cache.value); setOfflineMode(true);
            setConnectionIssue(`Offline · ${cache.value.items.length} cached items`);
          }
        }
        setInventoryError(friendlyErrorMessage(failure.reason, "Unable to refresh inventory"));
        notify(friendlyErrorMessage(failure.reason, "Unable to refresh inventory"), {
          label: "Retry",
          action: async () => refreshInventory(search, { showBusy: true }),
        });
      }
    } finally {
      if (inventoryRefreshController.current === controller) inventoryRefreshController.current = null;
      if (generation === inventoryRefreshGeneration.current) {
        setBusy(false);
        setInventorySearchBusy(false);
      }
    }
  }, [inventoryIncludeZero, inventoryScope, notify, offlineMode, query]);

  const loadMoreInventory = useCallback(async () => {
    if (!inventoryNextCursor || inventorySearchBusy || inventoryLoadingMore) return;
    const generation = inventoryRefreshGeneration.current;
    setInventoryLoadingMore(true);
    try {
      const page = await api.inventoryQuery(query, inventoryScope, inventoryIncludeZero, inventoryNextCursor);
      if (generation !== inventoryRefreshGeneration.current) return;
      rememberInventoryPage(query, inventoryScope, inventoryIncludeZero, itemsRef.current.length + page.items.filter((item) => !itemsRef.current.some((known) => known.public_id === item.public_id)).length);
      setMatchingTotal(page.total);
      setInventoryError("");
      setItems((current) => {
        const seen = new Set(current.map((item) => item.public_id));
        return [...current, ...page.items.filter((item) => !seen.has(item.public_id))];
      });
      setInventoryNextCursor(page.next_cursor);
      setInventoryHasMore(page.has_more);
    } catch (error) {
      if (generation === inventoryRefreshGeneration.current) setInventoryError(friendlyErrorMessage(error, "Could not load more items. Try again."));
    } finally {
      setInventoryLoadingMore(false);
    }
  }, [inventoryIncludeZero, inventoryLoadingMore, inventoryScope, inventoryNextCursor, inventorySearchBusy, query]);

  const searchInventory = useCallback((value: string, options: InventorySearchOptions = {}) => {
    void refreshInventory(value, { showBusy: options.showBusy ?? true });
  }, [refreshInventory]);

  useEffect(() => {
    if (auth?.authenticated && view === "inventory") void refreshInventory(query);
  }, [auth?.authenticated, inventoryScope, inventoryIncludeZero, view]);

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
  }, [applyBootstrap, notify]); // Initial metadata load; inventory scope has its own request.

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


  useNavigationHistory({ view, item: selectedItem?.public_id || null,
    location: view === "location" || (view === "places" && placesSection === "locations") ? selectedLocationId : null,
    category: view === "category" || (view === "places" && placesSection === "categories") ? selectedCategoryId : null,
    section: view === "places" ? placesSection : null, project: view === "project" ? selectedProjectId : null,
    target: view === "target" ? selectedTargetId : null, mode: captureMode }, (route, nextItem) => {
    setView(viewFromParameter(route.view) || (route.location ? "location" : "dashboard"));
    setSelectedItem(nextItem || itemsRef.current.find((entry) => entry.public_id === route.item) || null);
    setSelectedLocationId(route.location); setSelectedCategoryId(route.category);
    setPlacesSection(route.section === "categories" ? "categories" : "locations");
    if (route.location && route.mode === "add") { setAddLocation(route.location); setCaptureMode("quick"); setView("capture"); }
    if (["scan", "quick", "putaway", "consume", "assistant"].includes(route.mode)) setCaptureMode(route.mode as CaptureMode);
    const params = new URLSearchParams(window.location.search);
    setSelectedTargetId(route.target); setSelectedProjectId(route.project);
    if (route.view === "projects" && route.project) setView("project");
    setQuery(params.get("q") || ""); setInventoryIncludeZero(params.get("zero") === "1");
    setInventoryFilter((params.get("filter") || "all") as InventoryFilter);
    setInventoryCategoryId(params.has("category_id") ? Number(params.get("category_id")) : null);
    setInventoryTag(params.get("tag") || "");
  }, Boolean(auth?.authenticated));

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

  async function quickAdjust(item: Item, delta: number) {
    const queue = adjustmentQueue.current.get(item.public_id) || {
      displayed: itemsRef.current.find((entry) => entry.public_id === item.public_id) || item, pending: 0,
    };
    if (delta < 0 && Number(queue.displayed.quantity) + delta < 0) return;
    queue.pending += 1;
    queue.displayed = optimisticQuantity(queue.displayed, delta);
    adjustmentQueue.current.set(item.public_id, queue);
    applyLocalItem(queue.displayed);
    setPendingItems((current) => new Set(current).add(item.public_id));
    let operation: Awaited<ReturnType<typeof persistQuantityChange>> | undefined;
    try {
      operation = await persistQuantityChange(item, delta);
      const updated = await applyQuantityOperation(operation);
      if (queue.pending === 1) {
        applyLocalItem(updated);
        notify(`${updated.name}: quantity updated`, { label: "Undo", action: async () => quickAdjust(updated, -delta) });
      }
    } catch (error) {
      if (operation) {
        await setOfflineOperationError(operation.id, "Not yet confirmed. Synchronize to retry safely.").catch(() => undefined);
        notify(`${item.name}: change saved on this device · waiting to sync`);
      } else {
        queue.displayed = optimisticQuantity(queue.displayed, -delta);
        applyLocalItem(queue.displayed);
        notify("Could not save this quantity change on your device. Please try again.");
      }
    } finally {
      queue.pending -= 1;
      const remaining = await listOfflineOperations().catch(() => null);
      if (remaining) setOfflineOperations(remaining);
      if (!queue.pending) {
        adjustmentQueue.current.delete(item.public_id);
        if (remaining && !remaining.some((entry) => entry.kind === "adjust_quantity" && entry.payload.item_public_id === item.public_id)) {
          setPendingItems((current) => { const next = new Set(current); next.delete(item.public_id); return next; });
          scheduleInventoryRefresh();
        }
      }
    }
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

  async function createScannedItem(body: Record<string, unknown>, imageUrl?: string, photoFile?: File) {
    setBusy(true);
    try {
      const resized = photoFile ? await resizePhoto(photoFile) : null;
      const operation: Extract<OfflineOperation, { kind: "create_item" }> = {
        id: offlineOperationId(), kind: "create_item", createdAt: new Date().toISOString(), payload: body,
        imageUrl, photo: resized?.blob, photoWidth: resized?.width, photoHeight: resized?.height,
      };
      await putOfflineOperation(operation);
      let item: Item;
      try {
        item = await applyCapture(operation);
        notify(`${item.name} added`);
      } catch (error) {
        if (!isOfflineFailure(error) && !operation.item) {
          await setOfflineOperationError(operation.id, friendlyErrorMessage(error, "Save needs attention"));
          setOfflineOperations(await listOfflineOperations());
          throw error;
        }
        item = operation.item || makeOfflineItem(body, operation.id, locations, categories, Boolean(photoFile));
        await setOfflineOperationError(operation.id, operation.item ? "Item saved; photo pending. Retry synchronization." : "Waiting to reconnect");
        notify(operation.item ? `${item.name} saved · photo pending` : `${item.name} saved offline`);
      }
      setItems((current) => [item, ...current.filter((entry) => entry.public_id !== item.public_id)]);
      setOfflineOperations(await listOfflineOperations());
      if (!item.public_id.startsWith("offline:")) scheduleInventoryRefresh();
      return item;
    } catch (error) {
      notify(friendlyErrorMessage(error, "Could not save item"));
      throw error;
    } finally { setBusy(false); }
  }

  async function syncOfflineQueue() {
    if (!navigator.onLine || syncingOffline) return;
    setSyncingOffline(true);
    try {
      const queued = await listOfflineOperations().catch(() => []);
      let synced = 0;
      for (const operation of queued) {
        try {
          const item = operation.kind === "create_item"
            ? await applyCapture(operation)
            : await applyQuantityOperation(operation);
          if (operation.kind === "create_item") {
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
    const wantsZero = true;
    setInventoryFilter(filter);
    setInventoryCategoryId(null);
    setInventoryTag("");
    setQuery("");
    setSelectedItem(null);
    if (wantsZero !== inventoryIncludeZero) {
      setInventoryIncludeZero(wantsZero);

    }
    navigate("inventory");
  }

  async function signIn(username: string, password: string) {
    const signedIn = await api.login(username, password);
    let snapshot: Bootstrap;
    try {
      snapshot = await api.bootstrap("", undefined, inventoryIncludeZero);
    } catch (error) {
      // The password was accepted but the next request arrived without the
      // cookie: this tab is framed by another site, which drops it. Carry the
      // session as a header for this tab instead of failing the sign-in.
      if (!isAuthenticationError(error) || !signedIn.session_token) throw error;
      setHeaderSession(signedIn.session_token);
      snapshot = await api.bootstrap("", undefined, inventoryIncludeZero);
    }
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
        : view === "projects" || view === "project" || view === "compatibility" || view === "target" || view === "manage" || view === "analytics" || view === "data" || view === "inventory-management"
          ? "extra"
          : view;
  return (
    <div className="app-shell">
      {busy && <div className="activity-banner" role="status" aria-live="polite"><span className="activity-spinner" aria-hidden="true" /><strong>{activityMessage || "Saving changes…"}</strong></div>}
      <AutoOfflineInventory enabled={!offlineMode} />
      {(offlineMode || offlineOperations.length > 0) && <div className={`offline-sync-banner ${offlineMode ? "offline" : ""}`} role="status"><span><Icon name={offlineMode ? "more" : "check"} size={17} /><strong>{offlineMode ? "Offline capture" : `${offlineOperations.length} saved change${offlineOperations.length === 1 ? "" : "s"}`}</strong><small>{offlineMode ? `${offlineOperations.length} waiting to sync` : offlineOperations.some((operation) => operation.error) ? "Some changes need attention" : "Ready to synchronize"}</small></span><button type="button" disabled={offlineMode || syncingOffline} onClick={() => void syncOfflineQueue()}>{syncingOffline ? "Syncing…" : "Sync now"}</button></div>}

      {notice && <div className={`toast ${retryNotice?.message === notice ? "has-action" : ""}`} role="status"><span className="toast-check"><Icon name="spark" size={16} /></span><p>{notice}</p>{retryNotice?.message === notice && <button className="toast-action" onClick={() => { const pendingAction = retryNotice; setRetryNotice(null); notify(`${pendingAction.label} in progress…`); void pendingAction.action().catch((error) => notify(friendlyErrorMessage(error, `${pendingAction.label} failed`))); }}>{retryNotice.label}</button>}<button onClick={() => { setNotice(""); setRetryNotice(null); }} aria-label="Dismiss message"><Icon name="close" size={16} /></button></div>}

      <main className="page-content">
        <ErrorBoundary resetKey={view}><Suspense fallback={<div className="feature-loading" role="status"><span className="activity-spinner" />Loading…</div>}>
        {view === "inventory" && (
          <div className={`inventory-desktop-layout ${selectedItem ? "has-detail" : ""}`}>
          <InventoryView
            availableTags={availableTags} availableUnits={units} onScopeChange={setInventoryScope} matchingTotal={matchingTotal} error={inventoryError} offline={offlineMode}
            lowTotalCount={dashboard?.low_stock_count || 0} expiringTotalCount={dashboard?.expiring_count || 0}
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
            isLoadingMore={inventoryLoadingMore}
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
            onOpenCategory={(id) => { setSelectedCategoryId(id); setSelectedItem(null); navigate("category"); }}
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
            selectedCategoryId={selectedCategoryId}
            busy={busy}
            onSelectLocation={setSelectedLocationId}
            onSelectCategory={setSelectedCategoryId}
            onQueuePrint={addLocationToPrintQueue}
            onOpenItem={setSelectedItem}
            onCaptureHere={(id, mode = "quick") => openCapture(mode, id)}
            onCreateLocation={(body) => run(() => api.createLocation(body), "Place created", "all")}
            onUpdateLocation={(id, body) => run(() => api.updateLocation(id, body), "Place updated", "all")}
            onDeleteLocation={(id) => run(() => api.deleteLocation(id), "Place deleted", "all")}
            onDeleteLocationTree={(id) => run(() => api.deleteLocationTree(id), "Place group deleted", "all")}
            onCreateType={(name) => run(() => api.createLocationType(name), "Place type added", "all")}
            onInventoryCategory={(id) => { setInventoryCategoryId(id); setInventoryFilter("all"); navigate("inventory"); }}
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
        {view === "dashboard" && <DashboardView dashboard={dashboard} detailsCount={dashboard?.needs_details_count ?? items.filter(itemNeedsDetails).length} connectionIssue={connectionIssue} onRetry={() => void refresh("", { showBusy: true })} onCapture={openCapture} onGlobalSearch={() => setGlobalSearchOpen(true)} onInventory={(filter) => { setInventoryFilter(filter); setInventoryCategoryId(null); navigate("inventory"); }} onNotice={setNotice} ><HomeExtras locations={locations} empty={dashboard?.item_count === 0} onItem={setSelectedItem} onPlace={(id) => { setSelectedLocationId(id); navigate("location"); }} onInbox={() => navigate("ai-inbox")} onManage={() => navigate("inventory-management")} onCreatePlace={() => navigate("places")} onCapture={() => openCapture("quick")} onPrint={() => setPrintQueueOpen(true)} /></DashboardView>}
        {view === "projects" && <ProjectsView onBack={() => navigate("extra")} onOpenProject={openProject} />}
        {view === "compatibility" && <CompatibilityView categories={categories} onBack={() => navigate("extra")} onOpenTarget={openTarget} />}
        {view === "target" && selectedTargetId && <TargetDetailView targetId={selectedTargetId} categories={categories} onBack={() => navigate("compatibility")} onOpenItem={setSelectedItem} onOpenTarget={openTarget} onOpenProject={openProject} />}
        {view === "project" && selectedProjectId && <ProjectDetailView projectId={selectedProjectId} categories={categories} locations={locations} onBack={() => navigate("projects")} onOpenItem={setSelectedItem} />}
        {view === "extra" && <ExtraView printQueueCount={printQueue.length} onPrintQueue={() => setPrintQueueOpen(true)} onProjects={() => navigate("projects")} onCompatibility={() => navigate("compatibility")} offlineOperations={offlineOperations} offlineMode={offlineMode} syncing={syncingOffline} onAnalytics={() => navigate("analytics")} onData={() => navigate("data")} onInventoryManagement={() => navigate("inventory-management")} onSettings={() => navigate("manage")} onSync={() => syncOfflineQueue()} onDiscard={async (id) => { await deleteOfflineOperation(id); setOfflineOperations(await listOfflineOperations()); if (navigator.onLine) await refresh("", { showBusy: false }); }} />}
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
        {view === "data" && <DataView categories={categories} locations={locations} locationTypes={locationTypes} units={units} busy={busy} offline={offlineMode} onBack={() => navigate("extra")} onChanged={() => refresh()} setNotice={setNotice} />}
        {view === "inventory-management" && <InventoryManagementView items={items} categories={categories} busy={busy} onBack={() => navigate("extra")} onChanged={() => refresh()} onOpenItem={setSelectedItem} onMarkFound={(item) => setItemLost(item, false)} onForeverLost={foreverLost} setNotice={setNotice} />}
        {view === "manage" && (
          <ManageView items={items} dashboard={dashboard} locations={locations} categories={categories} locationTypes={locationTypes} units={units} busy={busy} theme={theme} setNotice={setNotice} notify={notify} onBack={() => navigate("extra")} onThemeChange={setTheme} onInventoryChanged={() => refresh()} onLocations={() => { setPlacesSection("locations"); navigate("places"); }} onCategories={() => { setPlacesSection("categories"); navigate("places"); }} onDefaultRules={() => navigate("default-rules")} onOffCategoryMappings={() => navigate("off-category-mappings")} onInbox={() => navigate("ai-inbox")} onUnitsChanged={setUnits} />
        )}
        {selectedItem && view !== "inventory" && (
          <ItemDetail
            key={selectedItem.public_id}
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
            onOpenCategory={(id) => { setSelectedCategoryId(id); setSelectedItem(null); navigate("category"); }}
            onOpenTag={(tag) => { setInventoryTag(tag); setInventoryCategoryId(null); setInventoryFilter("all"); setQuery(""); searchInventory("", { showBusy: false }); setSelectedItem(null); navigate("inventory"); }}
            run={run}
          />
        )}
        {globalSearchOpen && <GlobalSearch onOpenProject={(id) => { setGlobalSearchOpen(false); openProject(id); }} items={items} locations={locations} categories={categories} onClose={() => setGlobalSearchOpen(false)} onOpenItem={(item) => { setGlobalSearchOpen(false); setSelectedItem(item); }} onOpenLocation={(id) => { setGlobalSearchOpen(false); setSelectedLocationId(id); setPlacesSection("locations"); navigate("places"); }} onOpenCategory={(id) => { setGlobalSearchOpen(false); setSelectedCategoryId(id); navigate("category"); }} onNavigate={(next) => { setGlobalSearchOpen(false); navigate(next); }} onCapture={(mode) => { setGlobalSearchOpen(false); openCapture(mode); }} />}
        {printQueueOpen && <PrintQueueDialog
          queue={printQueue}
          settings={printSettings}
          onChangeQueue={setPrintQueue}
          onChangeSettings={setPrintSettings}
          onClose={() => setPrintQueueOpen(false)}
          onNotice={notify}
        />}
        </Suspense></ErrorBoundary>
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        {/* Only shown once the nav becomes a side rail on wide screens. */}
        <p className="rail-brand" aria-hidden="true"><span className="brand-mark">F</span><span>Findstuff</span></p>
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

export default App;
