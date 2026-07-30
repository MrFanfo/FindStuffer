import { FormEvent, type MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  flattenLocations,
  type BarcodeResult,
  type Category,
  type Item,
  type LocationNode,
} from "../../api";
import { HierarchyPicker, categoryPickerNodes, locationPickerNodes } from "../../components/HierarchyPicker";
import { Icon, type IconName } from "../../components/Icon";
import { AICommandBox } from "./AICommandBox";
import { parseFindstuffQrTarget } from "./qrNavigation";
import {
  capabilitiesForCategory,
  categoryOptionLabel,
  isOfflineFailure,
  parseLinkText,
} from "./itemCaptureUtils";

export type CaptureMode = "scan" | "quick" | "putaway" | "consume" | "assistant";

type ScannedEntry = {
  id: string;
  code: string;
  status: "looking_up" | "ready" | "error";
  error: string;
  result: BarcodeResult | null;
  name: string;
  brand: string;
  model: string;
  description: string;
  links_value: string;
  low_stock_threshold: string;
  quantity: string;
  unit: string;
  location_public_id: string;
  category_id: string;
  expiration_date: string;
  image_url: string | null;
  save_image: boolean;
  photo_file: File | null;
  photo_preview: string | null;
};

type CaptureSessionDefaults = { location_public_id: string; category_id: string; unit: string };
type CaptureTemplate = CaptureSessionDefaults & { id: string; name: string; quantity: string };

const CAPTURE_DEFAULTS_KEY = "findstuff.capture.defaults.v1";
const CAPTURE_RECENTS_KEY = "findstuff.capture.recentLocations.v1";
const CAPTURE_TEMPLATES_KEY = "findstuff.capture.templates.v1";

function readLocalJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
  catch { return fallback; }
}

function defaultCaptureSession(initialLocation = "unassigned"): CaptureSessionDefaults {
  const saved = readLocalJson<Partial<CaptureSessionDefaults>>(CAPTURE_DEFAULTS_KEY, {});
  return {
    location_public_id: initialLocation !== "unassigned" ? initialLocation : saved.location_public_id || initialLocation,
    category_id: saved.category_id || "",
    unit: saved.unit || "pcs",
  };
}

function newScanId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `scan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultBarcodeName(code: string) {
  return `Product ${code}`;
}

function suggestScannedCategory(categories: Category[], product: BarcodeResult["product"]): string {
  if (!product) return "";
  const sourceLabels = product.categories.map((label) => label.replace(/^[a-z]{2}:/i, "").replaceAll("-", " ").toLocaleLowerCase());
  const sourceText = [product.name, ...sourceLabels].join(" ").toLocaleLowerCase();
  const ranked = categories.map((category) => {
    const categoryName = category.name.toLocaleLowerCase();
    const exact = sourceLabels.some((label) => label === categoryName || label.endsWith(` ${categoryName}`));
    const contained = sourceText.includes(categoryName);
    return { category, score: (exact ? 100 : contained ? 40 : 0) + category.depth };
  }).filter((entry) => entry.score > entry.category.depth).sort((left, right) => right.score - left.score);
  if (ranked[0]) return String(ranked[0].category.id);
  if (sourceText.match(/food|grocery|beverage|drink|nut|ingredient/)) {
    const grocery = categories.find((category) => /grocer|food/i.test(`${category.slug} ${category.name}`));
    if (grocery) return String(grocery.id);
  }
  return "";
}

export function ScanView({ items, locations, categories, units, busy, initialMode, initialLocation, onOpenItem, onUseLocation, onCreateLocation, onCreateCategory, onCreate, onAdjust, onInventoryChanged }: {
  items: Item[];
  locations: LocationNode[];
  categories: Category[];
  units: string[];
  busy: boolean;
  initialMode: CaptureMode;
  initialLocation: string;
  onOpenItem: (id: string) => Promise<unknown>;
  onUseLocation: (id: string) => void;
  onCreateLocation: (body: { name: string; kind: string; parent_public_id: string | null }) => Promise<LocationNode>;
  onCreateCategory: (name: string, parentId: number | null) => Promise<Category>;
  onCreate: (body: Record<string, unknown>, imageUrl?: string, photoFile?: File) => Promise<Item>;
  onAdjust: (item: Item, delta: number) => Promise<void>;
  onInventoryChanged: () => Promise<void>;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const scannedRef = useRef<ScannedEntry[]>([]);
  const lookupInFlight = useRef<Set<string>>(new Set());
  const [code, setCode] = useState("");
  const [scanned, setScanned] = useState<ScannedEntry[]>([]);
  const [message, setMessage] = useState("");
  const [photoScanning, setPhotoScanning] = useState(false);
  const [savingCodes, setSavingCodes] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<{ id: string; type: "location" | "category" } | null>(null);
  const [mode, setMode] = useState<CaptureMode>(initialMode);
  const [sessionDefaults, setSessionDefaults] = useState<CaptureSessionDefaults>(() => defaultCaptureSession(initialLocation));
  const [recentLocationIds, setRecentLocationIds] = useState<string[]>(() => readLocalJson<string[]>(CAPTURE_RECENTS_KEY, []));
  const [templates, setTemplates] = useState<CaptureTemplate[]>(() => readLocalJson<CaptureTemplate[]>(CAPTURE_TEMPLATES_KEY, []));
  const [templateName, setTemplateName] = useState("");
  const [putawayPickerOpen, setPutawayPickerOpen] = useState(false);
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const locationNodes = useMemo(() => locationPickerNodes(locations), [locations]);
  const categoryNodes = useMemo(() => categoryPickerNodes(categories), [categories]);
  const secureCameraContext = window.isSecureContext;
  const lookingUp = scanned.some((entry) => entry.status === "looking_up");
  const pickerEntry = picker ? scanned.find((entry) => entry.id === picker.id) || null : null;
  const recentLocations = recentLocationIds.map((id) => flatLocations.find((entry) => entry.public_id === id)).filter((entry): entry is LocationNode => Boolean(entry)).slice(0, 5);

  useEffect(() => setMode(initialMode), [initialMode]);
  useEffect(() => {
    if (initialLocation && initialLocation !== "unassigned") {
      setSessionDefaults((current) => ({ ...current, location_public_id: initialLocation }));
    }
  }, [initialLocation]);

  useEffect(() => {
    scannedRef.current = scanned;
  }, [scanned]);

  function setScannedEntries(updater: (entries: ScannedEntry[]) => ScannedEntry[]) {
    setScanned((current) => {
      const next = updater(current);
      scannedRef.current = next;
      return next;
    });
  }

  function updateScannedEntry(codeValue: string, updater: (entry: ScannedEntry) => ScannedEntry) {
    setScannedEntries((entries) => entries.map((entry) => entry.code === codeValue ? updater(entry) : entry));
  }

  function makeEntry(changes: Partial<ScannedEntry> = {}, defaults: CaptureSessionDefaults = sessionDefaults): ScannedEntry {
    return {
      id: newScanId(),
      code: "",
      status: "ready",
      error: "",
      result: null,
      name: "",
      brand: "",
      model: "",
      description: "",
      links_value: "",
      low_stock_threshold: "",
      quantity: "1",
      unit: defaults.unit,
      location_public_id: defaults.location_public_id,
      category_id: defaults.category_id,
      expiration_date: "",
      image_url: null,
      save_image: false,
      photo_file: null,
      photo_preview: null,
      ...changes,
    };
  }

  function addBlankEntry(template?: CaptureTemplate, switchToQuick = true, defaults: CaptureSessionDefaults = sessionDefaults) {
    const entry = makeEntry(template ? {
      unit: template.unit,
      quantity: template.quantity,
      location_public_id: template.location_public_id,
      category_id: template.category_id,
    } : {}, defaults);
    setScannedEntries((entries) => [entry, ...entries]);
    if (switchToQuick) setMode("quick");
  }

  function rememberLocation(locationId: string) {
    if (!locationId || locationId === "unassigned") return;
    setRecentLocationIds((current) => {
      const next = [locationId, ...current.filter((id) => id !== locationId)].slice(0, 8);
      localStorage.setItem(CAPTURE_RECENTS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function setPutawayLocation(locationId: string) {
    setSessionDefaults((current) => ({ ...current, location_public_id: locationId }));
    rememberLocation(locationId);
    setScannedEntries((entries) => entries.map((entry) => ({ ...entry, location_public_id: locationId })));
    setPutawayPickerOpen(false);
    setMessage(`Put-away destination: ${flatLocations.find((entry) => entry.public_id === locationId)?.path || "selected location"}.`);
  }

  function queueBarcode(value: string) {
    const normalized = value.trim();
    const existing = scannedRef.current.find((entry) => entry.code === normalized);
    if (existing) {
      return false;
    }
    setScannedEntries((entries) => [makeEntry({
      code: normalized,
      status: "looking_up",
      name: defaultBarcodeName(normalized),
      location_public_id: mode === "putaway" ? sessionDefaults.location_public_id : sessionDefaults.location_public_id,
    }), ...entries]);
    return true;
  }

  async function lookupBarcode(value: string) {
    const normalized = value.trim();
    if (lookupInFlight.current.has(normalized)) return;
    lookupInFlight.current.add(normalized);
    try {
      const result = await api.barcode(normalized);
      if (mode === "consume") {
        if (result.existing_item && Number(result.existing_item.quantity) > 0) {
          await onAdjust(result.existing_item, -1);
          setScannedEntries((entries) => entries.filter((entry) => entry.code !== normalized));
          setMessage(`${result.existing_item.name}: consumed 1 ${result.existing_item.unit}.`);
        } else {
          updateScannedEntry(normalized, (entry) => ({ ...entry, status: "error", result, error: result.existing_item ? "Quantity is already zero." : "This product is not in your inventory." }));
        }
        return;
      }
      updateScannedEntry(normalized, (entry) => {
        const product = result.product;
        const shouldUseProductName = !entry.name.trim() || entry.name === defaultBarcodeName(normalized);
        const categoryId = entry.category_id || String(result.mapped_category?.id || "") || suggestScannedCategory(categories, product);
        const categoryDefault = categories.find((category) => String(category.id) === categoryId)?.default_location;
        return {
          ...entry,
          status: "ready",
          error: "",
          result,
          name: shouldUseProductName ? product?.name || entry.name : entry.name,
          brand: entry.brand || product?.brand || "",
          model: entry.model,
          description: entry.description,
          links_value: entry.links_value,
          low_stock_threshold: entry.low_stock_threshold,
          location_public_id: mode === "putaway" ? sessionDefaults.location_public_id : result.suggested_location?.public_id
            || result.mapped_category?.default_location?.public_id
            || (entry.location_public_id === "unassigned" ? categoryDefault?.public_id : undefined)
            || entry.location_public_id,
          category_id: categoryId,
          image_url: product?.image_url || entry.image_url,
          save_image: Boolean(product?.image_url),
          photo_file: entry.photo_file,
          photo_preview: entry.photo_preview,
        };
      });
      setMessage(result.existing_item ? "Already saved. Adjust the quantity below." : result.found ? "Product recognized. Keep scanning or review below." : "Code added. Add details in the review list.");
    } catch (error) {
      if (isOfflineFailure(error) && mode !== "consume") {
        updateScannedEntry(normalized, (entry) => ({ ...entry, status: "ready", error: "" }));
        setMessage("Offline code captured. Add a name and save it; product lookup can happen after synchronization.");
      } else {
        updateScannedEntry(normalized, (entry) => ({ ...entry, status: "error", error: error instanceof Error ? error.message : "Lookup failed" }));
        setMessage(error instanceof Error ? error.message : "Lookup failed");
      }
    } finally {
      lookupInFlight.current.delete(normalized);
    }
  }

  async function consume(value: string): Promise<boolean> {
    if (!value.trim()) return true;
    const normalized = value.trim();
    setCode(normalized);
    const qrTarget = parseFindstuffQrTarget(normalized);
    if (qrTarget?.type === "item") {
      const itemId = qrTarget.publicId;
      if (itemId) {
        if (mode === "consume") {
          const item = items.find((entry) => entry.public_id === itemId);
          if (item && Number(item.quantity) > 0) {
            await onAdjust(item, -1);
            setMessage(`${item.name}: consumed 1 ${item.unit}.`);
            return true;
          }
          setMessage(item ? `${item.name} is already at zero.` : "That item is not loaded in this inventory view.");
          return true;
        }
        await onOpenItem(itemId);
        return false;
      }
    }
    if (qrTarget?.type === "location") {
      const locationId = qrTarget.publicId;
      if (locationId) {
        if (mode === "putaway") { setPutawayLocation(locationId); return true; }
        onUseLocation(locationId);
        return false;
      }
    }
    const added = queueBarcode(normalized);
    setMessage(added ? "Scanned. Keep going." : "Already in review. Duplicate ignored.");
    if (added) void lookupBarcode(normalized);
    return true;
  }

  function changeScannedEntry(id: string, changes: Partial<ScannedEntry>) {
    setScannedEntries((entries) => entries.map((entry) => entry.id === id ? { ...entry, ...changes } : entry));
  }

  function removeScannedEntry(id: string) {
    const removed = scannedRef.current.find((entry) => entry.id === id);
    if (removed?.photo_preview) URL.revokeObjectURL(removed.photo_preview);
    setScannedEntries((entries) => entries.filter((entry) => entry.id !== id));
  }

  function chooseEntryCategory(entryId: string, categoryId: string) {
    const chosen = categories.find((entry) => String(entry.id) === categoryId);
    changeScannedEntry(entryId, {
      category_id: categoryId,
      ...(mode !== "putaway" && chosen?.default_location ? { location_public_id: chosen.default_location.public_id } : {}),
    });
  }

  async function saveScannedEntry(entry: ScannedEntry, inbox = false, addAnother = false) {
    if (entry.result?.existing_item) {
      changeScannedEntry(entry.id, { status: "error", error: "This barcode is already saved. Adjust its quantity instead." });
      return false;
    }
    if (!entry.name.trim() && !inbox) {
      changeScannedEntry(entry.id, { status: "error", error: "Add a name before saving." });
      return false;
    }
    if (!entry.quantity.trim()) {
      changeScannedEntry(entry.id, { status: "error", error: "Add the quantity before saving." });
      return false;
    }
    setSavingCodes((current) => new Set(current).add(entry.id));
    try {
      const entryCapabilities = capabilitiesForCategory(categories, entry.category_id);
      await onCreate({
        name: entry.name.trim() || `Inbox capture ${new Date().toLocaleDateString()}`,
        brand: entryCapabilities.identity ? entry.brand.trim() : "",
        model: entryCapabilities.specs ? entry.model.trim() : "",
        description: entry.description.trim(),
        links: entryCapabilities.links ? parseLinkText(entry.links_value) : [],
        barcode: entry.code,
        quantity: entry.quantity.trim(),
        unit: entry.unit.trim() || "pcs",
        location_public_id: inbox ? "unassigned" : entry.location_public_id || "unassigned",
        category_id: inbox ? null : entry.category_id ? Number(entry.category_id) : null,
        low_stock_threshold: entry.low_stock_threshold || null,
        expiration_date: entryCapabilities.expiration ? entry.expiration_date || null : null,
        tags: inbox ? ["inbox"] : [],
      }, entry.save_image && entry.image_url ? entry.image_url : undefined, entry.photo_file || undefined);
      const nextDefaults = {
        location_public_id: entry.location_public_id || "unassigned",
        category_id: entry.category_id,
        unit: entry.unit.trim() || "pcs",
      };
      setSessionDefaults(nextDefaults);
      localStorage.setItem(CAPTURE_DEFAULTS_KEY, JSON.stringify(nextDefaults));
      rememberLocation(entry.location_public_id);
      removeScannedEntry(entry.id);
      setMessage(inbox ? "Saved to Inbox for later completion." : `${entry.name.trim()} saved.`);
      if (addAnother) addBlankEntry(undefined, mode !== "putaway", nextDefaults);
      return true;
    } catch (error) {
      changeScannedEntry(entry.id, { status: "error", error: error instanceof Error ? error.message : "Could not save item" });
      return false;
    } finally {
      setSavingCodes((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
    }
  }

  function saveTemplate(entry: ScannedEntry) {
    const label = templateName.trim();
    if (!label) return;
    const template: CaptureTemplate = {
      id: newScanId(),
      name: label,
      quantity: entry.quantity || "1",
      unit: entry.unit || "pcs",
      location_public_id: entry.location_public_id || "unassigned",
      category_id: entry.category_id,
    };
    setTemplates((current) => {
      const next = [template, ...current].slice(0, 12);
      localStorage.setItem(CAPTURE_TEMPLATES_KEY, JSON.stringify(next));
      return next;
    });
    setTemplateName("");
    setMessage(`${label} template saved.`);
  }

  function deleteTemplate(templateId: string) {
    setTemplates((current) => {
      const next = current.filter((entry) => entry.id !== templateId);
      localStorage.setItem(CAPTURE_TEMPLATES_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function saveAllScanned() {
    const entries = scannedRef.current.filter((entry) => !entry.result?.existing_item);
    if (entries.length === 0) {
      setMessage("All scanned barcodes are already saved. Use the quantity controls below.");
      return;
    }
    let saved = 0;
    for (const entry of entries) {
      const ok = await saveScannedEntry(entry);
      if (ok) saved += 1;
    }
    setMessage(saved === entries.length ? "Scan session saved." : `${saved} saved. Check the remaining rows.`);
  }

  async function addManualCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await consume(code);
  }

  async function scanPhoto(file: File) {
    setPhotoScanning(true);
    setMessage("Reading code from photo...");
    try {
      const decoded = await api.decodeBarcodeImage(file);
      await consume(decoded.code);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read a code from that photo");
    } finally {
      setPhotoScanning(false);
    }
  }

  return (
    <section className="scan-page">
      <div className="capture-modes" role="tablist" aria-label="Capture mode">{([
        ["scan", "Scan", "scan"],
        ["quick", "Quick add", "plus"],
        ["putaway", "Put away", "pin"],
        ["consume", "Consume", "minus"],
        ["assistant", "Voice / AI", "mic"],
      ] as Array<[CaptureMode, string, IconName]>).map(([id, label, icon]) => <button type="button" role="tab" aria-selected={mode === id} className={mode === id ? "active" : ""} key={id} onClick={() => { setMode(id); if (id === "quick" && scannedRef.current.length === 0) addBlankEntry(); }}><Icon name={icon} size={18} /><span>{label}</span></button>)}</div>
      {mode === "assistant" ? <AICommandBox busy={busy} items={items} locations={locations} categories={categories} onApplied={onInventoryChanged} /> : <>
        {mode === "putaway" && <section className="putaway-destination"><div><span><Icon name="pin" size={17} /></span><div><small>EVERY ITEM GOES TO</small><strong>{flatLocations.find((entry) => entry.public_id === sessionDefaults.location_public_id)?.path || "Choose or scan a location"}</strong></div></div><button className="secondary" type="button" onClick={() => setPutawayPickerOpen(true)}>Choose</button>{recentLocations.length > 0 && <div className="recent-location-row"><small>Recent</small>{recentLocations.map((entry) => <button type="button" key={entry.public_id} onClick={() => setPutawayLocation(entry.public_id)}>{entry.name}</button>)}</div>}</section>}
        {(mode === "scan" || mode === "putaway" || mode === "consume") && <>
          {!secureCameraContext && <div className="camera-note"><Icon name="camera" size={18} /><span>Live camera needs trusted HTTPS. Snap code uses your phone camera through photo capture and works here.</span></div>}
          <CameraScanner videoRef={video} onCode={consume} />
          <div className="capture-camera-actions"><label className={`snap-code-button secondary button-with-icon ${photoScanning ? "busy" : ""}`}><Icon name="camera" size={17} />{photoScanning ? "Reading photo..." : "Snap a code"}<input type="file" accept="image/*" capture="environment" hidden disabled={busy || photoScanning} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void scanPhoto(file); }} /></label><button type="button" className="secondary button-with-icon" onClick={() => addBlankEntry(undefined, mode !== "putaway")}><Icon name="plus" size={17} />Type instead</button></div>
          <div className="scan-tips"><span><Icon name="qr" size={16} />Findstuff QR opens items or selects a destination</span><span><Icon name="box" size={16} />Retail barcodes become review cards</span></div>
          <div className="or-divider"><span>or enter a code</span></div>
          <form className="search scan-manual" onSubmit={(event) => void addManualCode(event)}><input inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Barcode or QR text" aria-label="Barcode or QR text" /><button className="primary" disabled={busy || !code.trim()}>Use code</button></form>
        </>}
        {mode === "quick" && <section className="quick-capture-launch"><button type="button" className="primary button-with-icon" onClick={() => addBlankEntry()}><Icon name="plus" size={18} />New blank item</button>{templates.length > 0 && <div className="template-launcher"><span>Start from a template</span><div>{templates.map((template) => <span key={template.id}><button type="button" onClick={() => addBlankEntry(template)}><Icon name="spark" size={14} />{template.name}</button><button type="button" aria-label={`Delete ${template.name} template`} onClick={() => deleteTemplate(template.id)}><Icon name="close" size={12} /></button></span>)}</div></div>}</section>}
      </>}
      {message && <div className={`inline-alert ${!lookingUp && scanned.length > 0 ? "success" : ""}`} role="status">{message}</div>}
      {scanned.length > 0 && <section className="scan-review-panel">
        <div className="scan-review-heading">
          <div><p className="eyebrow">REVIEW</p><h2>{scanned.length} unique {scanned.length === 1 ? "item" : "items"}</h2><span>{lookingUp ? "Looking up product data..." : "Ready to save"}</span></div>
          <button className="primary button-with-icon" disabled={busy || savingCodes.size > 0 || scanned.length === 0} onClick={() => void saveAllScanned()}><Icon name="plus" size={17} />Save all</button>
        </div>
        <div className="scan-batch-list">
          {scanned.map((entry) => {
            const product = entry.result?.product;
            const saving = savingCodes.has(entry.id);
            const entryCapabilities = capabilitiesForCategory(categories, entry.category_id);
            const entryCategory = categories.find((categoryEntry) => String(categoryEntry.id) === entry.category_id);
            const entryLocation = flatLocations.find((locationEntry) => locationEntry.public_id === entry.location_public_id);
            const existingItem = entry.result?.existing_item || null;
            const normalizedName = entry.name.trim().toLocaleLowerCase();
            const duplicateMatches = items.filter((item) => (
              entry.code && item.barcode === entry.code
            ) || (
              normalizedName.length >= 3 && (item.name.toLocaleLowerCase() === normalizedName || item.name.toLocaleLowerCase().includes(normalizedName))
            )).slice(0, 3);
            const reviewFields = <div className="scan-entry-fields">
              <label className="capture-photo-field"><span>Photo</span><span className="capture-photo-control">{entry.photo_preview ? <img src={entry.photo_preview} alt="New item preview" /> : <Icon name="camera" size={23} />}<strong>{entry.photo_file ? "Change photo" : "Take or choose photo"}</strong><input type="file" accept="image/*" capture="environment" onChange={(event) => { const file = event.target.files?.[0] || null; if (entry.photo_preview) URL.revokeObjectURL(entry.photo_preview); changeScannedEntry(entry.id, { photo_file: file, photo_preview: file ? URL.createObjectURL(file) : null }); }} /></span></label>
              <label>Name<input value={entry.name} onChange={(event) => changeScannedEntry(entry.id, { name: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveScannedEntry(entry, false, true); } }} placeholder="Item name" autoFocus={!entry.code} /></label>
              {entryCapabilities.identity && <label>Brand<input value={entry.brand} onChange={(event) => changeScannedEntry(entry.id, { brand: event.target.value })} placeholder="Optional" /></label>}
              {entryCapabilities.specs && <label>Model<input value={entry.model} onChange={(event) => changeScannedEntry(entry.id, { model: event.target.value })} placeholder="Optional" /></label>}
              <label>Quantity<input inputMode="decimal" value={entry.quantity} onChange={(event) => changeScannedEntry(entry.id, { quantity: event.target.value })} /></label>
              <label>Unit<select value={entry.unit} onChange={(event) => changeScannedEntry(entry.id, { unit: event.target.value })}>{Array.from(new Set([entry.unit, sessionDefaults.unit, ...units, "pcs", "box", "pack", "bag", "g", "kg", "ml", "l"])).filter(Boolean).map((unit) => <option value={unit} key={unit}>{unit}</option>)}</select></label>
              <div className="picker-field"><span>Category</span><button type="button" onClick={() => setPicker({ id: entry.id, type: "category" })}><Icon name="tag" size={15} /><strong>{entryCategory ? categoryOptionLabel(entryCategory) : "No category"}</strong></button></div>
              <div className="picker-field"><span>Put it in</span><button type="button" onClick={() => setPicker({ id: entry.id, type: "location" })}><Icon name="pin" size={15} /><strong>{entryLocation?.path || "Choose location"}</strong></button></div>
              {recentLocations.length > 0 && mode !== "putaway" && <div className="recent-location-row capture-recents"><small>Recent locations</small>{recentLocations.map((location) => <button type="button" key={location.public_id} onClick={() => changeScannedEntry(entry.id, { location_public_id: location.public_id })}>{location.name}</button>)}</div>}
              {entryCapabilities.expiration && <label>Expiration <small>(optional)</small><input type="date" value={entry.expiration_date} onChange={(event) => changeScannedEntry(entry.id, { expiration_date: event.target.value })} /></label>}
              <label>Low stock at<input inputMode="decimal" value={entry.low_stock_threshold} onChange={(event) => changeScannedEntry(entry.id, { low_stock_threshold: event.target.value })} placeholder="Optional" /></label>
              <label className="capture-description">Description<textarea rows={2} value={entry.description} onChange={(event) => changeScannedEntry(entry.id, { description: event.target.value })} placeholder="Notes, identifying details, condition…" /></label>
              {entryCapabilities.links && <label className="capture-description">Links<textarea rows={2} value={entry.links_value} onChange={(event) => changeScannedEntry(entry.id, { links_value: event.target.value })} placeholder="Manual | https://example.com/manual.pdf" /></label>}
            </div>;
            return <article className={`scan-entry ${entry.status}`} key={entry.id}>
              <div className="scan-entry-visual">{entry.photo_preview ? <img src={entry.photo_preview} alt={entry.name || "New item"} /> : entry.image_url ? <img src={entry.image_url} alt={entry.name || "Scanned product"} referrerPolicy="no-referrer" /> : <span><Icon name="box" size={28} /></span>}</div>
              <div className="scan-entry-main">
                <div className="scan-entry-top"><div><strong>{entry.name || "New item"}</strong><small>{entry.code || "Manual capture"}</small></div><button type="button" aria-label="Remove captured item" onClick={() => removeScannedEntry(entry.id)}><Icon name="close" size={16} /></button></div>
                <p className={`scan-entry-status ${entry.status === "error" ? "error" : ""}`}>{entry.status === "looking_up" ? "Looking up..." : entry.error || (entry.result?.found ? `${product?.brand || "Product"} recognized` : "Needs details")}</p>
                {existingItem ? <div className="scan-existing-item"><strong>Already in inventory</strong><span>{existingItem.quantity} {existingItem.unit} · {existingItem.location_path}</span><div><button type="button" className="secondary" disabled={busy || Number(existingItem.quantity) <= 0} onClick={() => void onAdjust(existingItem, -1)}><Icon name="minus" size={15} />1</button><button type="button" className="primary" disabled={busy} onClick={() => void onAdjust(existingItem, 1)}><Icon name="plus" size={15} />1</button><button type="button" onClick={() => void onOpenItem(existingItem.public_id)}>Open item</button></div></div> : reviewFields}
                {!existingItem && duplicateMatches.length > 0 && <div className="duplicate-suggestions"><strong>Possible duplicate{duplicateMatches.length === 1 ? "" : "s"}</strong>{duplicateMatches.map((item) => <button type="button" key={item.public_id} onClick={() => void onOpenItem(item.public_id)}><span>{item.name}</span><small>{item.quantity} {item.unit} · {item.location_path}</small></button>)}</div>}
                {product?.package_quantity && <small className="scan-product-note">Package: {product.package_quantity}</small>}
                {entry.image_url && <label className="scan-image-choice"><input type="checkbox" checked={entry.save_image} onChange={(event) => changeScannedEntry(entry.id, { save_image: event.target.checked })} />Save product image</label>}
                {!existingItem && <div className="capture-template-save"><input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Template name" aria-label="Template name" /><button type="button" disabled={!templateName.trim()} onClick={() => saveTemplate(entry)}>Save template</button></div>}
                <div className="scan-entry-actions"><button type="button" className="secondary" onClick={() => removeScannedEntry(entry.id)}>Remove</button>{!existingItem && <><button type="button" className="outline-button" disabled={busy || saving} onClick={() => void saveScannedEntry(entry, true)}>Inbox</button><button type="button" className="secondary" disabled={busy || saving || !entry.name.trim()} onClick={() => void saveScannedEntry(entry, false, true)}>Save + another</button><button type="button" className="primary" disabled={busy || saving || !entry.name.trim()} onClick={() => void saveScannedEntry(entry)}>{saving ? "Saving..." : "Save item"}</button></>}</div>
              </div>
            </article>;
          })}
        </div>
      </section>}
      {picker?.type === "location" && pickerEntry && <HierarchyPicker title="Choose location" nodes={locationNodes} selectedId={pickerEntry.location_public_id} emptyLabel="No child locations here" createPlaceholder="New location name" onChoose={(id) => changeScannedEntry(pickerEntry.id, { location_public_id: id })} onCreate={async (parentId, nextName) => (await onCreateLocation({ name: nextName, kind: "location", parent_public_id: parentId })).public_id} onClose={() => setPicker(null)} />}
      {picker?.type === "category" && pickerEntry && <HierarchyPicker title="Choose category" nodes={categoryNodes} selectedId={pickerEntry.category_id} emptyLabel="No child categories here" createPlaceholder="New category name" onChoose={(id) => chooseEntryCategory(pickerEntry.id, id)} onCreate={async (parentId, nextName) => String((await onCreateCategory(nextName, parentId ? Number(parentId) : null)).id)} onClose={() => setPicker(null)} />}
      {putawayPickerOpen && <HierarchyPicker title="Put everything here" nodes={locationNodes} selectedId={sessionDefaults.location_public_id} emptyLabel="No child locations here" chooseLabel="Use destination" currentChooseLabel="Use this destination" onChoose={setPutawayLocation} onClose={() => setPutawayPickerOpen(false)} />}
    </section>
  );
}

function CameraScanner({ videoRef, onCode }: { videoRef: MutableRefObject<HTMLVideoElement | null>; onCode: (code: string) => Promise<boolean | void> }) {
  const recentCodes = useRef<Map<string, number>>(new Map());
  const flashTimer = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const [available, setAvailable] = useState(true);
  const [flashCode, setFlashCode] = useState("");
  useEffect(() => {
    if (!active) return;
    if (!videoRef.current || !navigator.mediaDevices?.getUserMedia) {
      setAvailable(false);
      setActive(false);
      return;
    }
    let stopped = false;
    let controls: { stop: () => void } | null = null;
    void (async () => {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
      if (stopped || !videoRef.current) return;
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 250, delayBetweenScanSuccess: 400 });
      controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, videoRef.current, (result, _error, nextControls) => {
        const text = result?.getText().trim();
        if (!text || stopped) return;
        const now = Date.now();
        if (now - (recentCodes.current.get(text) || 0) < 1400) return;
        recentCodes.current.set(text, now);
        setFlashCode(text);
        if (flashTimer.current) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setFlashCode(""), 650);
        void onCode(text).then((shouldContinue) => {
          if (shouldContinue === false && !stopped) {
            stopped = true;
            nextControls.stop();
            setActive(false);
          }
        });
      });
      setAvailable(true);
    })().catch(() => {
      if (!stopped) {
        setAvailable(false);
        setActive(false);
      }
    });
    return () => {
      stopped = true;
      controls?.stop();
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    };
  }, [active]);
  return <div className={`camera-box ${active ? "active" : ""} ${flashCode ? "recognized" : ""}`}><video ref={videoRef} playsInline muted />{!active && <div className="camera-idle"><span><Icon name="scan" size={38} /></span><strong>Ready to scan</strong><small>Keep the code inside the frame</small></div>}{flashCode && <div className="scan-success"><Icon name="check" size={24} /><span>Added</span></div>}<div className="scan-frame" aria-hidden="true" /><button className={active ? "camera-stop" : "secondary button-with-icon"} onClick={() => { setAvailable(true); setActive(!active); }}>{active ? <><Icon name="close" size={17} />End session</> : <><Icon name="camera" size={17} />Open camera</>}</button>{!available && <small className="camera-warning">Camera access is blocked or unavailable. Try Snap code, or allow camera access in Safari.</small>}</div>;
}
