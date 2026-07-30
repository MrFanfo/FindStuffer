import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type Category,
  type Item,
  type OffCategoryMapping,
  type OffCategoryMappingImportResult,
} from "../../api";
import { EmptyState } from "../../components/EmptyState";
import { HierarchyPicker, categoryPickerNodes } from "../../components/HierarchyPicker";
import { Icon } from "../../components/Icon";
import { categoryLabel } from "../../domain/inventory";

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
