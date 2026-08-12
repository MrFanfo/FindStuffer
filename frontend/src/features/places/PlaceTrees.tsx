import { type CSSProperties, type FormEvent, useEffect, useMemo, useState } from "react";
import {
  flattenLocations,
  type ApplicationSettings,
  type Category,
  type CategoryCapabilities,
  type LocationNode,
  type LocationType,
} from "../../api";
import { Icon } from "../../components/Icon";
import { EmptyState } from "../../components/EmptyState";
import { HierarchyPicker, locationPickerNodes } from "../../components/HierarchyPicker";
import { categoryOptionLabel } from "../../domain/inventory";

type CategoryNode = Category & { children: CategoryNode[] };
const CATEGORY_DATA_FIELD_LABELS: Record<keyof Omit<CategoryCapabilities, "override" | "inherited_from" | "inherited_label">, string> = {
  fullness: "Fullness slider",
  expiration: "Expiration", batches: "Batches", maintenance: "Maintenance",
  reservation: "Reservations", enrichment: "Enrichment", photos: "Photos",
  identity: "Identity", specs: "Specs", price: "Prices", links: "Links",
  shopping_list: "Shopping list",
};
function buildCategoryTree(categories: Category[]): CategoryNode[] {
  const nodes = new Map<number, CategoryNode>(categories.map((category) => [category.id, { ...category, children: [] }]));
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id === null ? null : nodes.get(node.parent_id);
    if (parent) parent.children.push(node); else roots.push(node);
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
        result.add(category.id); changed = true;
      }
    }
  }
  return result;
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
