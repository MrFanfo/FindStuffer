import { parseImportJson } from "./strictJson";
import { ImportReviewEditor } from "./ImportReviewEditor";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type ApplicationSettings,
  type Category,
  type ImportBatch,
  type ImportPreviewDetail,
  type LocationNode,
  type LocationType,
  type StoredBackup,
  type BackupPreview,
} from "../../api";
import { Icon } from "../../components/Icon";

export function DataView({ categories, locations, busy, onBack, onChanged, setNotice }: {
  categories: Category[];
  locations: LocationNode[];
  locationTypes: LocationType[];
  units: string[];
  busy: boolean;
  onBack: () => void;
  onChanged: () => Promise<void>;
  setNotice: (message: string) => void;
}) {
  const [previewNote, setPreviewNote] = useState("");
  const [unsavedRows, setUnsavedRows] = useState(false);
  const [previewDirty, setPreviewDirty] = useState(false);
  const [validating, setValidating] = useState(false);
  const previewGeneration = useRef(0);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [restorePreview, setRestorePreview] = useState<BackupPreview | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreError, setRestoreError] = useState("");
  const [settings, setSettings] = useState<ApplicationSettings | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [backups, setBackups] = useState<StoredBackup[]>([]);
  const [payload, setPayload] = useState<unknown>(null);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [details, setDetails] = useState<ImportPreviewDetail[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [activity, setActivity] = useState("");
  const restoreInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const results = await Promise.allSettled([api.settings(), api.importBatches(), api.backups()]);
    const [settingsResult, batchesResult, backupsResult] = results;
    if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
    if (batchesResult.status === "fulfilled") setBatches(batchesResult.value);
    if (backupsResult.status === "fulfilled") setBackups(backupsResult.value);
    setLoadErrors(results.flatMap((result, index) => result.status === "rejected" ? [["Backup configuration", "Import history", "Saved backups"][index]] : []));
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

  async function inspectBackup(file: File) {
    setRestorePreview(null); setRestoreFile(null); setRestoreError(""); setActivity(`Validating ${file.name}…`);
    try { setRestorePreview(await api.previewBackup(file)); setRestoreFile(file); }
    catch (error) { setRestoreError(error instanceof Error ? error.message : "Backup could not be validated"); }
    finally { setActivity(""); }
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

  async function reviewPayload(nextPayload: unknown) {
    const generation = ++previewGeneration.current;
    setActivity("Validating all proposed changes…"); setPreviewDirty(true); setValidating(true);
    try {
      const result = await api.importPreview(nextPayload);
      if (generation !== previewGeneration.current) return;
      setPayload(nextPayload); setSummary(result.counts); setDetails(result.details || []); setErrors(result.errors || []);
      setPreviewNote(result.note); setPreviewDirty(false);
      setNotice(result.valid ? "Preview ready. Review destinations and changes before applying." : "Some proposals need edits or rejection.");
    } catch (error) {
      if (generation !== previewGeneration.current) return;
      setErrors([error instanceof Error ? error.message : "Invalid import file"]);
    } finally { if (generation === previewGeneration.current) { setActivity(""); setValidating(false); } }
  }

  async function preview(file: File) {
    try {
      const parsed = parseImportJson(await file.text());
      const next = Array.isArray(parsed.operations) ? { ...parsed, schema_version: parsed.schema_version ?? 2 } : parsed;
      setPayload(next); setDetails([]); setSummary({}); setErrors([]);
      await reviewPayload(next);
    } catch (error) { setErrors([error instanceof Error ? error.message : "Invalid JSON"]); setPreviewDirty(true); }
  }

  function editPayload(next: unknown) {
    previewGeneration.current++; setSummary({}); setPayload(next); setPreviewDirty(true); setDetails([]); setErrors([]);
    setNotice("File edited. Review changes again before applying.");
  }

  async function merge() {
    if (!payload || previewDirty || unsavedRows || errors.length) return;
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

  async function template() {
    await download("/api/v1/admin/operations-template", "findstuff-operations-template.json", "Complete AI operations contract");
  }

  const backup = settings?.setup.backup;
  const batchSummary = (batch: ImportBatch) => Object.entries(batch.summary).filter(([, count]) => count > 0).map(([name, count]) => `${count} ${name}`).join(" · ") || `${batch.undo_count} tracked changes`;
  return <section className="workspace-page data-page">
    <header className="workspace-header"><button className="text-button workspace-back" onClick={onBack}><Icon name="chevron" size={16} />More</button><h1 className="eyebrow">DATA</h1></header>
    {loadErrors.map((section) => <p className="error-banner" role="alert" key={section}>{section} could not load. <button onClick={() => void load()}>Retry</button></p>)}
    {activity && <div className="inline-activity" role="status"><span className="activity-spinner" />{activity}</div>}
    <div className="data-overview"><article><Icon name="check" /><span><small>Automatic backups</small><strong>{backup?.enabled ? `${backup.backup_count} saved` : "Not configured"}</strong></span></article><article><Icon name="spark" /><span><small>Last backup</small><strong>{backup?.last_backup_at ? new Date(backup.last_backup_at).toLocaleString() : "None yet"}</strong></span></article><article><Icon name="qr" /><span><small>Undoable imports</small><strong>{batches.filter((entry) => !entry.undone_at).length}</strong></span></article></div>
    <section className="workspace-card recovery-status"><h2>Recovery status</h2><dl><dt>Automatic backup destination</dt><dd>{backup?.destination || "Unavailable"}</dd><dt>Contents</dt><dd>Database, photos and documents. Passwords and external service credentials are excluded.</dd><dt>Off-device recovery copy</dt><dd>Not verified. Download a full backup and keep it on a different device or storage service.</dd><dt>Last recorded restore</dt><dd>{backup?.last_restore?.status === "complete" ? backup.last_restore.message || "Completed" : "No completed restore recorded"}</dd><dt>Host-loss recovery drill</dt><dd>Not recorded. Backup creation does not prove recovery on another machine.</dd></dl></section>
    {restoreError && <p className="error-banner" role="alert">{restoreError}</p>}
    {restorePreview && restoreFile && <section className="workspace-card restore-review"><h2>Review backup before restoring</h2><p>{restorePreview.filename} · {(restorePreview.size_bytes / 1048576).toFixed(2)} MB · created {new Date(restorePreview.manifest.created_at).toLocaleString()}</p><dl>{Object.entries(restorePreview.counts).map(([key, count]) => <div key={key}><dt>{key}</dt><dd>{count}</dd></div>)}</dl><p>Database integrity and photo/document references passed validation. Restoring replaces current inventory and restarts Findstuff. A safety backup is created first.</p><button disabled={Boolean(activity)} onClick={() => { setRestorePreview(null); setRestoreFile(null); }}>Cancel</button><button className="danger-button" disabled={Boolean(activity)} onClick={() => void restore(restoreFile)}>Replace inventory with this backup</button></section>}
    <section className="workspace-card data-backup-section"><header><span><Icon name="box" size={22} /></span><div><h2 className="eyebrow">BACKUP & EXPORT</h2></div></header><div className="data-action-grid"><button className="primary" disabled={Boolean(activity)} onClick={() => void download("/api/v1/admin/backup", "findstuff-backup-current.zip", "Current-state backup")}><Icon name="box" />Download current state<small>Create a fresh backup right now</small></button><button className="secondary" disabled={Boolean(activity)} onClick={() => void download("/api/v1/admin/export", "findstuff-export.json", "JSON export")}><Icon name="qr" />Download JSON export<small>Portable inventory data</small></button></div><div className="saved-backup-list"><div className="saved-backup-heading"><span><strong>Automatic backup history</strong><small>{backups.length} of {backup?.retention ?? "…"} saved · oldest copies rotate automatically</small></span></div>{backups.length === 0 && !loadErrors.includes("Saved backups") && <div className="empty-inline"><span>No automatic backups yet</span></div>}{backups.map((entry, index) => <article key={entry.id}><span className="backup-sequence">{index + 1}</span><div><strong>{new Date(entry.created_at).toLocaleString()}</strong><small>{(entry.size_bytes / 1024 / 1024).toFixed(entry.size_bytes < 1024 * 1024 ? 2 : 1)} MB · automatic snapshot</small></div><button className="secondary" disabled={Boolean(activity)} onClick={() => void download(`/api/v1/admin/backups/${encodeURIComponent(entry.id)}`, `findstuff-backup-${entry.id}.zip`, "Saved backup")}>Download</button></article>)}</div><div className="restore-backup-box"><div><strong>Restore a full backup</strong><span>This replaces current data after validation and creates a safety backup first.</span></div><button className="danger-button" disabled={busy || Boolean(activity)} onClick={() => restoreInput.current?.click()}>Choose backup</button><input hidden ref={restoreInput} type="file" accept="application/zip,.zip" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void inspectBackup(file); }} /></div></section>
    {payload !== null && <><p role="status">{validating ? "Validating proposed changes…" : previewDirty ? "Edited file: review required before applying." : "Showing validated proposals."}</p><ImportReviewEditor payload={payload} details={details} categories={categories} locations={locations} onChange={editPayload} onDraftChange={setUnsavedRows} validating={validating} busy={busy || Boolean(activity)} /></>}
    <section className="workspace-card data-import-section"><header><span><Icon name="spark" size={22} /></span><div><h2 className="eyebrow">IMPORT</h2></div></header><div className="import-quick-actions"><label className="upload-import"><strong>Choose JSON to preview</strong><span>Findstuff export or findstuff-ops-v1 changes file</span><input type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && void preview(event.target.files[0])} /></label><button className="secondary button-with-icon" onClick={() => void template()}><Icon name="spark" size={15} />Chatbot operations template</button></div>{summary && <div className="import-preview"><strong>{validating ? "Validating…" : previewDirty ? "Review required" : errors.length ? "Import needs fixes" : "Ready to apply"}</strong>{Object.entries(summary).map(([name, count]) => <p key={name}><span>{name.replaceAll("_", " ")}</span><b>{count}</b></p>)}<p role="status">{previewNote}</p>{errors.length > 0 && <div className="import-errors">{errors.map((error, index) => <small key={`${index}-${error}`}>{error}</small>)}</div>}<button className="secondary" disabled={busy || Boolean(activity) || !payload || unsavedRows} onClick={() => void reviewPayload(payload)}>Review changes again</button><button className="primary" disabled={busy || Boolean(activity) || !payload || previewDirty || unsavedRows || errors.length > 0} onClick={() => void merge()}>Apply reviewed changes</button></div>}<details className="import-history"><summary><span><strong>Recent imports</strong><small>The latest five are retained for safe undo.</small></span><b>{batches.length}</b><Icon name="chevron" size={16} /></summary><div className="import-history-content">{batches.length === 0 && <div className="empty-inline"><span>No imports yet</span></div>}{batches.map((batch) => <article className="import-batch" key={batch.public_id}><div><strong>{batch.mode === "operations" ? "Changes import" : "Data import"}</strong><small>{new Date(batch.created_at).toLocaleString()} · {batchSummary(batch)}</small>{batch.undone_at && <em>Undone {new Date(batch.undone_at).toLocaleString()}</em>}</div><button className="secondary" disabled={busy || Boolean(batch.undone_at)} onClick={() => void undo(batch)}>Undo</button></article>)}</div></details></section>
  </section>;
}
