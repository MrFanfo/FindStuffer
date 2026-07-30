import JsBarcode from "jsbarcode";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  flattenLocations,
  type Category,
  type FullOffProduct,
  type Enrichment,
  type HistoryEvent,
  type Item,
  type ItemDocument,
  type ItemLot,
  type ItemReservation,
  type LocationNode,
  type LocationRule,
  type MaintenanceTask,
  type Photo,
  type Project,
  type RelatedItem,
} from "../../api";
import { DocumentSection } from "../../components/DocumentSection";
import { HierarchyPicker, categoryPickerNodes, locationPickerNodes } from "../../components/HierarchyPicker";
import { Icon } from "../../components/Icon";
import { activityLabel, capabilitiesForCategory, categoryLabel, categoryOptionLabel, expirationState, parseLinkText } from "../../domain/inventory";
import { resizePhoto } from "../../domain/photos";
import { findLocationChain, LocationCrumbs } from "../places/PlacesView";

type RefreshScope = "all" | "inventory" | "none";
type ActionOptions = { progress?: string; undo?: () => Promise<void> };

function hasLostTag(item: Item): boolean {
  return item.tags.some((tag) => tag.toLowerCase() === "lost");
}

function nutritionLabel(key: string): string {
  return key.replace("_100g", "").replace("energy-kcal", "kcal").replace("energy", "energy").replace("saturated-fat", "sat fat").replaceAll("-", " ");
}

function nutritionValueLabel(key: string, value: string | number): string {
  const numeric = Number(value);
  const rendered = Number.isFinite(numeric) ? String(Math.round(numeric * 100) / 100) : String(value);
  if (key.includes("energy-kcal")) return `${rendered} kcal`;
  if (key.includes("energy")) return `${rendered} kJ`;
  if (key.endsWith("_100g") || ["fat", "saturated-fat", "carbohydrates", "sugars", "fiber", "proteins", "salt", "sodium"].includes(key)) return `${rendered} g`;
  return rendered;
}

function linkText(links: Array<{ label: string; url: string }> = []): string {
  return links.map((link) => `${link.label} | ${link.url}`).join("\n");
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

export function ProductDataExplorer({ payload, onClose }: {
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

export function ItemDetail({ item, allItems, locations, categories, units, busy, embedded = false, onClose, onChanged, onQuickAdjust, onQuickMove, onAddShopping, onMarkLost, onMarkFound, onForeverLost, onDeleteItem, onOpenLocation, onOpenTag, run }: {
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
