import { type ReactNode, useEffect, useMemo, useState } from "react";
import { api, isRequestAborted, flattenLocations, type Category, type Item, type LocationNode, type Project, type HumanSearchResult } from "../../api";
import { EmptyState } from "../../components/EmptyState";
import { Icon, type IconName } from "../../components/Icon";
import { categoryLabel } from "../../domain/inventory";
import type { CaptureMode } from "../capture/ScanView";

type GlobalDestination = "projects" | "inventory" | "capture" | "places" | "category" | "manage";

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
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  useEffect(() => { api.projects().then(setProjects).catch(() => undefined); }, []);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", close); };
  }, [onClose]);
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
  const matches = (values: Array<string | null | undefined>) => !term || values.filter(Boolean).join(" ").toLocaleLowerCase().includes(term);
  const itemResults = result?.items || (offline || !query.trim() ? items.filter((item) => matches([item.name, item.brand, item.model, item.barcode, item.location_path, categoryLabel(item), ...item.tags])).slice(0, 8) : []);
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
  return <div className="global-search-backdrop" role="dialog" aria-modal="true" aria-label="Search Findstuff" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="global-search-sheet"><header><Icon name="search" size={22} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Items, locations, categories, projects, commands…" aria-label="Search all of Findstuff" /><kbd>Esc</kbd><button className="icon-button" onClick={onClose} aria-label="Close search"><Icon name="close" size={17} /></button></header><div className="global-search-results">{loading && <p role="status">Searching…</p>}{error && <p role="alert">{error} <button onClick={() => setRetry((value) => value + 1)}>Retry</button></p>}{offline && <p>Offline · searching {items.length} cached items only.</p>}{result && <p role="status">{result.total} matching items{result.matched_by.length ? ` · ${result.matched_by.join(", ")}` : ""}</p>}{itemResults.length > 0 && <SearchGroup title="Items">{itemResults.map((item) => <button key={item.public_id} onClick={() => onOpenItem(item)}><Icon name="box" size={17} /><span><strong>{item.name}</strong><small>{item.location_path} · {item.quantity} {item.unit}</small></span></button>)}</SearchGroup>}{result?.has_more && <button disabled={loading} onClick={() => void loadMore()}>Load more items</button>}{locationResults.length > 0 && <SearchGroup title="Locations">{locationResults.map((location) => <button key={location.public_id} onClick={() => onOpenLocation(location.public_id)}><Icon name="pin" size={17} /><span><strong>{location.name}</strong><small>{location.path} · {location.total_item_count} items</small></span></button>)}</SearchGroup>}{categoryResults.length > 0 && <SearchGroup title="Categories">{categoryResults.map((category) => <button key={category.id} onClick={() => onOpenCategory(category.id)}><Icon name="tag" size={17} /><span><strong>{category.name}</strong><small>{category.path} · {category.total_item_count} items</small></span></button>)}</SearchGroup>}{projectResults.length > 0 && <SearchGroup title="Projects">{projectResults.map((project) => <button key={project.public_id} onClick={() => onNavigate("projects")}><Icon name="spark" size={17} /><span><strong>{project.name}</strong><small>{project.status} · {project.reservations.length} reservations</small></span></button>)}</SearchGroup>}{commands.length > 0 && <SearchGroup title="Commands">{commands.map((command) => <button key={command.label} onClick={command.run}><Icon name={command.icon} size={17} /><span><strong>{command.label}</strong><small>{command.detail}</small></span></button>)}</SearchGroup>}{term && !loading && !error && !itemResults.length && !locationResults.length && !categoryResults.length && !projectResults.length && !commands.length && <EmptyState icon="search" title="Nothing found" text="Try a shorter name, barcode, place, category, project, or command." />}</div></section></div>;
}

function SearchGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="global-search-group"><h2>{title}</h2><div>{children}</div></section>;
}
