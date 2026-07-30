import { type CSSProperties, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  flattenLocations,
  type AIScanProposal,
  type Category,
  type Item,
  type LocationNode,
  type LocationRule,
  type OffCategoryMapping,
  type OffCategoryMappingImportResult,
} from "../../api";
import { EmptyState } from "../../components/EmptyState";
import { HierarchyPicker, categoryPickerNodes } from "../../components/HierarchyPicker";
import { Icon } from "../../components/Icon";
import { SearchableFilterPicker } from "../../components/SearchableFilterPicker";
import { categoryOptionLabel } from "../capture/itemCaptureUtils";

type RetryNotice = { action: () => Promise<void>; label: string; message: string };

function categoryLabel(item: Item): string {
  return item.category_path || item.category_name || "";
}

export function OffCategoryMappingsView({ categories, busy, onBack, onOpenItem, onNotice }: {
  categories: Category[];
  busy: boolean;
  onBack: () => void;
  onOpenItem: (item: Item) => void;
  onNotice: (message: string) => void;
}) {
  const [mappings, setMappings] = useState<OffCategoryMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "explicit" | "automatic" | "unmapped">("all");
  const [pickerTag, setPickerTag] = useState("");
  const [itemsTag, setItemsTag] = useState("");
  const [mappingItems, setMappingItems] = useState<Item[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [importPayload, setImportPayload] = useState<unknown>(null);
  const [importResult, setImportResult] = useState<OffCategoryMappingImportResult | null>(null);
  const categoryNodes = useMemo(() => categoryPickerNodes(categories), [categories]);
  const activeMapping = mappings.find((mapping) => mapping.off_tag === pickerTag) || null;
  const load = useCallback(async () => {
    try {
      const result = await api.offCategoryMappings();
      setMappings(result.mappings);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not load category mappings");
    } finally {
      setLoading(false);
    }
  }, [onNotice]);
  useEffect(() => { void load(); }, [load]);
  const visibleMappings = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return mappings.filter((mapping) => {
      if (scope !== "all" && mapping.mapping_source !== scope) return false;
      if (!term) return true;
      return [mapping.off_tag, mapping.label, mapping.effective_category?.path || ""]
        .join(" ").toLocaleLowerCase().includes(term);
    });
  }, [mappings, query, scope]);
  async function assign(offTag: string, categoryId: string) {
    try {
      await api.setOffCategoryMapping(offTag, Number(categoryId));
      setPickerTag("");
      await load();
      onNotice("Open Food Facts category assigned");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not save category mapping");
    }
  }
  async function clearAssignment(mapping: OffCategoryMapping) {
    try {
      await api.setOffCategoryMapping(mapping.off_tag, null);
      await load();
      onNotice("Explicit assignment removed; automatic mapping will be used");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not clear category mapping");
    }
  }
  async function showItems(mapping: OffCategoryMapping) {
    setItemsTag(mapping.off_tag);
    setItemsLoading(true);
    try {
      setMappingItems(await api.offCategoryMappingItems(mapping.off_tag));
    } catch (error) {
      setMappingItems([]);
      onNotice(error instanceof Error ? error.message : "Could not load matching items");
    } finally {
      setItemsLoading(false);
    }
  }
  async function downloadExport() {
    try {
      const payload = await api.exportOffCategoryMappings();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "findstuff-off-category-mappings.json";
      anchor.click();
      URL.revokeObjectURL(url);
      onNotice("Category mapping JSON exported");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not export mappings");
    }
  }
  async function readImport(file: File) {
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const result = await api.importOffCategoryMappings(payload);
      setImportPayload(payload);
      setImportResult(result);
    } catch (error) {
      setImportPayload(null);
      setImportResult(null);
      onNotice(error instanceof Error ? error.message : "Invalid category mapping JSON");
    }
  }
  async function applyImport() {
    if (!importPayload || !importResult || importResult.errors) return;
    try {
      const result = await api.importOffCategoryMappings(importPayload, true);
      setImportResult(result);
      setImportPayload(null);
      await load();
      onNotice(`${result.applied} category mappings imported`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not import mappings");
    }
  }
  return <section className="off-mapping-page">
    <div className="subpage-header"><button type="button" className="text-button" onClick={onBack}>Back to Settings</button><div><p className="eyebrow">OPEN FOOD FACTS</p><h1>Category mapping</h1><p>Every category observed during barcode scans appears here. Automatic matches can be overridden with your own category hierarchy.</p></div></div>
    <div className="mapping-actions"><button type="button" className="secondary button-with-icon" onClick={() => void downloadExport()}><Icon name="qr" size={16} />Export JSON</button><label className="upload-import compact-upload"><strong>Import mapping JSON</strong><input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void readImport(file); }} /></label></div>
    {importResult && <section className={`mapping-import-preview ${importResult.errors ? "has-errors" : ""}`}><div><strong>{importResult.errors ? "Import needs corrections" : "Import ready"}</strong><span>{importResult.ready} assignments · {importResult.errors} errors</span></div><div className="import-detail-list">{importResult.details.slice(0, 20).map((detail) => <article className={`import-detail ${detail.status}`} key={`${detail.index}-${detail.off_tag || "row"}`}><b>{detail.status}</b><div><strong>{detail.off_tag || `Row ${detail.index + 1}`}</strong><small>{detail.message}</small></div></article>)}</div><div className="button-row"><button type="button" onClick={() => { setImportPayload(null); setImportResult(null); }}>Cancel</button><button type="button" className="primary" disabled={Boolean(importResult.errors) || !importPayload} onClick={() => void applyImport()}>Apply import</button></div></section>}
    <div className="mapping-toolbar"><label className="search"><Icon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search OFF or Findstuff categories" /></label><div className="filter-row"><button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>All <span>{mappings.length}</span></button><button className={scope === "explicit" ? "active" : ""} onClick={() => setScope("explicit")}>Assigned <span>{mappings.filter((entry) => entry.mapping_source === "explicit").length}</span></button><button className={scope === "automatic" ? "active" : ""} onClick={() => setScope("automatic")}>Automatic <span>{mappings.filter((entry) => entry.mapping_source === "automatic").length}</span></button><button className={scope === "unmapped" ? "active" : ""} onClick={() => setScope("unmapped")}>Unmapped <span>{mappings.filter((entry) => entry.mapping_source === "unmapped").length}</span></button></div></div>
    <div className="mapping-list">
      {loading && <div className="empty-inline"><span>Loading observed categories…</span></div>}
      {!loading && visibleMappings.length === 0 && <EmptyState icon="tag" title={mappings.length ? "No mappings in this view" : "No Open Food Facts categories scanned yet"} text={mappings.length ? "Change the filter or search term." : "Scan a food barcode and its deepest category will appear here."} />}
      {visibleMappings.map((mapping) => <article className="mapping-card compact" key={mapping.off_tag}>
        <div className="mapping-source"><strong>{mapping.label}</strong><code>{mapping.off_tag}</code></div>
        <button type="button" className="mapping-target" disabled={busy} onClick={() => setPickerTag(mapping.off_tag)}><span>Our category</span><strong>{mapping.effective_category?.path || "Click to assign"}</strong></button>
        <span className={`status-badge ${mapping.mapping_source === "unmapped" ? "warning" : mapping.mapping_source === "explicit" ? "active" : "quiet"}`}>{mapping.mapping_source === "explicit" ? "manual" : mapping.mapping_source}</span>
        <button type="button" className="mapping-see-items" onClick={() => void showItems(mapping)}>See items</button>
        {mapping.explicit_category && <button type="button" className="mapping-auto-reset" disabled={busy} onClick={() => void clearAssignment(mapping)} title="Remove the manual override">Use automatic</button>}
      </article>)}
    </div>
    {activeMapping && <HierarchyPicker title={`Map ${activeMapping.label}`} nodes={categoryNodes} selectedId={String(activeMapping.effective_category?.id || "")} emptyLabel="No child categories here" chooseLabel="Assign" currentChooseLabel="Assign this category" onChoose={(id) => void assign(activeMapping.off_tag, id)} onClose={() => setPickerTag("")} />}
    {itemsTag && <div className="modal-backdrop picker-backdrop" role="dialog" aria-modal="true" aria-label="Items in Open Food Facts category" onMouseDown={(event) => { if (event.target === event.currentTarget) setItemsTag(""); }}><article className="picker-sheet mapping-items-sheet"><header><button className="icon-button" type="button" onClick={() => setItemsTag("")} aria-label="Close"><Icon name="close" /></button><div><h2>Items tagged {mappings.find((entry) => entry.off_tag === itemsTag)?.label || itemsTag}</h2><small>{mappingItems.length} matching item{mappingItems.length === 1 ? "" : "s"}</small></div></header><div className="picker-list">{itemsLoading && <div className="empty-inline"><span>Loading items…</span></div>}{!itemsLoading && mappingItems.length === 0 && <div className="empty-inline"><span>No saved items currently use this barcode category.</span></div>}{mappingItems.map((item) => <button type="button" className="mapping-item-row" key={item.public_id} onClick={() => { setItemsTag(""); onOpenItem(item); }}><span><strong>{item.name}</strong><small>{categoryLabel(item) || "Uncategorised"} · {item.location_path}</small></span><Icon name="chevron" size={16} /></button>)}</div></article></div>}
  </section>;
}

function AIScanProposalCard({ scan, categories, locations, units, busy, onSave, onApprove, onReject, onRetry }: {
  scan: AIScanProposal;
  categories: Category[];
  locations: LocationNode[];
  units: string[];
  busy: boolean;
  onSave: (changes: Record<string, unknown>) => Promise<void>;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onRetry: () => Promise<void>;
}) {
  const item = scan.proposal?.item;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item?.name || "");
  const [description, setDescription] = useState(item?.description || "");
  const [notes, setNotes] = useState(item?.notes || "");
  const [brand, setBrand] = useState(item?.brand || "");
  const [model, setModel] = useState(item?.model || "");
  const [barcode, setBarcode] = useState(item?.barcode || "");
  const [quantity, setQuantity] = useState(item?.quantity || "1");
  const [unit, setUnit] = useState(item?.unit || "pcs");
  const [categoryId, setCategoryId] = useState(item?.category_id ? String(item.category_id) : "");
  const [locationId, setLocationId] = useState(scan.location_public_id);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeSettling, setSwipeSettling] = useState(false);
  const swipeOffsetRef = useRef(0);
  const swipeFrame = useRef<number | null>(null);
  const swipeStart = useRef<{ x: number; y: number; pointerId: number; axis: "x" | "y" | null } | null>(null);
  const category = item?.category_id ? categories.find((entry) => entry.id === item.category_id) : null;

  useEffect(() => () => {
    if (swipeFrame.current !== null) window.cancelAnimationFrame(swipeFrame.current);
  }, []);

  useEffect(() => {
    if (editing || !item) return;
    setName(item.name);
    setDescription(item.description);
    setNotes(item.notes);
    setBrand(item.brand);
    setModel(item.model);
    setBarcode(item.barcode);
    setQuantity(item.quantity);
    setUnit(item.unit);
    setCategoryId(item.category_id ? String(item.category_id) : "");
    setLocationId(scan.location_public_id);
  }, [editing, item, scan.location_public_id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    await onSave({
      name,
      description,
      notes,
      brand,
      model,
      barcode,
      quantity,
      unit,
      category_id: categoryId ? Number(categoryId) : null,
      location_public_id: locationId,
    });
    setEditing(false);
  }

  function moveSwipe(offset: number) {
    swipeOffsetRef.current = offset;
    if (swipeFrame.current !== null) window.cancelAnimationFrame(swipeFrame.current);
    swipeFrame.current = window.requestAnimationFrame(() => {
      setSwipeOffset(offset);
      swipeFrame.current = null;
    });
  }

  function finishSwipe() {
    const offset = swipeOffsetRef.current;
    const threshold = Math.min(110, Math.max(76, window.innerWidth * 0.2));
    const action = offset > threshold ? onApprove : offset < -threshold ? onReject : null;
    const direction = offset > 0 ? 1 : -1;
    swipeStart.current = null;
    if (action && scan.status === "pending" && !busy && !editing) {
      setSwipeSettling(true);
      moveSwipe(direction * Math.max(window.innerWidth, 520));
      window.setTimeout(() => {
        void action().finally(() => {
          moveSwipe(0);
          setSwipeSettling(false);
        });
      }, 180);
      return;
    }
    setSwipeSettling(true);
    moveSwipe(0);
    window.setTimeout(() => setSwipeSettling(false), 180);
  }

  return <div
    className={`ai-swipe-shell ${swipeOffset > 0 ? "swiping-right" : swipeOffset < 0 ? "swiping-left" : ""}`}
    style={{ "--swipe-offset": `${swipeOffset}px`, "--swipe-opacity": Math.min(1, Math.abs(swipeOffset) / 70) } as CSSProperties}
  >
    <div className="ai-swipe-underlay approve" aria-hidden="true"><Icon name="check" size={24} /><strong>Approve</strong></div>
    <div className="ai-swipe-underlay reject" aria-hidden="true"><Icon name="close" size={24} /><strong>Reject</strong></div>
    <article
      className={`ai-proposal-card ${scan.status} ${swipeSettling ? "swipe-settling" : ""}`}
      onPointerDown={(event) => {
        if (editing || scan.status !== "pending" || busy || swipeSettling || !event.isPrimary) return;
        if (event.target instanceof Element && event.target.closest("button, input, select, textarea, label, a")) return;
        swipeStart.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, axis: null };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = swipeStart.current;
        if (!start || start.pointerId !== event.pointerId || editing || scan.status !== "pending") return;
        const x = event.clientX - start.x;
        const y = event.clientY - start.y;
        if (!start.axis && Math.max(Math.abs(x), Math.abs(y)) > 8) start.axis = Math.abs(x) > Math.abs(y) + 4 ? "x" : "y";
        if (start.axis === "x") {
          event.preventDefault();
          const resistance = 1 - Math.min(0.28, Math.abs(x) / Math.max(window.innerWidth, 1) * 0.28);
          moveSwipe(Math.max(-180, Math.min(180, x * resistance)));
        }
      }}
      onPointerUp={(event) => {
        if (swipeStart.current?.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        finishSwipe();
      }}
      onPointerCancel={() => { moveSwipe(0); swipeStart.current = null; }}
    >
      <div className="ai-proposal-photo">
        <img src={scan.photo_url} alt={item?.name || "Scanned Item"} />
        <span>{scan.status === "processing" ? "AI processing" : scan.status === "failed" ? "Needs attention" : `${Math.round((scan.proposal?.confidence || 0) * 100)}% confidence`}</span>
      </div>
      <div className="ai-proposal-main">
        {scan.status === "processing" && <>
          <div className="ai-proposal-context single"><span><Icon name="pin" size={17} /><small>Place</small><strong>{scan.location_path}</strong></span></div>
          <div className="ai-proposal-wait"><strong>Analyzing photo…</strong><small>You can leave this page while AI works.</small></div>
        </>}
        {scan.status === "failed" && <>
          <div className="ai-proposal-context single"><span><Icon name="pin" size={17} /><small>Place</small><strong>{scan.location_path}</strong></span></div>
          <div className="ai-proposal-wait error"><strong>Scan could not be analyzed</strong><small>{scan.error || "The AI provider did not return a result."}</small><div><button className="primary" disabled={busy} onClick={() => void onRetry()}>Retry</button><button disabled={busy} onClick={() => void onReject()}>Reject</button></div></div>
        </>}
        {scan.status === "pending" && item && <>
          {!editing ? <>
            <div className="ai-item-identity"><small>Suggested Item</small><h2>{item.name}</h2></div>
            <div className="ai-proposal-context">
              <span><Icon name="pin" size={17} /><small>Place</small><strong>{scan.location_path}</strong></span>
              <span><Icon name="tag" size={17} /><small>Category</small><strong>{category?.path || "Uncategorized"}</strong></span>
            </div>
            <div className="ai-item-details">
              <small className="ai-section-label">Item details</small>
              <div className="ai-proposal-facts">
                <span><small>Quantity</small><strong>{item.quantity} {item.unit}</strong></span>
                {item.brand && <span><small>Brand</small><strong>{item.brand}</strong></span>}
                {item.model && <span><small>Model</small><strong>{item.model}</strong></span>}
                {item.barcode && <span><small>Barcode</small><strong>{item.barcode}</strong></span>}
              </div>
              {item.description && <p>{item.description}</p>}
              {item.notes && <div className="ai-item-specifications"><small>Specifications</small>{item.notes.split("\n").filter(Boolean).map((line) => <span key={line}>{line}</span>)}</div>}
              {scan.proposal?.research?.url && <a href={scan.proposal.research.url} target="_blank" rel="noreferrer">{scan.proposal.research.label}</a>}
              {scan.proposal?.warnings.map((warning) => <em key={warning}>{warning}</em>)}
            </div>
          </> : <form className="ai-proposal-form" onSubmit={save}>
            <div className="ai-edit-heading"><strong>Edit suggestion</strong><small>Nothing is saved as an Item until you approve it.</small></div>
            <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
            <div className="form-row"><label>Brand<input value={brand} onChange={(event) => setBrand(event.target.value)} /></label><label>Model<input value={model} onChange={(event) => setModel(event.target.value)} /></label></div>
            <div className="form-row"><label>Quantity<input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label>Unit<select value={unit} onChange={(event) => setUnit(event.target.value)}>{Array.from(new Set([unit, ...units, "pcs"])).map((entry) => <option value={entry} key={entry}>{entry}</option>)}</select></label></div>
            <label>Category<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Uncategorized</option>{categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.path}</option>)}</select></label>
            <label>Place<select value={locationId} onChange={(event) => setLocationId(event.target.value)}>{locations.map((entry) => <option key={entry.public_id} value={entry.public_id}>{entry.path}</option>)}</select></label>
            <label>Barcode<input inputMode="numeric" value={barcode} onChange={(event) => setBarcode(event.target.value)} /></label>
            <label>Description<textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <label>Specifications<textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Material: Steel&#10;Size: 10 mm" /></label>
            <div className="button-row"><button type="button" onClick={() => setEditing(false)}>Cancel</button><button className="secondary" disabled={busy || !name.trim()}>Save changes</button></div>
          </form>}
          {!editing && <>
            <small className="ai-swipe-help">Swipe left to reject · right to approve</small>
            <div className="ai-proposal-actions">
              <button disabled={busy} onClick={() => void onReject()}><Icon name="close" size={16} />Reject</button>
              <button className="secondary" disabled={busy} onClick={() => setEditing(true)}><Icon name="settings" size={16} />Edit</button>
              <button className="primary" disabled={busy} onClick={() => void onApprove()}><Icon name="check" size={16} />Approve</button>
            </div>
          </>}
        </>}
      </div>
    </article>
  </div>;
}

export function AIScanInboxView({ categories, locations, units, busy, onBack, onInventoryChanged, notify }: {
  categories: Category[];
  locations: LocationNode[];
  units: string[];
  busy: boolean;
  onBack: () => void;
  onInventoryChanged: () => Promise<void>;
  notify: (message: string, action?: Omit<RetryNotice, "message">) => void;
}) {
  const [scans, setScans] = useState<AIScanProposal[]>([]);
  const [reviewBusy, setReviewBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const load = useCallback(async () => {
    try {
      setScans(await api.aiScans());
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load the AI Inbox");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);
  const processing = scans.some((scan) => scan.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [load, processing]);

  async function performScan(
    action: () => Promise<unknown>,
    success: string,
    inventoryChanged = false,
  ) {
    setReviewBusy("Updating Inbox…");
    try {
      await action();
      notify(success);
      await load();
      if (inventoryChanged) await onInventoryChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The AI scan action could not be completed");
    } finally {
      setReviewBusy("");
    }
  }

  async function approveScan(scan: AIScanProposal) {
    if (scan.status !== "pending" || reviewBusy) return;
    setReviewBusy("Approving Item…");
    try {
      const created = await api.approveAiScan(scan.public_id);
      await load();
      await onInventoryChanged();
      notify(`${created.name} approved`, {
        label: "Undo",
        action: async () => {
          const current = await api.item(created.public_id);
          await api.archive(current);
          await load();
          await onInventoryChanged();
          notify(`${created.name} approval undone`);
        },
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Item could not be approved");
      await load();
      await onInventoryChanged();
    } finally {
      setReviewBusy("");
    }
  }

  const orderedScans = useMemo(() => [...scans].sort((left, right) => {
    const priority = { pending: 0, failed: 1, processing: 2 } as Record<string, number>;
    return (priority[left.status] ?? 3) - (priority[right.status] ?? 3);
  }), [scans]);
  const currentScan = orderedScans[0] || null;
  return <section className="ai-inbox-page">
    <div className="ai-inbox-nav">
      <button type="button" className="ai-inbox-back" onClick={onBack}><Icon name="chevron" size={17} />Back</button>
      {orderedScans.length > 1 && <span>{orderedScans.length} remaining</span>}
    </div>
    {loading && <div className="inline-activity" role="status"><span className="activity-spinner" />Loading Inbox…</div>}
    {!loading && scans.length === 0 && <EmptyState icon="spark" title="Your Inbox is clear" text="New AI Scan results will appear here automatically." />}
    {currentScan && <div className="ai-card-stage">
      {reviewBusy && <div className="ai-review-progress" role="status"><span className="activity-spinner" />{reviewBusy}</div>}
      <AIScanProposalCard
        key={currentScan.public_id}
        scan={currentScan}
        categories={categories}
        locations={flatLocations}
        units={units}
        busy={busy || Boolean(reviewBusy)}
        onSave={(changes) => performScan(() => api.updateAiScan(currentScan.public_id, changes), "AI scan proposal updated")}
        onApprove={() => approveScan(currentScan)}
        onReject={() => performScan(() => api.rejectAiScan(currentScan.public_id), "AI scan proposal rejected")}
        onRetry={() => performScan(() => api.retryAiScan(currentScan.public_id), "AI scan queued again")}
      />
    </div>}
  </section>;
}

type LocationRuleDraft = {
  rule_type: "name" | "barcode" | "category";
  match_value: string;
  location_public_id: string;
  priority: string;
  enabled: boolean;
};

export function DefaultRulesView({ locations, categories, busy, onBack, onChanged, notify }: {
  locations: LocationNode[];
  categories: Category[];
  busy: boolean;
  onBack: () => void;
  onChanged: () => Promise<void>;
  notify: (message: string, action?: Omit<RetryNotice, "message">) => void;
}) {
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const [rules, setRules] = useState<LocationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | LocationRule["rule_type"]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorPicker, setEditorPicker] = useState<"category" | "location" | null>(null);
  const [draft, setDraft] = useState<LocationRuleDraft>({
    rule_type: "name",
    match_value: "",
    location_public_id: flatLocations[0]?.public_id || "unassigned",
    priority: "100",
    enabled: true,
  });

  const loadRules = useCallback(async () => {
    try {
      setError("");
      setRules(await api.locationRules());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load default rules");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void loadRules(); }, [loadRules]);

  const selectedRule = rules.find((rule) => rule.public_id === selectedId) || null;
  const filteredRules = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return rules.filter((rule) => {
      if (typeFilter !== "all" && rule.rule_type !== typeFilter) return false;
      if (statusFilter === "enabled" && !rule.enabled) return false;
      if (statusFilter === "disabled" && rule.enabled) return false;
      if (locationFilter !== "all" && rule.location_public_id !== locationFilter) return false;
      if (!search) return true;
      const location = flatLocations.find((entry) => entry.public_id === rule.location_public_id);
      return [rule.match_value, rule.rule_type, rule.location_name, location?.path || "", String(rule.priority)]
        .some((value) => value.toLocaleLowerCase().includes(search));
    });
  }, [flatLocations, locationFilter, query, rules, statusFilter, typeFilter]);
  const hasFilters = Boolean(query.trim() || typeFilter !== "all" || statusFilter !== "all" || locationFilter !== "all");

  function startCreate() {
    setSelectedId("");
    setDraft({
      rule_type: "name",
      match_value: "",
      location_public_id: flatLocations[0]?.public_id || "unassigned",
      priority: "100",
      enabled: true,
    });
    setEditorMode("create");
  }

  function startEdit(rule: LocationRule) {
    setDraft({
      rule_type: rule.rule_type,
      match_value: rule.match_value,
      location_public_id: rule.location_public_id,
      priority: String(rule.priority),
      enabled: rule.enabled,
    });
    setEditorMode("edit");
  }

  async function saveRule(event: FormEvent) {
    event.preventDefault();
    const matchValue = draft.match_value.trim();
    const priority = Number(draft.priority);
    if (!matchValue || !draft.location_public_id || !Number.isInteger(priority) || priority < 0 || priority > 10000) return;
    setSaving(true);
    try {
      const body = {
        rule_type: draft.rule_type,
        match_value: matchValue,
        location_public_id: draft.location_public_id,
        priority,
        enabled: draft.enabled,
      };
      const saved = editorMode === "edit" && selectedRule
        ? await api.updateLocationRule(selectedRule.public_id, body)
        : await api.createLocationRule(body);
      await loadRules();
      await onChanged();
      setSelectedId(saved.public_id);
      setEditorMode(null);
      notify(editorMode === "edit" ? "Default rule updated" : "Default rule created");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Could not save default rule");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule(rule: LocationRule) {
    if (!window.confirm(`Delete this default rule?\n\n${rule.match_value} → ${rule.location_name}`)) return;
    setSaving(true);
    try {
      await api.deleteLocationRule(rule.public_id);
      setSelectedId("");
      await loadRules();
      await onChanged();
      notify("Default rule deleted");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Could not delete default rule");
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule: LocationRule) {
    setSaving(true);
    try {
      const updated = await api.updateLocationRule(rule.public_id, { enabled: !rule.enabled });
      setRules((current) => current.map((entry) => entry.public_id === updated.public_id ? updated : entry));
      await onChanged();
      notify(updated.enabled ? "Default rule enabled" : "Default rule disabled");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Could not update default rule");
    } finally {
      setSaving(false);
    }
  }

  function ruleDescription(rule: LocationRule): string {
    if (rule.rule_type === "barcode") return `An Item with barcode ${rule.match_value} goes to this Place. Barcode matches are exact.`;
    if (rule.rule_type === "category") return `Items in ${rule.match_value}, including its child Categories, go to this Place.`;
    return `An Item whose name contains “${rule.match_value}” goes to this Place. Matching ignores letter case.`;
  }

  const selectedLocation = selectedRule
    ? flatLocations.find((entry) => entry.public_id === selectedRule.location_public_id) || null
    : null;

  return <section className="default-rules-page">
    <header className="default-rules-header">
      <button type="button" className="text-button" onClick={onBack}><Icon name="chevron" size={16} />Back to More</button>
      <div><p className="eyebrow">DEFAULT LOCATIONS</p><h1>Default rules</h1><span>Choose where matching Items should go automatically.</span></div>
      <button type="button" className="primary button-with-icon" onClick={startCreate}><Icon name="plus" size={16} />New rule</button>
    </header>

    <div className="default-rules-toolbar">
      <label className="default-rules-search"><Icon name="search" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search rules or Places" aria-label="Search default rules" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear rule search"><Icon name="close" size={14} /></button>}</label>
      <label><span>Type</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}><option value="all">All types</option><option value="name">Item name</option><option value="barcode">Barcode</option><option value="category">Category</option></select></label>
      <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">Any status</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></label>
      <label><span>Place</span><select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="all">Every Place</option>{flatLocations.map((location) => <option value={location.public_id} key={location.public_id}>{location.path}</option>)}</select></label>
      {hasFilters && <button type="button" className="outline-button" onClick={() => { setQuery(""); setTypeFilter("all"); setStatusFilter("all"); setLocationFilter("all"); }}>Clear filters</button>}
    </div>

    <div className={`default-rules-layout ${selectedRule ? "has-detail" : ""}`}>
      <div className="default-rule-list-pane">
        <div className="default-rule-list-summary"><strong>{filteredRules.length} rule{filteredRules.length === 1 ? "" : "s"}</strong><small>{rules.length} total</small></div>
        {loading && <div className="inline-activity"><span className="activity-spinner" />Loading rules…</div>}
        {error && <div className="inline-alert">{error}<button type="button" onClick={() => void loadRules()}>Try again</button></div>}
        {!loading && !error && filteredRules.length === 0 && <EmptyState icon="filter" title={rules.length ? "No matching rules" : "No default rules yet"} text={rules.length ? "Try clearing one of the filters." : "Create a rule to automatically suggest a Place."} />}
        <div className="default-rule-list">
          {filteredRules.map((rule) => {
            const location = flatLocations.find((entry) => entry.public_id === rule.location_public_id);
            return <button type="button" className={`${selectedId === rule.public_id ? "selected" : ""} ${rule.enabled ? "" : "disabled"}`} key={rule.public_id} onClick={() => setSelectedId(rule.public_id)}>
              <span className="default-rule-type"><Icon name={rule.rule_type === "category" ? "tag" : rule.rule_type === "barcode" ? "qr" : "search"} size={17} /></span>
              <span className="default-rule-copy"><small>{rule.rule_type === "name" ? "ITEM NAME" : rule.rule_type.toUpperCase()}</small><strong>{rule.match_value}</strong><em><Icon name="pin" size={12} />{location?.path || rule.location_name}</em></span>
              <span className={`rule-state ${rule.enabled ? "ready" : ""}`}>{rule.enabled ? "On" : "Off"}</span>
              <Icon name="chevron" size={15} />
            </button>;
          })}
        </div>
      </div>

      {selectedRule ? <aside className="default-rule-detail">
        <button type="button" className="default-rule-mobile-back" onClick={() => setSelectedId("")}><Icon name="chevron" size={15} />All rules</button>
        <div className="default-rule-detail-heading"><span><Icon name={selectedRule.rule_type === "category" ? "tag" : selectedRule.rule_type === "barcode" ? "qr" : "search"} size={20} /></span><div><small>{selectedRule.rule_type === "name" ? "ITEM NAME RULE" : `${selectedRule.rule_type.toUpperCase()} RULE`}</small><h2>{selectedRule.match_value}</h2></div><b className={`integration-status ${selectedRule.enabled ? "ready" : ""}`}>{selectedRule.enabled ? "Enabled" : "Disabled"}</b></div>
        <p>{ruleDescription(selectedRule)}</p>
        <div className="default-rule-route"><div><span>When this matches</span><strong>{selectedRule.match_value}</strong></div><Icon name="chevron" /><div><span>Send to</span><strong>{selectedLocation?.path || selectedRule.location_name}</strong></div></div>
        <dl className="default-rule-facts"><div><dt>Match type</dt><dd>{selectedRule.rule_type}</dd></div><div><dt>Priority</dt><dd>{selectedRule.priority} · tie-breaker</dd></div><div><dt>Place</dt><dd>{selectedLocation?.path || selectedRule.location_name}</dd></div><div><dt>Status</dt><dd>{selectedRule.enabled ? "Enabled" : "Disabled"}</dd></div></dl>
        <small className="default-rule-priority-note">You normally do not need to change priority. It only decides between equally specific matching rules; the higher number wins.</small>
        <details className="nested-form default-rule-technical"><summary>Technical details</summary><div><span>Rule ID</span><code>{selectedRule.public_id}</code><small>Internal identifier used by the app and API. You do not need to manage it.</small></div></details>
        <div className="default-rule-detail-actions"><button type="button" className="primary" disabled={busy || saving} onClick={() => startEdit(selectedRule)}><Icon name="settings" size={15} />Edit rule</button><button type="button" className="secondary" disabled={busy || saving} onClick={() => void toggleRule(selectedRule)}>{selectedRule.enabled ? "Disable" : "Enable"}</button><button type="button" className="danger-button" disabled={busy || saving} onClick={() => void deleteRule(selectedRule)}><Icon name="close" size={14} />Delete</button></div>
      </aside> : <aside className="default-rule-detail-empty"><span><Icon name="settings" size={25} /></span><h2>Select a rule</h2><p>Its match behavior, destination, priority, and controls will appear here.</p></aside>}
    </div>

    {editorMode && <div className="rule-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditorMode(null); }}><form className="rule-editor-sheet" onSubmit={saveRule}>
      <header><div><p className="eyebrow">{editorMode === "edit" ? "EDIT DEFAULT" : "NEW DEFAULT"}</p><h2>{editorMode === "edit" ? "Modify rule" : "Create a rule"}</h2></div><button type="button" className="icon-button" onClick={() => setEditorMode(null)} aria-label="Close rule editor"><Icon name="close" /></button></header>
      <label>Match type<select value={draft.rule_type} onChange={(event) => { const ruleType = event.target.value as LocationRuleDraft["rule_type"]; setDraft((current) => ({ ...current, rule_type: ruleType, match_value: "", priority: editorMode === "create" ? ruleType === "barcode" ? "500" : "100" : current.priority })); if (ruleType === "category") setEditorPicker("category"); }}><option value="name">Item name contains</option><option value="barcode">Exact barcode</option><option value="category">Category or child Category</option></select></label>
      {draft.rule_type === "category" ? <div className="picker-field rule-editor-picker-field"><span>Category or child Category</span><button type="button" onClick={() => setEditorPicker("category")}><Icon name="tag" size={16} /><strong>{draft.match_value || "Choose a Category"}</strong><Icon name="chevron" size={15} /></button><small>Matches the selected Category and all Categories below it.</small></div> : <label>Match value<input required autoFocus inputMode={draft.rule_type === "barcode" ? "numeric" : "text"} value={draft.match_value} onChange={(event) => setDraft((current) => ({ ...current, match_value: event.target.value }))} placeholder={draft.rule_type === "barcode" ? "807680…" : "pasta, cable, ESP32…"} /><small>{draft.rule_type === "barcode" ? "Must match the barcode exactly." : "Matches anywhere in the Item name, ignoring case."}</small></label>}
      <div className="picker-field rule-editor-picker-field"><span>Destination Place</span><button type="button" onClick={() => setEditorPicker("location")}><Icon name="pin" size={16} /><strong>{flatLocations.find((location) => location.public_id === draft.location_public_id)?.path || "Choose a Place"}</strong><Icon name="chevron" size={15} /></button></div>
      <label className="toggle rule-enabled-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} /><span><strong>Enabled</strong><small>Use this rule for suggestions</small></span></label>
      <details className="nested-form rule-editor-advanced"><summary>Advanced</summary><div><label>Priority<input required type="number" min="0" max="10000" value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))} /><small>Only a tie-breaker between equally specific matches. Higher wins; most users can leave this unchanged.</small></label></div></details>
      <div className="button-row"><button type="button" onClick={() => setEditorMode(null)}>Cancel</button><button className="primary" disabled={busy || saving || !draft.match_value.trim() || !draft.location_public_id}>{saving ? "Saving…" : editorMode === "edit" ? "Save changes" : "Create rule"}</button></div>
    </form></div>}
    {editorPicker === "category" && <SearchableFilterPicker title="Choose a Category" icon="tag" selectedId={String(categories.find((category) => categoryOptionLabel(category) === draft.match_value)?.id || "")} emptyLabel="No Category selected" emptyDetail="Return without choosing" contextLabel="DEFAULT RULE" topLayer options={categories.map((category) => ({ id: String(category.id), label: category.name, detail: category.path }))} onChoose={(id) => { const category = categories.find((entry) => String(entry.id) === id); if (category) setDraft((current) => ({ ...current, match_value: categoryOptionLabel(category) })); }} onClose={() => setEditorPicker(null)} />}
    {editorPicker === "location" && <SearchableFilterPicker title="Choose destination Place" icon="pin" selectedId={draft.location_public_id} emptyLabel="No Place selected" emptyDetail="Return without choosing" contextLabel="DEFAULT RULE" topLayer options={flatLocations.map((location) => ({ id: location.public_id, label: location.name, detail: location.path }))} onChoose={(id) => { if (id) setDraft((current) => ({ ...current, location_public_id: id })); }} onClose={() => setEditorPicker(null)} />}
  </section>;
}
