import { useEffect, useState, type FormEvent } from "react";
import {
  api, type Item, type OnlineSourcePreview, type OnlineSourceResult,
} from "../api";
import { Icon } from "./Icon";

type Mode = "manual" | "details";
const FIELD_LABELS: Record<string, string> = {
  name: "Name", brand: "Brand", model: "Model", description: "Description",
  barcode: "Barcode", weight_g: "Weight (g)", length_mm: "Length (mm)",
  width_mm: "Width (mm)", height_mm: "Height (mm)",
};
const FIELD_KEYS = Object.keys(FIELD_LABELS);

function sourceHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

function currentValue(item: Item, field: string): string | number | null | undefined {
  return item[field as keyof Item] as string | number | null | undefined;
}

export function OnlineLookupSession({ mode, title, items, onSaved, onClose }: {
  mode: Mode;
  title: string;
  items: Item[];
  onSaved: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [position, setPosition] = useState(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OnlineSourceResult[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [preview, setPreview] = useState<OnlineSourcePreview | null>(null);
  const [manualTitle, setManualTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saveSource, setSaveSource] = useState(true);
  const [searching, setSearching] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const item = items[position];

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setQuery("");
    setResults([]);
    setPreview(null);
    setSourceUrl("");
    setError("");
    setSearching(true);
    void api.onlineSources(item, mode).then((found) => {
      if (!cancelled) { setQuery(found.query); setResults(found.results); }
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Search unavailable. Paste a source URL.");
    }).finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [item?.public_id, mode]);

  function advance() {
    setPosition((value) => value + 1);
    setPreview(null);
    setSourceUrl("");
    setError("");
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!item || !query.trim()) return;
    setSearching(true);
    setPreview(null);
    setError("");
    try {
      const found = await api.onlineSources(item, mode, query);
      setResults(found.results);
      setQuery(found.query);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Search unavailable. Paste a source URL.");
    } finally {
      setSearching(false);
    }
  }

  async function inspect(url: string) {
    if (!item) return;
    setInspecting(true);
    setPreview(null);
    setSourceUrl(url);
    setError("");
    try {
      const found = await api.onlineSourcePreview(item, mode, url);
      setPreview(found);
      setSourceUrl(found.source_url);
      setManualTitle(mode === "manual"
        ? `${item.brand ? `${item.brand} ` : ""}${item.model || item.name} manual`
        : "");
      if (found.format === "product") {
        setSelected(FIELD_KEYS.filter((field) => found.fields[field] !== undefined
          && (currentValue(item, field) === null || currentValue(item, field) === "")));
        setSaveSource(item.links.length < 20 && !item.links.some((link) => link.url === found.source_url));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not inspect source.");
    } finally {
      setInspecting(false);
    }
  }

  async function saveManualPdf() {
    if (!item || !preview || preview.format !== "pdf") return;
    setSaving(true);
    setError("");
    try {
      await api.attachManualFromUrl(item, preview.source_url, manualTitle);
      await onSaved();
      advance();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not attach PDF.");
    } finally {
      setSaving(false);
    }
  }

  async function saveManualLink() {
    if (!item || !preview || preview.format !== "page") return;
    setSaving(true);
    setError("");
    try {
      if (!item.links.some((link) => link.url === preview.source_url)) {
        if (item.links.length >= 20) throw new Error("This item already has the maximum of 20 links.");
        await api.updateItem(item, {
          links: [...item.links, { label: manualTitle.trim() || "Manual", url: preview.source_url }],
        });
      }
      await onSaved();
      advance();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save manual link.");
    } finally {
      setSaving(false);
    }
  }

  async function saveDetails() {
    if (!item || !preview || preview.format !== "product") return;
    const changes: Record<string, unknown> = {};
    for (const field of selected) {
      if (FIELD_KEYS.includes(field) && preview.fields[field] !== undefined) {
        changes[field] = preview.fields[field];
      }
    }
    if (saveSource && !item.links.some((link) => link.url === preview.source_url)) {
      changes.links = [...item.links, {
        label: `Product source: ${sourceHost(preview.source_url)}`,
        url: preview.source_url,
      }];
    }
    if (Object.keys(changes).length === 0) return;
    setSaving(true);
    setError("");
    try {
      await api.updateItem(item, changes);
      await onSaved();
      advance();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save product details.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop online-lookup-backdrop" role="dialog" aria-modal="true" aria-label={mode === "manual" ? "Find a manual" : "Find item details"} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="online-lookup-sheet">
      <header><div><p className="eyebrow">{mode === "manual" ? "FIND A MANUAL" : "FIND DETAILS ONLINE"}</p><h2>{title}</h2><small>{item ? `${position + 1} of ${items.length}` : "Done"}</small></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close online lookup"><Icon name="close" /></button></header>
      {item ? <>
        <div className="online-lookup-item"><strong>{item.name}</strong><small>{[item.brand, item.model, item.location_path].filter(Boolean).join(" · ")}</small></div>
        <form className="online-lookup-search" onSubmit={(event) => void search(event)}>
          <label>Search terms<input value={query} maxLength={180} onChange={(event) => setQuery(event.target.value)} placeholder={mode === "manual" ? "Brand model user manual PDF" : "Brand model product specifications"} /></label>
          <button type="submit" className="secondary" disabled={searching || !query.trim()}>Search</button>
        </form>
        <div className="online-lookup-paste">
          <label>Or paste a {mode === "manual" ? "manual or PDF" : "product"} URL<input type="url" placeholder="https://…" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /></label>
          <button type="button" className="secondary" disabled={inspecting || !sourceUrl.trim()} onClick={() => void inspect(sourceUrl)}>Inspect URL</button>
        </div>
        {searching && <p role="status">Searching sources…</p>}
        {!searching && results.length > 0 && <div className="online-lookup-results"><strong>Search results</strong>{results.map((result) => <article key={result.url}><div><strong>{result.title}</strong><small>{result.domain}{result.is_pdf ? " · PDF" : ""}</small></div><button type="button" className="secondary" disabled={inspecting || saving} onClick={() => void inspect(result.url)}>Inspect</button><a href={result.url} target="_blank" rel="noreferrer">Open</a></article>)}</div>}
        {!searching && results.length === 0 && !error && <p>No results. Try different terms or paste a URL.</p>}
        {inspecting && <p role="status">Inspecting source…</p>}
        {preview && <section className="online-lookup-preview">
          <div className="online-lookup-preview-heading"><div><strong>{preview.title}</strong><small>{sourceHost(preview.source_url)} · {preview.format === "pdf" ? "PDF" : preview.format === "page" ? "Web guide" : "Product page"}</small></div><a href={preview.source_url} target="_blank" rel="noreferrer">Open source</a></div>
          {preview.format === "pdf" && <><p>Valid PDF · {Math.ceil(preview.size_bytes / 1024)} KB. Attach a copy to this item so it remains available here.</p><label>Document title<input value={manualTitle} maxLength={240} onChange={(event) => setManualTitle(event.target.value)} /></label><button type="button" className="primary" disabled={saving} onClick={() => void saveManualPdf()}>{saving ? "Attaching…" : "Attach PDF manual"}</button></>}
          {preview.format === "page" && <><p>This is a web guide. Save its link, or inspect a PDF found on the page.</p>{preview.pdf_links.length > 0 && <div className="online-lookup-pdf-links">{preview.pdf_links.map((link) => <button type="button" className="secondary" key={link.url} disabled={inspecting || saving} onClick={() => void inspect(link.url)}>{link.title || sourceHost(link.url)}</button>)}</div>}<label>Link title<input value={manualTitle} maxLength={240} onChange={(event) => setManualTitle(event.target.value)} /></label><button type="button" className="primary" disabled={saving} onClick={() => void saveManualLink()}>{saving ? "Saving…" : "Save manual link"}</button></>}
          {preview.format === "product" && <><p>{preview.exact_model ? "Check each field before saving." : "Model match is uncertain. Check this page carefully before saving."}{!preview.structured && " This page has limited product metadata."}</p><div className="online-lookup-fields">{FIELD_KEYS.filter((field) => preview.fields[field] !== undefined).map((field) => <label key={field}><input type="checkbox" checked={selected.includes(field)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, field] : current.filter((value) => value !== field))} /><span><strong>{FIELD_LABELS[field]}</strong><small>Current: {String(currentValue(item, field) ?? "empty")}</small><em>Suggested: {String(preview.fields[field])}</em></span></label>)}</div><label className="online-lookup-save-source"><input type="checkbox" checked={saveSource} disabled={item.links.length >= 20 || item.links.some((link) => link.url === preview.source_url)} onChange={(event) => setSaveSource(event.target.checked)} />Save source link with the item</label><button type="button" className="primary" disabled={saving || (selected.length === 0 && !saveSource)} onClick={() => void saveDetails()}>{saving ? "Saving…" : "Save selected details"}</button></>}
        </section>}
        {error && <p className="inline-alert" role="alert">{error}</p>}
        <footer><button type="button" className="secondary" disabled={saving} onClick={advance}>Skip item</button></footer>
      </> : <div className="photo-finder-done"><Icon name="check" size={32} /><strong>All items reviewed</strong><button type="button" className="primary" onClick={onClose}>Done</button></div>}
    </section>
  </div>;
}
