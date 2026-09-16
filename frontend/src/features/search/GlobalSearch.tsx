import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isRequestAborted, flattenLocations, type Category, type Item, type LocationNode, type Project, type HumanSearchResult } from "../../api";
import { EmptyState } from "../../components/EmptyState";
import { Icon, type IconName } from "../../components/Icon";
import { categoryLabel } from "../../domain/inventory";
import { loadRecentItemIds } from "./recents";
import type { CaptureMode } from "../capture/ScanView";

type GlobalDestination = "projects" | "inventory" | "capture" | "places" | "category" | "manage";
type PaletteEntry = { key: string; icon: IconName; title: string; detail: string; run: () => void };
type PaletteGroup = { title: string; entries: PaletteEntry[] };

export function GlobalSearch({ items, locations, categories, onClose, onOpenItem, onOpenLocation, onOpenCategory, onNavigate, onCapture }: {
  items: Item[];
  locations: LocationNode[];
  categories: Category[];
  onClose: () => void;
  onOpenItem: (item: Item) => void;
  onOpenLocation: (id: string) => void;
  onOpenCategory: (id: number) => void;
  onNavigate: (view: GlobalDestination) => void;
  onCapture: (mode: CaptureMode) => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<HumanSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  useEffect(() => { api.projects().then(setProjects).catch(() => undefined); }, []);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setError("");
    if (!query.trim()) { setLoading(false); return; }
    if (!navigator.onLine) { setOffline(true); setLoading(false); return; }
    setLoading(true);
    const timer = window.setTimeout(() => {
      void api.humanSearch(query.trim(), false, null, { signal: controller.signal })
        .then((next) => { if (!controller.signal.aborted) { setResult(next); setOffline(false); } })
        .catch((failure: unknown) => { if (!isRequestAborted(failure) && !controller.signal.aborted) setError("Search is unavailable. Reconnect and retry."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, retry]);
  async function loadMore() {
    if (!result?.next_cursor) return;
    const search = query;
    setLoading(true);
    try {
      const page = await api.humanSearch(search, false, result.next_cursor);
      setResult((current) => current?.query === page.query ? { ...page, items: [...current.items, ...page.items] } : current);
    } catch { setError("Could not load more results. Try again."); }
    finally { setLoading(false); }
  }
  const term = query.trim().toLocaleLowerCase();
  const matches = useCallback(
    (values: Array<string | null | undefined>) => !term || values.filter(Boolean).join(" ").toLocaleLowerCase().includes(term),
    [term],
  );
  const itemResults = result?.items || (offline || !query.trim() ? items.filter((item) => matches([item.name, item.brand, item.model, item.barcode, item.location_path, categoryLabel(item), ...item.tags])).slice(0, 8) : []);
  const locationResults = flatLocations.filter((location) => matches([location.name, location.path, location.kind])).slice(0, 6);
  const categoryResults = categories.filter((category) => matches([category.name, category.path])).slice(0, 6);
  const projectResults = projects.filter((project) => matches([project.name, project.description, project.status])).slice(0, 5);
  const allCommands: Array<{ label: string; detail: string; icon: IconName; run: () => void }> = [
    { label: "Capture an item", detail: "Type or take a photo", icon: "plus", run: () => onCapture("quick") },
    { label: "Scan a barcode", detail: "Open the camera", icon: "scan", run: () => onCapture("scan") },
    { label: "Put items away", detail: "Scan into one destination", icon: "pin", run: () => onCapture("putaway") },
    { label: "Use up an item", detail: "Reduce quantity by scanning", icon: "minus", run: () => onCapture("consume") },
    { label: "Open inventory", detail: "Search and filter all items", icon: "search", run: () => onNavigate("inventory") },
    { label: "Open settings", detail: "Manage Findstuff", icon: "settings", run: () => onNavigate("manage") },
  ];
  const commands = allCommands.filter((command) => matches([command.label, command.detail]));
  // Opened empty, the palette shows where you have been instead of everything you own.
  const recentItems = useMemo(() => {
    if (term) return [];
    const byId = new Map(items.map((item) => [item.public_id, item]));
    return loadRecentItemIds().map((id) => byId.get(id)).filter((item): item is Item => Boolean(item)).slice(0, 5);
  }, [items, term]);
  const recentIds = new Set(recentItems.map((item) => item.public_id));
  const itemEntry = (item: Item): PaletteEntry => ({
    key: `item-${item.public_id}`, icon: "box", title: item.name,
    detail: `${item.location_path} · ${item.quantity} ${item.unit}`, run: () => onOpenItem(item),
  });
  const groups: PaletteGroup[] = [
    { title: "Recent", entries: recentItems.map(itemEntry) },
    { title: "Items", entries: itemResults.filter((item) => !recentIds.has(item.public_id)).map(itemEntry) },
    { title: "Places", entries: locationResults.map((location) => ({
      key: `loc-${location.public_id}`, icon: "pin" as IconName, title: location.name,
      detail: `${location.path} · ${location.total_item_count} items`, run: () => onOpenLocation(location.public_id),
    })) },
    { title: "Categories", entries: categoryResults.map((category) => ({
      key: `cat-${category.id}`, icon: "tag" as IconName, title: category.name,
      detail: `${category.path} · ${category.total_item_count} items`, run: () => onOpenCategory(category.id),
    })) },
    { title: "Projects", entries: projectResults.map((project) => ({
      key: `prj-${project.public_id}`, icon: "spark" as IconName, title: project.name,
      detail: `${project.status} · ${project.reservations.length} reservations`, run: () => onNavigate("projects"),
    })) },
    { title: "Commands", entries: commands.map((command) => ({
      key: `cmd-${command.label}`, icon: command.icon, title: command.label, detail: command.detail, run: command.run,
    })) },
  ].filter((group) => group.entries.length > 0);
  const flatEntries = groups.flatMap((group) => group.entries);
  const activeIndex = flatEntries.length === 0 ? -1 : Math.min(active, flatEntries.length - 1);
  const activeKey = flatEntries[activeIndex]?.key;
  function onKeyDown(event: ReactKeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey && flatEntries.length > 0)) {
      event.preventDefault();
      setActive((current) => (Math.min(current, flatEntries.length - 1) + 1) % Math.max(flatEntries.length, 1));
      return;
    }
    if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey && flatEntries.length > 0)) {
      event.preventDefault();
      setActive((current) => (Math.min(current, flatEntries.length - 1) + flatEntries.length - 1) % Math.max(flatEntries.length, 1));
      return;
    }
    if (event.key === "Home") { event.preventDefault(); setActive(0); return; }
    if (event.key === "End") { event.preventDefault(); setActive(Math.max(flatEntries.length - 1, 0)); return; }
    if (event.key === "Enter" && activeIndex >= 0) { event.preventDefault(); flatEntries[activeIndex].run(); }
  }
  useEffect(() => {
    if (!activeKey) return;
    resultsRef.current?.querySelector(`#palette-${CSS.escape(activeKey)}`)?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);
  return <div className="global-search-backdrop" role="dialog" aria-modal="true" aria-label="Search Findstuff" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="global-search-sheet">
      <header>
        <Icon name="search" size={22} />
        <input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={onKeyDown}
          placeholder="Items, places, categories, projects, commands…" aria-label="Search all of Findstuff"
          role="combobox" aria-expanded={flatEntries.length > 0} aria-controls="global-search-results"
          aria-activedescendant={activeKey ? `palette-${activeKey}` : undefined} autoComplete="off" />
        <button className="icon-button" onClick={onClose} aria-label="Close search"><Icon name="close" size={17} /></button>
      </header>
      <div className="global-search-results" id="global-search-results" role="listbox" aria-label="Results" ref={resultsRef}>
        {loading && <p role="status">Searching…</p>}
        {error && <p role="alert">{error} <button onClick={() => setRetry((value) => value + 1)}>Retry</button></p>}
        {offline && <p>Offline · searching {items.length} cached items only.</p>}
        {result && <p role="status">{result.total} matching items{result.matched_by.length ? ` · ${result.matched_by.join(", ")}` : ""}</p>}
        {groups.map((group) => <SearchGroup title={group.title} key={group.title}>
          {group.entries.map((entry) => <button key={entry.key} id={`palette-${entry.key}`} role="option"
            aria-selected={entry.key === activeKey} className={entry.key === activeKey ? "palette-active" : ""}
            onMouseEnter={() => setActive(flatEntries.findIndex((candidate) => candidate.key === entry.key))}
            onClick={entry.run}>
            <Icon name={entry.icon} size={17} /><span><strong>{entry.title}</strong><small>{entry.detail}</small></span>
          </button>)}
        </SearchGroup>)}
        {result?.has_more && <button disabled={loading} onClick={() => void loadMore()}>Load more items</button>}
        {term && !loading && !error && flatEntries.length === 0 && <EmptyState icon="search" title="Nothing found" text="Try a shorter name, barcode, place, category, project, or command." />}
      </div>
      <footer className="global-search-hint"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>⏎</kbd> open</span><span><kbd>Esc</kbd> close</span></footer>
    </section>
  </div>;
}

function SearchGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="global-search-group"><h2>{title}</h2><div>{children}</div></section>;
}
