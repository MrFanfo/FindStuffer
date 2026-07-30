import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  api,
  flattenLocations,
  type ApplicationSettings,
  type Category,
  type CategoryContents,
  type Item,
  type LocationContents,
  type LocationNode,
  type LocationRule,
  type LocationType,
} from "../../api";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { categoryLabel, categoryOptionLabel } from "../../domain/inventory";
import type { CaptureMode } from "../capture/ScanView";
import { LocationsView, CategoriesView } from "./PlaceTrees";
import { AIScanSession, QuickPhotoSession } from "./PlaceCaptureSessions";

export type PlacesSection = "locations" | "categories";
type DetailItemSort = "name" | "quantity-asc" | "quantity-desc" | "location" | "category";
type DetailItemView = "grid" | "list";
export function PlacesView({ section, onSectionChange, locations, categories, locationTypes, selectedLocationId, busy, printQueueCount, onSelectLocation, onOpenPrintQueue, onQueuePrint, onOpenItem, onCaptureHere, onCreateLocation, onUpdateLocation, onDeleteLocation, onDeleteLocationTree, onCreateType, onOpenCategory, onCreateCategory, onUpdateCategory, onDeleteCategory, onDeleteCategoryTree, onSaveCapabilities, onSetDefaultLocation, onDefaultsChanged }: {
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

export function CategoryDetailView({ categoryId, categories, busy, onOpenItem, onOpenCategory, onInventory, onCreateCategoryHere, onBack }: {
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

export function LocationDetailView({ locationId, locations, categories, locationTypes, busy, onQueuePrint, onOpenItem, onOpenLocation, onAddHere, onCreateLocationHere, onDefaultsChanged, onBack }: {
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

export function findLocationChain(path: string, flatLocations: LocationNode[]): LocationNode[] {
  const parts = path.split(">").map((part) => part.trim()).filter(Boolean);
  const chain: LocationNode[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const partial = parts.slice(0, index + 1).join(" > ");
    const match = flatLocations.find((location) => location.path === partial);
    if (match) chain.push(match);
  }
  return chain;
}

export function LocationCrumbs({ chain, fallback, onOpen, compact = false }: {
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
