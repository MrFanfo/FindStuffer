import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  flattenLocations,
  isAuthenticationError,
  isRequestAborted,
  type AuthStatus,
  type Bootstrap,
  type Category,
  type Dashboard,
  type Item,
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

const AnalyticsView = lazy(() => import("./features/analytics/AnalyticsView").then((module) => ({ default: module.AnalyticsView })));
const ItemDetail = lazy(() => import("./features/items/ItemDetail").then((module) => ({ default: module.ItemDetail })));
const ManageView = lazy(() => import("./features/manage/ManageView").then((module) => ({ default: module.ManageView })));
const AIScanInboxView = lazy(() => import("./features/manage/AIScanInboxView").then((module) => ({ default: module.AIScanInboxView })));
const DefaultRulesView = lazy(() => import("./features/manage/DefaultRulesView").then((module) => ({ default: module.DefaultRulesView })));
const OffCategoryMappingsView = lazy(() => import("./features/manage/OffCategoryMappingsView").then((module) => ({ default: module.OffCategoryMappingsView })));
const CategoriesView = lazy(() => import("./features/places/PlaceTrees").then((module) => ({ default: module.CategoriesView })));
const CategoryDetailView = lazy(() => import("./features/places/PlacesView").then((module) => ({ default: module.CategoryDetailView })));
const LocationDetailView = lazy(() => import("./features/places/PlacesView").then((module) => ({ default: module.LocationDetailView })));
const LocationsView = lazy(() => import("./features/places/PlaceTrees").then((module) => ({ default: module.LocationsView })));
const PlacesView = lazy(() => import("./features/places/PlacesView").then((module) => ({ default: module.PlacesView })));
const ScanView = lazy(() => import("./features/capture/ScanView").then((module) => ({ default: module.ScanView })));
const PrintQueueDialog = lazy(() => import("./features/printing/PrintQueueDialog").then((module) => ({ default: module.PrintQueueDialog })));

type View = "inventory" | "capture" | "add" | "scan" | "places" | "locations" | "location" | "categories" | "category" | "default-rules" | "off-category-mappings" | "ai-inbox" | "dashboard" | "extra" | "analytics" | "manage";
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
        <Suspense fallback={<div className="feature-loading" role="status"><span className="activity-spinner" />Loading…</div>}>
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
        </Suspense>
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

export default App;
