import { parseImportJson } from "./strictJson";
import { useCallback, useEffect, useState } from "react";
import { flattenLocations, type Category, type ImportPreviewDetail, type LocationNode } from "../../api";

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};

export function ImportReviewEditor({ payload, details, categories, locations, onChange, onDraftChange, busy }: {
  payload: unknown; details: ImportPreviewDetail[]; categories: Category[]; locations: LocationNode[];
  onChange: (payload: unknown) => void; onDraftChange: (dirty: boolean) => void; busy: boolean;
}) {
  const document = object(payload);
  const operations = Array.isArray(document.operations) ? document.operations : null;
  const tables = object(document.tables);
  const rows = operations ? operations.map((value, index) => ({ value, index, table: '' })) : Object.entries(tables).flatMap(([table, values]) => Array.isArray(values) ? values.map((value, index) => ({ value, index, table })) : []);
  const [limit, setLimit] = useState(30);
  const [draftRows, setDraftRows] = useState<Record<string, boolean>>({});
  const draftChanged = useCallback((key: string, dirty: boolean) => setDraftRows((current) => current[key] === dirty ? current : { ...current, [key]: dirty }), []);
  const hasDraft = Object.values(draftRows).some(Boolean);
  useEffect(() => onDraftChange(hasDraft), [hasDraft, onDraftChange]);
  function change(index: number, table: string, next: unknown, remove = false) {
    const current = (table ? tables[table] : operations) as unknown[];
    const values = remove ? current.filter((_, i) => i !== index) : current.map((value, i) => i === index ? next : value);
    onChange(table ? { ...document, tables: { ...tables, [table]: values } } : { ...document, schema_version: Math.max(2, Number(document.schema_version) || 2), operations: values });
  }
  return <section className="import-review-editor"><h2>Review each proposal</h2><p>Edit any field, change destinations, or reject a line. Review changes again before applying. References to rejected categories or places must be fixed too.</p><datalist id="import-category-paths">{categories.map((entry) => <option key={entry.id} value={entry.path} />)}</datalist><datalist id="import-place-paths">{flattenLocations(locations).map((entry) => <option key={entry.public_id} value={entry.path} />)}</datalist>
    {operations && <details className="import-batch-options"><summary>Batch options</summary><div className="form-card compact-form"><label>Batch ID<input value={String(document.import_id || '')} placeholder="Automatic content hash when omitted" disabled={busy} onChange={(event) => { const next = { ...document, import_id: event.target.value }; if (!event.target.value) delete (next as JsonObject).import_id; onChange(next); }} /></label><label>Exact duplicate policy<select value={String(document.duplicate_policy || 'error')} disabled={busy} onChange={(event) => onChange({ ...document, schema_version: Math.max(2, Number(document.schema_version) || 2), duplicate_policy: event.target.value })}><option value="error">Error — require a decision</option><option value="skip">Skip existing stock</option><option value="merge_quantity">Merge quantity — add stock</option><option value="replace">Replace supplied fields</option></select></label><label>Operation ordering<select value={String(document.ordering || 'input')} disabled={busy} onChange={(event) => onChange({ ...document, schema_version: Math.max(2, Number(document.schema_version) || 2), ordering: event.target.value })}><option value="input">Keep file order</option><option value="dependencies">Resolve dependencies first</option></select></label><p>This preview is atomic: every operation succeeds or the whole batch rolls back. Retrying the same batch ID or unchanged file is safe. After applying, use a new batch ID for a deliberately repeated stock increment.</p></div></details>}
    {hasDraft && <p role="alert">Save or discard your row edits before reviewing or applying the file.</p>}
    {rows.slice(0, limit).map(({ value, index, table }) => <ProposalRow key={`${table}-${index}-${JSON.stringify(value)}`} draftKey={`${table}-${index}`} onDraftChange={draftChanged} value={value} index={index} table={table} detail={details.find((detail) => operations ? detail.index === index + 1 : detail.table === table && detail.row_index === index)} busy={busy} onChange={(next) => change(index, table, next)} onReject={() => change(index, table, null, true)} />)}
    {rows.length > limit && <button disabled={busy} onClick={() => setLimit(limit + 30)}>Show next {Math.min(30, rows.length - limit)} proposals</button>}
    <p className="muted">{rows.length} proposals in this file. Applying uses the entire reviewed file, including rows beyond this display.</p>
  </section>;
}

function ProposalRow({ value, index, table, detail, busy, onChange, onReject, draftKey, onDraftChange }: { draftKey: string; onDraftChange: (key: string, dirty: boolean) => void; value: unknown; index: number; table: string; detail?: ImportPreviewDetail; busy: boolean; onChange: (value: unknown) => void; onReject: () => void }) {
  const entry = object(value);
  const data = table ? entry : object(entry.data);
  const [json, setJson] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(String(data.name ?? ''));
  const [category, setCategory] = useState(String(data.category ?? data.category_path ?? data.category_name ?? data.category_id ?? ''));
  const [place, setPlace] = useState(String(data.location ?? data.location_path ?? data.location_name ?? data.location_public_id ?? ''));
  const [quantity, setQuantity] = useState(String(data.quantity ?? ''));
  const dirty = json !== JSON.stringify(value, null, 2) || name !== String(data.name ?? '') || category !== String(data.category ?? data.category_path ?? data.category_name ?? data.category_id ?? '') || place !== String(data.location ?? data.location_path ?? data.location_name ?? data.location_public_id ?? '') || quantity !== String(data.quantity ?? '');
  useEffect(() => { onDraftChange(draftKey, dirty); return () => onDraftChange(draftKey, false); }, [draftKey, dirty, onDraftChange]);
  const item = !table && entry.type === 'item' && entry.op !== 'delete';
  function saveFields() {
    const next = { ...data };
    if (name !== String(data.name ?? '')) next.name = name;
    if (quantity !== String(data.quantity ?? '')) { delete next.quantity_delta; delete next.add_quantity; delete next.remove_quantity; next.quantity = quantity; }
    const originalCategory = String(data.category ?? data.category_path ?? data.category_name ?? data.category_id ?? '');
    if (category !== originalCategory) { ['category', 'category_id', 'category_path', 'category_name'].forEach((key) => delete next[key]); next.category = category || null; }
    const originalPlace = String(data.location ?? data.location_path ?? data.location_name ?? data.location_public_id ?? '');
    if (place !== originalPlace) { ['location', 'location_public_id', 'location_path', 'location_name'].forEach((key) => delete next[key]); next.location = place || null; }
    onChange({ ...entry, data: next });
  }
  const after = detail?.after;
  const before = detail?.before;
  const failed = detail?.validation_status === 'failed' || detail?.status === 'error';
  const warning = detail?.validation_status === 'warning' || Boolean(detail?.warnings?.length) || detail?.status === 'skip';
  const tone = failed ? 'failed' : !detail || warning || dirty ? 'warning' : 'valid';
  const status = failed ? 'Error' : dirty ? 'Unsaved' : !detail ? 'Review needed' : warning ? 'Warning' : 'Valid';
  const label = String(data.name || object(entry.match).name || after?.name || before?.name || detail?.label || 'Proposal');
  const destination = [after?.category_path, after?.location_path].filter(Boolean).join(' · ');
  return <article className={`proposal-row proposal-${tone}`}><header className="proposal-line">
    <span className="proposal-status" title={detail?.message}>{status}</span>
    <span className="proposal-operation">{table ? `${table} #${index + 1}` : `#${index + 1} ${String(entry.op || '?')} ${String(entry.type || '?')}`}</span>
    <span className="proposal-label" title={[label, destination, detail?.message].filter(Boolean).join(' · ')}>{label}{destination && <small> · {destination}</small>}</span>
    <button type="button" disabled={busy} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Close' : 'Modify'}</button>
    <button type="button" className="danger" disabled={busy} aria-label={`Reject operation ${index + 1}`} title="Reject line" onClick={onReject}>×</button>
  </header>{expanded && <div className="proposal-expanded">

    {detail && <p role={detail.status === 'error' ? 'alert' : undefined}>{detail.validation_status || detail.status}: {detail.message}</p>}
    {after && (!table ? entry.type === "item" : table === "items") && <dl className="proposal-destination"><div><dt>Category</dt><dd>{String(after.category_path || 'Uncategorised')}</dd></div><div><dt>Place</dt><dd>{String(after.location_path || after.path || 'Unassigned')}</dd></div>{after.quantity !== undefined && <div><dt>Quantity</dt><dd>{String(after.quantity)} {String(after.unit || '')}</dd></div>}{before && detail.moved && <div><dt>Moving from</dt><dd>{String(before.location_path || '')}</dd></div>}</dl>}
    {detail && <details><summary>Complete validation and change details</summary><pre>{JSON.stringify(detail, null, 2)}</pre></details>}
    {dirty && <button type="button" disabled={busy} onClick={() => { setJson(JSON.stringify(value, null, 2)); setName(String(data.name ?? '')); setCategory(String(data.category ?? data.category_path ?? data.category_name ?? data.category_id ?? '')); setPlace(String(data.location ?? data.location_path ?? data.location_name ?? data.location_public_id ?? '')); setQuantity(String(data.quantity ?? '')); setError(''); }}>Discard unsaved row edits</button>}
    {detail?.source_after && <p>Stock remaining at source: {String(detail.source_after.quantity)} {String(detail.source_after.unit)} · {String(detail.source_after.location_path)}</p>}
    {detail?.transferred_quantity && <p>Quantity transferred: {detail.transferred_quantity}</p>}
    {detail?.warnings?.map((warning) => <p key={warning} className="inline-alert">{warning}</p>)}
    {item && <details><summary>Edit item fields and destination</summary><div className="form-card compact-form"><label>Name<input value={name} disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="Omitted: leave unchanged" /></label><label>Category<input list="import-category-paths" value={category} disabled={busy} onChange={(event) => setCategory(event.target.value)} placeholder="Full path or ID; blank clears when changed" /></label><label>Place<input list="import-place-paths" value={place} disabled={busy} onChange={(event) => setPlace(event.target.value)} placeholder="Full path or public ID" /></label><label>Absolute quantity<input inputMode="decimal" value={quantity} disabled={busy} onChange={(event) => setQuantity(event.target.value)} placeholder="Leave blank to preserve the original instruction" /></label><button type="button" disabled={busy} onClick={saveFields}>Save field edits</button></div></details>}
    <button type="button" disabled={busy} aria-expanded={editing} onClick={() => setEditing(!editing)}>Edit all fields as JSON</button>{editing && <div className="proposal-json"><label>Complete {table ? 'record' : 'operation'} JSON<textarea spellCheck={false} rows={12} value={json} onChange={(event) => setJson(event.target.value)} /></label>{error && <p role="alert">{error}</p>}<button type="button" disabled={busy} onClick={() => { try { const parsed: unknown = parseImportJson(json); if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Each proposal must be a JSON object'); onChange(parsed); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Invalid JSON'); } }}>Save JSON edits</button></div>}
  </div>} </article>;
}
