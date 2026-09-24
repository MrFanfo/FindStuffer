import { useDeviceDraft, draftField, DraftNotice } from "../shell/useDeviceDraft";
import { ItemContents } from "./ItemContents";
import { CategoryValueInputs } from "../../components/CategoryValueInputs";
import { ItemStructuredData, type RelatedDraft } from "./ItemStructuredData";
import JsBarcode from "jsbarcode";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  flattenLocations,
  mediaUrl,
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
import { CategoryCrumbs, findLocationChain, LocationCrumbs } from "../places/PlacesView";

type RefreshScope = "all" | "inventory" | "none";
type ActionOptions = { progress?: string; undo?: () => Promise<void> };

/** "3 days ago" reads faster than a full timestamp; the exact time is the title. */
function relativeTime(when: Date): string {
  const seconds = Math.round((Date.now() - when.getTime()) / 1000);
  const steps: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.35, "week"], [12, "month"],
  ];
  let value = seconds;
  let unit: Intl.RelativeTimeFormatUnit = "second";
  for (const [size, next] of steps) {
    if (Math.abs(value) < size) break;
    value = Math.round(value / size);
    unit = next;
  }
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-value, unit);
}

/** The site a saved link points at, which says more than the label alone. */
function linkHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

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

export function ItemDetail({ item, allItems, locations, categories, units, busy, embedded = false, onClose, onChanged, onQuickAdjust, onQuickMove, onAddShopping, onMarkLost, onMarkFound, onForeverLost, onDeleteItem, onOpenLocation, onOpenCategory, onOpenTag, run }: {
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
  onOpenCategory: (categoryId: number) => void;
  onOpenTag: (tag: string) => void;
  run: (action: () => Promise<unknown>, success: string, scope?: RefreshScope, options?: ActionOptions) => Promise<void>;
}) {
  const photoRail = useRef<HTMLDivElement | null>(null);
  const [storedCustomFields, setStoredCustomFields] = useState<Record<string, unknown>>(item.custom_fields || {});
  const [saveError, setSaveError] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);
  const [editing, setEditing] = useState(false);
  // An action that opens the editor for one field lands on that field, not the top of the form.
  const thresholdInput = useRef<HTMLInputElement | null>(null);
  const [focusThreshold, setFocusThreshold] = useState(false);
  useEffect(() => {
    if (!editing || !focusThreshold) return;
    const frame = window.requestAnimationFrame(() => {
      const input = thresholdInput.current;
      if (input) {
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        input.focus({ preventScroll: true });
        input.select();
      }
      setFocusThreshold(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing, focusThreshold]);
  const [detailTab, setDetailTab] = useState<"overview" | "details" | "activity" | "more">("overview");
  const [picker, setPicker] = useState<"move" | "category" | "editCategory" | null>(null);
  const itemDraft = useDeviceDraft(`item:${item.public_id}`, {
    name: item.name,
    description: item.description,
    notes: item.notes,
    brand: item.brand,
    model: item.model,
    serial: item.serial_number,
    expiration: item.expiration_date || "",
    threshold: item.low_stock_threshold || "",
    fullness: item.fullness_percent ?? 100,
    unit: item.unit,
    category: item.category_id ? String(item.category_id) : "",
    tags: item.tags.join(", "),
    linksValue: linkText(item.links || []),
    purchasePrice: item.purchase_price_minor === null ? "" : String(item.purchase_price_minor / 100),
    estimatedPrice: item.estimated_price_minor === null ? "" : String(item.estimated_price_minor / 100),
    weight: item.weight_g === null ? "" : String(item.weight_g),
    dimensions:
    [item.length_mm, item.width_mm, item.height_mm].map((value) =>
      value === null ? "" : String(value),
    ),
    customFieldEdits: {} as Record<string, unknown>, relatedEdits: null as RelatedDraft | null,
  });
  const [name, setName] = draftField(itemDraft, "name");
  const [description, setDescription] = draftField(itemDraft, "description");
  const [notes, setNotes] = draftField(itemDraft, "notes");
  const [brand, setBrand] = draftField(itemDraft, "brand");
  const [model, setModel] = draftField(itemDraft, "model");
  const [serial, setSerial] = draftField(itemDraft, "serial");
  const [expiration, setExpiration] = draftField(itemDraft, "expiration");
  const [threshold, setThreshold] = draftField(itemDraft, "threshold");
  const [fullness, setFullness] = draftField(itemDraft, "fullness");
  const [unit, setUnit] = draftField(itemDraft, "unit");
  const [category, setCategory] = draftField(itemDraft, "category");
  const [tags, setTags] = draftField(itemDraft, "tags");
  const [linksValue, setLinksValue] = draftField(itemDraft, "linksValue");
  const [purchasePrice, setPurchasePrice] = draftField(itemDraft, "purchasePrice");
  const [estimatedPrice, setEstimatedPrice] = draftField(itemDraft, "estimatedPrice");
  const [weight, setWeight] = draftField(itemDraft, "weight");
  const [dimensions, setDimensions] = draftField(itemDraft, "dimensions");
  const [customFieldEdits, setCustomFieldEdits] = draftField(itemDraft, "customFieldEdits");
  const [relatedEdits, setRelatedEdits] = draftField(itemDraft, "relatedEdits");
  useEffect(() => { if (itemDraft.restored) setEditing(true); }, [itemDraft.restored]);
  const [extrasErrors, setExtrasErrors] = useState<string[]>([]);
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
    if (!editing) return;
    let current = true;
    void api.item(item.public_id).then((record) => { if (current) setStoredCustomFields(record.custom_fields || {}); }).catch(() => { if (current) setSaveError("Could not refresh category properties; close and reopen the editor to retry."); });
    return () => { current = false; };
  }, [editing, item.public_id, item.version]);
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
  const showBatchData = detailCapabilities.batches && lots.length > 0;
  const showMaintenanceData = detailCapabilities.maintenance && maintenance.length > 0;
  const showReservationData = detailCapabilities.reservation && reservations.length > 0;
  const itemLinks = item.links || [];
  const showLinksData = detailCapabilities.links && itemLinks.length > 0;
  const showEnrichmentData = detailCapabilities.enrichment && (Boolean(enrichment.product) || enrichment.candidates.some((candidate) => candidate.status === "proposed" && Object.keys(candidate.proposed).length > 0));
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
    const results = await Promise.allSettled([api.itemDetail(item.public_id), api.projects(), api.locationRules()]);
    const [detailResult, projectResult, rulesResult] = results;
    const names = ["Photos, documents and item history", "Projects", "Place defaults"];
    setExtrasErrors(results.flatMap((result, index) => result.status === "rejected" ? [names[index]] : []));
    if (detailResult.status === "fulfilled") {
      const detail = detailResult.value;
      setHistory(detail.history); setPhotos(detail.photos); setDocuments(detail.documents);
      setEnrichment(detail.enrichment); setLots(detail.lots); setMaintenance(detail.maintenance);
      setReservations(detail.reservations); setRelated(detail.related);
    }
    if (projectResult.status === "fulfilled") {
      setProjects(projectResult.value);
      setReservationProject((current) => current || projectResult.value.find((project) => project.status === "active")?.public_id || "");
    }
    if (rulesResult.status === "fulfilled") setDefaultRules(rulesResult.value);
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
    setSaveError(""); setSavingDetails(true);
    try {
    const updated = await api.updateItem(item, {
      ...(relatedEdits && editCapabilities.related ? relatedEdits : {}),
      name,
      description,
      notes,
      ...(editCapabilities.identity ? { brand, serial_number: serial } : {}),
      ...(editCapabilities.specs ? { model } : {}),
      unit,
      ...(editCapabilities.expiration ? { expiration_date: expiration || null } : {}),
      ...(editCapabilities.low_stock ? { low_stock_threshold: threshold || null } : {}),
      ...(editCapabilities.fullness ? { fullness_percent: fullness } : {}),
      category_id: category ? Number(category) : null,
      ...(Object.keys(customFieldEdits).length ? { custom_fields: customFieldEdits } : {}),
      ...(editCapabilities.price ? {
      purchase_price_minor: purchasePrice ? Math.round(Number(purchasePrice) * 100) : null,
      purchase_currency: purchasePrice ? "EUR" : null,
      estimated_price_minor: estimatedPrice ? Math.round(Number(estimatedPrice) * 100) : null,
      estimated_price_currency: estimatedPrice ? "EUR" : null,
      } : {}),
      ...(editCapabilities.specs ? {
      weight_g: weight ? Number(weight) : null,
      length_mm: dimensions[0] !== "" ? Number(dimensions[0]) : null,
      width_mm: dimensions[1] !== "" ? Number(dimensions[1]) : null,
      height_mm: dimensions[2] !== "" ? Number(dimensions[2]) : null,
      } : {}),
      ...(editCapabilities.links ? { links: parseLinkText(linksValue) } : {}),
    });
    const tagged = await api.setTags(updated, tags.split(",").map((tag) => tag.trim()).filter(Boolean));
    await onChanged(tagged);
    await itemDraft.clear({ ...itemDraft.value, customFieldEdits: {}, relatedEdits: null });
    setEditing(false);
    } catch (reason) { setSaveError(reason instanceof Error ? reason.message : "Could not save changes"); }
    finally { setSavingDetails(false); }
  }

  async function upload(file: File) {
    const resized = await resizePhoto(file);
    await api.uploadPhoto(item, resized.blob, resized.width, resized.height);
    await loadExtras();
  }

  async function saveFullness(value: number) {
    const updated = await api.updateItem(item, { fullness_percent: value });
    setFullness(updated.fullness_percent ?? value);
    await onChanged(updated);
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
    if (locationPublicId === item.location_public_id && !item.container_item_id) return;
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

  const money = (minor: number | null, currency: string | null) => (
    minor === null ? "" : `${(minor / 100).toFixed(2)} ${currency || ""}`.trim()
  );
  const size = [item.length_mm, item.width_mm, item.height_mm].every((value) => value !== null)
    ? `${item.length_mm} × ${item.width_mm} × ${item.height_mm} mm`
    : "";
  // Only what this item actually records: an empty row says nothing worth a line.
  const overviewFacts: Array<[string, string]> = ([
    ["Brand", item.brand],
    ["Model", item.model],
    ["Serial", item.serial_number],
    ["Paid", money(item.purchase_price_minor, item.purchase_currency)],
    ["Worth", money(item.estimated_price_minor, item.estimated_price_currency)],
    ["Size", size],
    ["Weight", item.weight_g === null ? "" : `${item.weight_g} g`],
    ["Low stock at", !detailCapabilities.low_stock || item.low_stock_threshold === null ? "" : `${item.low_stock_threshold} ${item.unit}`],
    ["Expires", item.expiration_date ? new Date(`${item.expiration_date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""],
    ["Added", new Date(`${item.created_at}Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })],
  ] as Array<[string, string]>).filter(([, value]) => value);

  const optionalSections = (editMode: boolean) => <>
            {editMode && <ItemContents item={item} editing locations={locations} categories={categories} onChanged={onChanged} />}
            {(editMode ? editCapabilities.documents : detailCapabilities.documents && documents.length > 0) && <DocumentSection editing={editMode && editCapabilities.documents} item={item} documents={documents} onReload={loadExtras} onItemChanged={onChanged} notify={(message) => { void run(async () => undefined, message, "none"); }} />}
            <ItemStructuredData item={item} editing={editMode} relatedEnabled={editMode ? editCapabilities.related : detailCapabilities.related} onDraftChange={setRelatedEdits}>
              {(editMode || related.length > 0) && (<div className="related-manual"><h3>Linked inventory items</h3>{editMode && <div className="related-controls"><div><button type="button" className={relatedGroupMode === "category" ? "active" : ""} onClick={() => setRelatedGroupMode("category")}>By category</button><button type="button" className={relatedGroupMode === "location" ? "active" : ""} onClick={() => setRelatedGroupMode("location")}>By location</button></div><input value={relatedQuery} onChange={(event) => setRelatedQuery(event.target.value)} placeholder="Find item to relate" aria-label="Find related item" /></div>}{editMode && relatedQuery.trim() && <div className="related-candidates">{relatedCandidates.length === 0 && <div className="empty-inline"><span>No matching items</span></div>}{relatedCandidates.map((candidate) => <button type="button" key={candidate.public_id} onClick={() => void addRelatedItem(candidate)}><Icon name="plus" size={15} /><span><strong>{candidate.name}</strong><small>{categoryLabel(candidate) || "Uncategorised"} · {candidate.location_path}</small></span></button>)}</div>}{relatedGroups.length === 0 ? <div className="empty-inline"><span>No related items yet</span></div> : <div className="related-groups">{relatedGroups.map(([group, entries]) => <div className="related-group" key={group}><h3>{group}<span>{entries.length}</span></h3>{entries.map((entry) => <article className="related-item-row" key={entry.relationship_public_id}>{entry.primary_photo_url ? <img src={entry.primary_photo_url} alt="" /> : <span><Icon name="box" size={18} /></span>}<div><a href={`?view=inventory&item=${encodeURIComponent(entry.public_id)}`}>{entry.name}</a><small>{relatedGroupMode === "category" ? entry.location_path : categoryLabel(entry) || "Uncategorised"} · {entry.quantity} {entry.unit}</small></div>{editMode && <button type="button" aria-label={`Remove ${entry.name} relation`} onClick={() => void removeRelatedItem(entry)}><Icon name="close" size={14} /></button>}</article>)}</div>)}</div>}</div>)}
            </ItemStructuredData>
            {(editMode ? editCapabilities.reservation : showReservationData) && <section className="detail-section"><div className="section-heading"><div><h2>Reservations</h2><span>{reservations.length ? `${reservations.length} project hold${reservations.length === 1 ? "" : "s"}` : "No project holds yet"}</span></div></div><div className="reservation-list">{reservations.length === 0 && <div className="empty-inline"><span>Nothing reserved</span></div>}{reservations.map((reservation) => <div className="reservation" key={reservation.project_public_id}><span>{reservation.project_name}</span><small>{reservation.quantity} {reservation.unit} · {reservation.project_status}</small>{editMode && <button type="button" aria-label={`Remove ${reservation.project_name} reservation`} onClick={() => void removeReservation(reservation)}><Icon name="close" size={15} /></button>}</div>)}</div>{editMode && editCapabilities.reservation && activeProjects.length > 0 && <form className="inline-lot-form" onSubmit={addReservation}><select value={reservationProject} onChange={(event) => setReservationProject(event.target.value)} aria-label="Project">{activeProjects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}</select><input inputMode="decimal" value={reservationQuantity} onChange={(event) => setReservationQuantity(event.target.value)} aria-label="Reservation quantity" /><button className="secondary" disabled={!reservationProject || !reservationQuantity.trim()}>Reserve</button></form>}{editMode && editCapabilities.reservation && activeProjects.length === 0 && <div className="empty-inline"><span>Create an active project to reserve this item</span></div>}</section>}
            {(editMode ? editCapabilities.batches : showBatchData) && <section className="detail-section"><div className="section-heading"><div><h2>Expiration batches</h2><span>{lots.length ? `${lots.length} batch${lots.length === 1 ? "" : "es"}` : "Track multiple dates for one item"}</span></div></div><div className="lot-list">{lots.length === 0 && <div className="empty-inline"><span>No batches recorded</span></div>}{lots.map((lot) => <div className="lot-row" key={lot.public_id}><div><strong>{lot.quantity} {item.unit}</strong><small>{lot.expiration_date ? `Expires ${lot.expiration_date}` : "No expiration date"}</small>{lot.note && <em>{lot.note}</em>}</div><button aria-label="Remove batch" onClick={() => run(async () => { await api.deleteLot(item, lot); const refreshed = await api.item(item.public_id); await onChanged(refreshed); await loadExtras(); }, "Batch removed")}><Icon name="close" size={14} /></button></div>)}</div>{editMode && editCapabilities.batches && <form className="inline-lot-form" onSubmit={addLot}><input inputMode="decimal" value={lotQuantity} onChange={(event) => setLotQuantity(event.target.value)} aria-label="Batch quantity" /><input type="date" value={lotExpiration} onChange={(event) => setLotExpiration(event.target.value)} aria-label="Batch expiration date" /><input value={lotNote} onChange={(event) => setLotNote(event.target.value)} placeholder="batch note" aria-label="Batch note" /><button className="secondary" disabled={!lotQuantity}>Add batch</button></form>}</section>}
            {(editMode ? editCapabilities.maintenance : showMaintenanceData) && <section className="detail-section"><div className="section-heading"><div><h2>Maintenance</h2><span>{maintenance.length ? `${maintenance.length} recurring task${maintenance.length === 1 ? "" : "s"}` : "Optional schedules for tools and equipment"}</span></div></div><div className="maintenance-list">{maintenance.length === 0 && <div className="empty-inline"><span>No maintenance tasks</span></div>}{maintenance.map((task) => <article className={`maintenance-row ${new Date(`${task.next_due_at}T23:59:59`).getTime() < Date.now() ? "overdue" : ""}`} key={task.public_id}><div><strong>{task.title}</strong><small>Every {task.interval_days} days · next {task.next_due_at}</small>{task.notes && <p>{task.notes}</p>}</div><button className="secondary" onClick={() => run(async () => { await api.completeMaintenance(item, task); await loadExtras(); }, "Maintenance completed")}>Done</button></article>)}</div>{editMode && editCapabilities.maintenance && <form className="maintenance-form" onSubmit={addMaintenance}><input required value={maintenanceTitle} onChange={(event) => setMaintenanceTitle(event.target.value)} placeholder="Lube rails" aria-label="Maintenance title" /><input inputMode="numeric" value={maintenanceInterval} onChange={(event) => setMaintenanceInterval(event.target.value)} aria-label="Interval days" /><input value={maintenanceNotes} onChange={(event) => setMaintenanceNotes(event.target.value)} placeholder="notes" aria-label="Maintenance notes" /><button className="secondary" disabled={!maintenanceTitle.trim()}>Add task</button></form>}</section>}

    {editMode && editCapabilities.enrichment && <section className="detail-section"><h2>Product lookup</h2><button type="button" disabled={busy} onClick={() => void run(async () => { await api.queueEnrichment(item); await api.runEnrichment(); await loadExtras(); }, "Product lookup completed")}>Look up product data</button></section>}
  </>;

  const desktopEmbedded = embedded && window.matchMedia("(min-width: 1100px)").matches;
  return (
    <div className={embedded ? "embedded-item-detail item-detail-backdrop" : "modal-backdrop item-detail-backdrop"} role="dialog" aria-modal={desktopEmbedded ? undefined : "true"} aria-label={item.name} onMouseDown={(event) => { if (!desktopEmbedded && event.target === event.currentTarget) onClose(); }}>
      <article className="detail-sheet">
        {extrasErrors.map((section) => <p className="error-banner" role="alert" key={section}>{section} could not load. <button onClick={() => void loadExtras()}>Retry</button></p>)}
        <div className="sheet-handle" aria-hidden="true" />
        <DraftNotice draft={itemDraft} onDiscard={() => { void itemDraft.clear(); setEditing(false); }} /><header className="detail-header"><button className="icon-button" onClick={onClose} aria-label="Close item"><Icon name="close" /></button><div><h1>{brandPrefix && <span className="item-brand-prefix">{brandPrefix} </span>}{item.name}</h1><LocationCrumbs chain={locationChain} fallback={item.location_path} onOpen={onOpenLocation} /><div className="detail-header-meta">{item.project_holds?.map(hold => <small key={hold.public_id}>{hold.quantity} {item.unit} reserved · <a href={`?view=projects&project=${hold.public_id}`}>{hold.name}</a></small>)}{item.category_id && categories.find((entry) => entry.id === item.category_id) ? <CategoryCrumbs category={categories.find((entry) => entry.id === item.category_id)!} categories={categories} onOpen={onOpenCategory} /> : <small>Uncategorised</small>}</div></div>{editing && <button className="text-button" onClick={() => { void itemDraft.clear(); setEditing(false); }}>Cancel editing</button>}</header>
        {((editing ? editCapabilities.photos : detailCapabilities.photos) && (editing || photos.length > 0)) && <section className={`detail-photo-hero ${photos.length ? "" : "empty-photo"}`} aria-label="Item photos">
          <div className="detail-photo-rail" ref={photoRail}>
            {photos.map((photo, index) => <figure key={photo.public_id}><img src={photo.url} alt={`${item.name} photo ${index + 1}`} />{editing && <button aria-label={`Delete photo ${index + 1}`} onClick={() => run(() => api.deletePhoto(photo).then(loadExtras), "Photo removed")}><Icon name="close" size={15} /></button>}</figure>)}
            {detailCapabilities.photos && <label className="photo-add-tile"><Icon name="camera" size={28} /><span>{photos.length ? "Add photo" : "Add a photo"}</span><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} /></label>}
          </div>
        </section>}
        {editing ? (
          <><form id="item-edit-form" className="form-card" onSubmit={save}>
            <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
            <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
            {(editCapabilities.identity || editCapabilities.specs) && <div className="form-row">{editCapabilities.identity && <label>Brand<input value={brand} onChange={(event) => setBrand(event.target.value)} /></label>}{editCapabilities.specs && <label>Model<input value={model} onChange={(event) => setModel(event.target.value)} /></label>}</div>}
            {editCapabilities.identity && <label>Serial number<input value={serial} onChange={(event) => setSerial(event.target.value)} /></label>}
            <div className="form-row">{editCapabilities.expiration && <label>Expiration<input type="date" value={expiration} onChange={(event) => setExpiration(event.target.value)} /></label>}{editCapabilities.low_stock && <label>Low stock at<input ref={thresholdInput} inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>}</div>
            {editCapabilities.fullness && <label className="fullness-editor"><span>Fullness <strong>{fullness}%</strong></span><input type="range" min="0" max="100" step="5" value={fullness} onChange={(event) => setFullness(Number(event.target.value))} /></label>}
            <label>Unit<select value={unit} onChange={(event) => setUnit(event.target.value)}>{units.includes(unit) ? null : <option value={unit}>{unit}</option>}{units.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
            <div className="picker-field"><span>Category</span><button type="button" onClick={() => setPicker("editCategory")}><Icon name="tag" size={16} /><strong>{editingCategory ? categoryOptionLabel(editingCategory) : "No category"}</strong></button>{category && <button type="button" className="text-button" onClick={() => setCategory("")}>Clear category</button>}</div>
            <label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="electronics, project, spare" /></label>
            {editCapabilities.links && <label>Links<textarea rows={3} value={linksValue} onChange={(event) => setLinksValue(event.target.value)} placeholder="Manual | https://example.com/manual.pdf" /></label>}
            {editCapabilities.price && <div className="form-row"><label>Purchase price (€)<input inputMode="decimal" value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} /></label><label>Current estimate (€)<input inputMode="decimal" value={estimatedPrice} onChange={(event) => setEstimatedPrice(event.target.value)} /></label></div>}
            {editCapabilities.specs && <><label>Weight (g)<input inputMode="numeric" value={weight} onChange={(event) => setWeight(event.target.value)} /></label><div className="form-row dimensions"><label>Length mm<input inputMode="numeric" value={dimensions[0]} onChange={(event) => setDimensions([event.target.value, dimensions[1], dimensions[2]])} /></label><label>Width mm<input inputMode="numeric" value={dimensions[1]} onChange={(event) => setDimensions([dimensions[0], event.target.value, dimensions[2]])} /></label><label>Height mm<input inputMode="numeric" value={dimensions[2]} onChange={(event) => setDimensions([dimensions[0], dimensions[1], event.target.value])} /></label></div></>}
            <CategoryValueInputs key={category} category={category} values={{ ...storedCustomFields, ...customFieldEdits }} onChange={(values) => setCustomFieldEdits(values)} />
            {saveError && <p role="alert">{saveError}</p>}
          </form>
          {optionalSections(true)}
          <button type="submit" form="item-edit-form" className="primary wide" disabled={busy || savingDetails}>Save changes</button></>
        ) : (
          <>
            <nav className="detail-tabs" role="tablist" aria-label="Item sections">{(["overview", "details", "activity", "more"] as const).map((tab) => <button type="button" role="tab" aria-selected={detailTab === tab} className={detailTab === tab ? "active" : ""} key={tab} onClick={() => setDetailTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}{tab === "activity" && history.length > 0 ? <span>{history.length}</span> : null}</button>)}</nav>
            <div className="detail-tab-panel" hidden={detailTab !== "overview"}>
            <ItemContents item={item} editing={false} locations={locations} categories={categories} onChanged={onChanged} />
            {detailCapabilities.fullness && item.fullness_percent != null && <section className="fullness-card"><div><span><Icon name="box" size={16} />Fullness</span><strong>{fullness}%</strong></div><input aria-label="Item fullness" type="range" min="0" max="100" step="5" value={fullness} style={{ "--fullness": `${fullness}%` } as React.CSSProperties} onChange={(event) => setFullness(Number(event.target.value))} onPointerUp={(event) => void saveFullness(Number(event.currentTarget.value))} onKeyUp={(event) => void saveFullness(Number(event.currentTarget.value))} /><small>Slide while using or refilling this Item.</small></section>}
            {overviewFacts.length > 0 && <section className="detail-section">
              <div className="section-heading"><div><h2>Facts</h2></div></div>
              <dl className="fact-rows">{overviewFacts.map(([label, value]) => <div className="fact-row" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            </section>}
            {(item.expiration_date || item.barcode) && <div className="detail-facts compact-facts">{item.expiration_date && <div><span>Next expiry</span><strong>{item.expiration_date}</strong>{expirationState(item) && <small className="fact-warning">{expirationState(item) === "expired" ? "Expired" : "Use within 7 days"}</small>}</div>}{item.barcode && <div className="barcode-fact"><span>Barcode</span><BarcodeGraphic value={item.barcode} /></div>}</div>}
            {(item.description || item.notes) && <section className="detail-section prose-section">
              {item.description && <p className="item-description">{item.description}</p>}
              {item.notes && <div className="item-notes"><span>Notes</span><p>{item.notes}</p></div>}
            </section>}
            {item.tags.length > 0 && <section className="detail-section tag-section"><div className="section-heading"><div><h2>Tags</h2></div></div><div className="tag-list">{item.tags.map((tag) => <button type="button" key={tag} onClick={() => onOpenTag(tag)}><Icon name="tag" size={13} /><span>{tag}</span></button>)}</div></section>}

            </div>
            <div className="detail-tab-panel" hidden={detailTab !== "details"}>
            {showLinksData && <section className="detail-section"><div className="section-heading"><div><h2>Links</h2><span>{itemLinks.length ? `${itemLinks.length} saved` : "Manuals, datasheets, and references"}</span></div>{detailCapabilities.links && <button type="button" className="text-button" onClick={() => setEditing(true)}>{itemLinks.length ? "Edit" : "Add link"}</button>}</div>{itemLinks.length ? <div className="link-list">{itemLinks.map((link, index) => <a key={`${index}-${link.url}`} href={link.url} target="_blank" rel="noreferrer"><Icon name="link" size={15} /><span><strong>{link.label}</strong><small>{linkHost(link.url)}</small></span><Icon name="chevron" size={14} /></a>)}</div> : <div className="empty-inline"><span>No links yet</span></div>}</section>}
            {optionalSections(false)}
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
            {history.length > 0 && <section className="detail-section activity-section">
              <ol className="activity-feed">{history.map((event) => {
                const when = new Date(`${event.created_at}Z`);
                const delta = event.quantity_delta === null ? "" : `${Number(event.quantity_delta) > 0 ? "+" : ""}${Number(event.quantity_delta)}`;
                const movement = event.to_location ? `${event.from_location ? `${event.from_location} → ` : ""}${event.to_location}` : "";
                return <li key={event.public_id}>
                  <span className="activity-mark" aria-hidden="true"><Icon name={event.quantity_delta !== null ? (Number(event.quantity_delta) > 0 ? "plus" : "minus") : event.to_location ? "pin" : "spark"} size={14} /></span>
                  <span className="activity-copy">
                    <strong>{activityLabel(event.action)}{delta && <b>{delta} {item.unit}</b>}</strong>
                    <small>{[movement, event.source].filter(Boolean).join(" · ")}</small>
                  </span>
                  <time dateTime={when.toISOString()} title={when.toLocaleString()}>{relativeTime(when)}</time>
                </li>;
              })}</ol>
            </section>}
            </div>
            <div className="detail-tab-panel more-panel" hidden={detailTab !== "more"}>
            <section className="detail-section action-group">
              <div className="section-heading"><div><h2>Where it lives</h2><span>Place, category and defaults</span></div></div>
              <div className="action-rows">
                <button type="button" disabled={busy} onClick={() => setPicker("move")}><Icon name="pin" size={17} /><span><strong>Move</strong><small>{item.location_path}</small></span><Icon name="chevron" size={15} /></button>
                <button type="button" disabled={busy} onClick={() => setPicker("category")}><Icon name="tag" size={17} /><span><strong>Category</strong><small>{categoryLabel(item) || "Uncategorised"}</small></span><Icon name="chevron" size={15} /></button>
                {itemDefaultRule
                  ? <button type="button" disabled={busy} onClick={() => void removeItemDefault(itemDefaultRule)}><Icon name="close" size={17} /><span><strong>Delete default place</strong><small>{itemDefaultRule.rule_type}: {itemDefaultRule.match_value}</small></span></button>
                  : <button type="button" disabled={busy} onClick={() => void setItemDefault()}><Icon name="pin" size={17} /><span><strong>Set default place</strong><small>Put future items like this one here</small></span></button>}
              </div>
            </section>
            {(detailCapabilities.shopping_list || detailCapabilities.low_stock) && <section className="detail-section action-group">
              <div className="section-heading"><div><h2>Stock</h2><span>Restocking and low-stock warnings</span></div></div>
              <div className="action-rows">
                {detailCapabilities.shopping_list && <button type="button" disabled={busy} onClick={() => void onAddShopping(item)}><Icon name="plus" size={17} /><span><strong>Add to shopping list</strong><small>Buy more of this</small></span></button>}
                {detailCapabilities.low_stock && <button type="button" disabled={busy} onClick={() => { setThreshold(item.low_stock_threshold ?? "1"); setFocusThreshold(true); setEditing(true); }}><Icon name="minus" size={17} /><span><strong>{item.low_stock_threshold === null ? "Set low stock warning" : "Change low stock warning"}</strong><small>{item.low_stock_threshold === null ? "Warn when stock runs down" : `Warns at ${item.low_stock_threshold} ${item.unit}`}</small></span></button>}
              </div>
            </section>}
            <section className={`detail-section action-group ${lost ? "is-lost" : ""}`}>
              <div className="section-heading"><div><h2>Finding it</h2><span>{lost ? "Marked lost" : "When it is not where it should be"}</span></div></div>
              <div className="action-rows">
                {lost
                  ? <><button type="button" disabled={busy} onClick={() => void onMarkFound(item)}><Icon name="check" size={17} /><span><strong>Found it</strong><small>Put it back in the inventory</small></span></button>
                    <button type="button" className="danger" disabled={busy} onClick={() => void onForeverLost(item)}><Icon name="close" size={17} /><span><strong>Gone for good</strong><small>Stop looking and write it off</small></span></button></>
                  : <button type="button" disabled={busy} onClick={() => void onMarkLost(item)}><Icon name="search" size={17} /><span><strong>Mark lost</strong><small>Keep it listed while you look</small></span></button>}
              </div>
            </section>
            <section className="detail-section qr-section"><div><h2>QR label</h2><p>Print or scan to open this item.</p></div><a href={mediaUrl(`/api/v1/labels/items/${item.public_id}`)} target="_blank" rel="noreferrer"><img src={mediaUrl(`/api/v1/qr/items/${item.public_id}.svg`)} alt={`QR code for ${item.name}`} /></a></section>
            <section className="detail-section action-group danger-zone">
              <div className="section-heading"><div><h2>Remove</h2><span>Archive keeps the history; deleting does not</span></div></div>
              <div className="action-rows">
                <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Archive ${item.name}? It will disappear from regular search but remain in history and exports.`)) void run(() => api.archive(item).then(onClose), `${item.name} archived`); }}><Icon name="box" size={17} /><span><strong>Archive</strong><small>Out of the way, still recorded</small></span></button>
                <button type="button" className="danger" disabled={busy} onClick={() => void onDeleteItem(item)}><Icon name="close" size={17} /><span><strong>Delete permanently</strong><small>Removes the item, its photos and its history</small></span></button>
              </div>
            </section>
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
