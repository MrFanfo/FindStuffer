import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  api,
  flattenLocations,
  type ApplicationSettings,
  type Category,
  type CategoryCapabilities,
  type CategoryContents,
  type Item,
  type LocationContents,
  type LocationNode,
  type LocationRule,
  type LocationType,
} from "../../api";
import { EmptyState } from "../../components/EmptyState";
import { HierarchyPicker, locationPickerNodes } from "../../components/HierarchyPicker";
import { Icon } from "../../components/Icon";
import type { CaptureMode } from "../capture/ScanView";
import { uid } from "../inventory/formula";

export type PlacesSection = "locations" | "categories";
type DetailItemSort = "name" | "quantity-asc" | "quantity-desc" | "location" | "category";
type DetailItemView = "grid" | "list";
type CategoryNode = Category & { children: CategoryNode[] };

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

function categoryOptionLabel(category: Category): string {
  return category.path || category.name;
}

function categoryLabel(item: Item): string {
  return item.category_path || item.category_name || "";
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
      if (category.parent_id !== null && result.has(category.parent_id) && !result.has(category.id)) {
        result.add(category.id);
        changed = true;
      }
    }
  }
  return result;
}

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

export function LocationsView({ locations, locationTypes, onCreate, onUpdate, onDelete, onDeleteTree, onCreateType, onOpen, onQueuePrint, busy }: {
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

export function CategoriesView({ categories, locations, busy, onOpen, onCreate, onUpdate, onDelete, onDeleteTree, onSaveCapabilities, onSetDefaultLocation }: {
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

export async function resizePhoto(file: File): Promise<{ blob: Blob; width?: number; height?: number }> {
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
