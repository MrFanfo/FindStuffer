import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  flattenLocations,
  type ApplicationSettings,
  type Category,
  type ImportBatch,
  type ImportPreviewDetail,
  type LocationNode,
  type LocationType,
} from "../../api";
import { Icon } from "../../components/Icon";

export function DataView({ categories, locations, locationTypes, units, busy, onBack, onChanged, setNotice }: {
  categories: Category[];
  locations: LocationNode[];
  locationTypes: LocationType[];
  units: string[];
  busy: boolean;
  onBack: () => void;
  onChanged: () => Promise<void>;
  setNotice: (message: string) => void;
}) {
  const [settings, setSettings] = useState<ApplicationSettings | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [payload, setPayload] = useState<unknown>(null);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [details, setDetails] = useState<ImportPreviewDetail[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [activity, setActivity] = useState("");
  const restoreInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [nextSettings, nextBatches] = await Promise.all([api.settings(), api.importBatches()]);
      setSettings(nextSettings);
      setBatches(nextBatches);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load data tools");
    }
  }, [setNotice]);
  useEffect(() => { void load(); }, [load]);

  async function download(path: string, filename: string, label: string) {
    setActivity(`Preparing ${label.toLowerCase()}…`);
    try {
      const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(body?.detail || `${label} could not be prepared`);
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
      setNotice(`${label} downloaded`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${label} failed`);
    } finally { setActivity(""); }
  }

  async function restore(file: File) {
    if (!window.confirm("Restore this full backup? Current data and photos will be replaced. Findstuff creates a safety backup first, then restarts.")) return;
    setActivity(`Validating ${file.name}…`);
    try {
      await api.restoreBackup(file);
      setNotice("Backup validated. Findstuff is restarting…");
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        try {
          const status = await api.restoreStatus();
          if (status.status === "complete") { window.location.reload(); return; }
          if (status.status === "failed") { setNotice(`Restore failed safely: ${status.message}`); return; }
        } catch { /* A brief disconnect is expected during restart. */ }
      }
      setNotice("Restore is still running. Reload after the container finishes restarting.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not restore this backup");
    } finally { setActivity(""); }
  }

  async function preview(file: File) {
    setActivity(`Checking ${file.name}…`);
    try {
      const nextPayload = JSON.parse(await file.text()) as unknown;
      const result = await api.importPreview(nextPayload);
      setPayload(nextPayload); setSummary(result.counts); setDetails(result.details || []); setErrors(result.errors || []);
      setNotice(result.errors?.length ? "Import needs fixes" : "Preview ready—nothing has changed yet");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid import file";
      setPayload(null); setSummary({}); setDetails([]); setErrors([message]); setNotice(message);
    } finally { setActivity(""); }
  }

  async function merge() {
    if (!payload) return;
    setActivity("Merging reviewed changes…");
    try {
      const result = await api.importMerge(payload);
      setSummary(result.created); setErrors(result.errors || []);
      await onChanged(); await load();
      if (!result.errors?.length) { setPayload(null); setSummary(null); setDetails([]); setErrors([]); }
      setNotice(result.errors?.length ? `Import finished with ${result.errors.length} issue(s)` : "Import merged—undo is available below");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Import failed"]); setNotice("Import needs fixes");
    } finally { setActivity(""); }
  }

  async function undo(batch: ImportBatch) {
    if (batch.undone_at || !window.confirm("Undo this import? Only changes tracked for this import will be reversed.")) return;
    setActivity("Undoing import…");
    try { await api.undoImport(batch.public_id); await onChanged(); await load(); setNotice("Import undone"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not undo import"); }
    finally { setActivity(""); }
  }

  function template() {
    const document = {
      format: "findstuff-ops-v1",
      instructions: {
        purpose: "Give this document and your requested changes to a chatbot. Return only valid JSON with this format and an operations array.",
        safety: "Use full category and location paths when a leaf name may appear in more than one subtree. Preview in Findstuff before merging.",
        operation: { op: ["add", "modify", "delete"], type: ["item", "category", "location"], match: "Use id, public_id, path, barcode, or an unambiguous name", data: "Fields to create or change" },
        examples: [
          { op: "add", type: "category", data: { name: "Consumables", parent: categories[0]?.path || "" } },
          { op: "add", type: "location", data: { name: "Drawer", parent: flattenLocations(locations)[0]?.path || "", kind: locationTypes[0]?.name || "location" } },
          { op: "add", type: "item", data: { name: "USB-C cable", category: categories[0]?.path || "", location: flattenLocations(locations)[0]?.path || "", quantity: "1", unit: units[0] || "pcs" } },
        ],
      },
      _available_units: units,
      _available_location_kinds: locationTypes.map((entry) => entry.name),
      _available_categories: categories.map(({ id, path }) => ({ id, path })),
      _available_locations: flattenLocations(locations).map(({ public_id, path, kind }) => ({ public_id, path, kind })),
      operations: [],
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }));
    const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = "findstuff-operations-template.json"; anchor.click(); URL.revokeObjectURL(url);
    setNotice("Operations template downloaded");
  }

  const backup = settings?.setup.backup;
  const batchSummary = (batch: ImportBatch) => Object.entries(batch.summary).filter(([, count]) => count > 0).map(([name, count]) => `${count} ${name}`).join(" · ") || `${batch.undo_count} tracked changes`;
  return <section className="workspace-page data-page">
    <header className="workspace-header"><button className="text-button workspace-back" onClick={onBack}><Icon name="chevron" size={16} />Extra</button><p className="eyebrow">DATA</p><h1>Your data, protected and portable</h1><p>Back up everything, export portable JSON, and preview imports before they touch your inventory.</p></header>
    {activity && <div className="inline-activity" role="status"><span className="activity-spinner" />{activity}</div>}
    <div className="data-overview"><article><Icon name="check" /><span><small>Automatic backups</small><strong>{backup?.enabled ? `${backup.backup_count} saved` : "Not configured"}</strong></span></article><article><Icon name="spark" /><span><small>Last backup</small><strong>{backup?.last_backup_at ? new Date(backup.last_backup_at).toLocaleString() : "None yet"}</strong></span></article><article><Icon name="qr" /><span><small>Undoable imports</small><strong>{batches.filter((entry) => !entry.undone_at).length}</strong></span></article></div>
    <section className="workspace-card data-backup-section"><header><span><Icon name="box" size={22} /></span><div><p className="eyebrow">BACKUP & EXPORT</p><h2>Keep a recovery copy</h2><p>A full backup includes the database and photos. JSON is convenient for moving or inspecting inventory data.</p></div></header><div className="data-action-grid"><button className="primary" disabled={Boolean(activity)} onClick={() => void download("/api/v1/admin/backup", "findstuff-backup.zip", "Full backup")}><Icon name="box" />Download full backup<small>Best for disaster recovery</small></button><button className="secondary" disabled={Boolean(activity)} onClick={() => void download("/api/v1/admin/export", "findstuff-export.json", "JSON export")}><Icon name="qr" />Download JSON export<small>Portable inventory data</small></button></div><div className="restore-backup-box"><div><strong>Restore a full backup</strong><span>This replaces current data after validation and creates a safety backup first.</span></div><button className="danger-button" disabled={busy || Boolean(activity)} onClick={() => restoreInput.current?.click()}>Choose backup</button><input hidden ref={restoreInput} type="file" accept="application/zip,.zip" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void restore(file); }} /></div></section>
    <section className="workspace-card data-import-section"><header><span><Icon name="spark" size={22} /></span><div><p className="eyebrow">IMPORT</p><h2>Preview, verify, then merge</h2><p>Findstuff runs imports against a temporary copy first. Review every proposed change before applying it.</p></div></header><div className="import-quick-actions"><label className="upload-import"><strong>Choose JSON to preview</strong><span>Findstuff export or findstuff-ops-v1 changes file</span><input type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && void preview(event.target.files[0])} /></label><button className="secondary button-with-icon" onClick={template}><Icon name="spark" size={15} />Chatbot operations template</button></div>{summary && <div className="import-preview"><strong>{errors.length ? "Import needs fixes" : "Ready to merge"}</strong>{Object.entries(summary).map(([name, count]) => <p key={name}><span>{name}</span><b>{count}</b></p>)}{details.length > 0 && <div className="import-detail-list"><span>Dry-run details</span>{details.map((detail) => <article className={`import-detail ${detail.status}`} key={`${detail.index}-${detail.label}`}><b>{detail.status}</b><div><strong>{detail.label}</strong><small>{detail.message}</small></div></article>)}</div>}{errors.length > 0 && <div className="import-errors">{errors.map((error, index) => <small key={`${index}-${error}`}>{error}</small>)}</div>}<button className="primary" disabled={busy || !payload || errors.length > 0} onClick={() => void merge()}>Merge reviewed changes</button></div>}<div className="import-history"><strong>Recent imports</strong><small>The latest five are retained for safe undo.</small>{batches.length === 0 && <div className="empty-inline"><span>No imports yet</span></div>}{batches.map((batch) => <article className="import-batch" key={batch.public_id}><div><strong>{batch.mode === "operations" ? "Changes import" : "Data import"}</strong><small>{new Date(batch.created_at).toLocaleString()} · {batchSummary(batch)}</small>{batch.undone_at && <em>Undone {new Date(batch.undone_at).toLocaleString()}</em>}</div><button className="secondary" disabled={busy || Boolean(batch.undone_at)} onClick={() => void undo(batch)}>Undo</button></article>)}</div></section>
  </section>;
}
