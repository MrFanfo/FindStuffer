import { useEffect, useState } from 'react';
import { Icon } from "../../components/Icon";
import type { Item } from '../../api';
import { applyOperation, extensions, type CompatibilityTarget } from '../../extensionApi';

export function CompatibilityView({ onBack, onOpenItem }: { onBack: () => void; onOpenItem: (item: Item) => void }) {
  const [targets, setTargets] = useState<CompatibilityTarget[]>([]); const [selected, setSelected] = useState(new URLSearchParams(location.search).get('target') || '');
  const [query, setQuery] = useState(''); const [detail, setDetail] = useState<Awaited<ReturnType<typeof extensions.target>> | null>(null);
  const [editing, setEditing] = useState<CompatibilityTarget | 'new' | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [retry, setRetry] = useState(0);
  useEffect(() => { void extensions.targets().then(setTargets).catch((reason: Error) => setError(reason.message)); }, [retry]);
  useEffect(() => { if (!selected) { setDetail(null); return; } let active = true; setBusy(true); void extensions.target(selected).then((value) => { if (active) { setDetail(value); setError(''); } }).catch((reason: Error) => { if (active) setError(reason.message); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, [selected, retry]);
  async function save(data: Record<string, unknown>) { setBusy(true); setError(''); try { await applyOperation({ op: editing === 'new' ? 'add' : 'modify', type: 'compatibility_target', ...(editing && editing !== 'new' ? { match: { public_id: editing.public_id } } : {}), data }); setEditing(null); setRetry(retry + 1); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save target'); } finally { setBusy(false); } }
  function selectTarget(id: string) {
    setDetail(null);
    setSelected(id);
    const params = new URLSearchParams(location.search);
    params.set('target', id);
    history.replaceState(history.state, '', `?${params}`);
  }
  const filteredTargets = targets.filter((target) => [target.name, target.manufacturer, target.model, ...target.aliases].join(' ').toLowerCase().includes(query.toLowerCase()));
  return <section className="workspace-page compatibility-page">
    <header className="workspace-header"><button className="planning-back" onClick={onBack}><Icon name="chevron" size={15} />More</button><h1>Compatibility</h1></header>
    {error && <p role="alert" className="error-banner">{error} <button onClick={() => setRetry(retry + 1)}>Retry</button></p>}
    <div className="planning-layout">
      <aside><div className="planning-sidebar-heading"><h2>Targets</h2><span>{targets.length}</span></div>
        <label>Search targets<input type="search" placeholder="Name, model or alias" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="target-list">{filteredTargets.map((target) => <button className={`project-choice ${selected === target.public_id ? 'active' : ''}`} aria-pressed={selected === target.public_id} key={target.public_id} onClick={() => selectTarget(target.public_id)}><strong>{target.name}</strong><small>{[target.type, !target.active ? 'Inactive' : ''].filter(Boolean).join(' · ')}</small></button>)}</div>
        {!filteredTargets.length && <p className="planning-empty">{query ? 'No matching targets.' : 'No targets yet.'}</p>}
        <button className="primary" onClick={() => setEditing('new')}>Create compatibility target</button>
      </aside>
      <div className="compatibility-detail" aria-busy={busy}>{detail ? <>
        <section className="compatibility-overview">
          <header className="planning-detail-heading"><div><h2>{detail.target.name}</h2>{(detail.target.manufacturer || detail.target.model) && <p>{[detail.target.manufacturer, detail.target.model].filter(Boolean).join(' · ')}</p>}</div><button onClick={() => setEditing(detail.target)}>Edit target</button></header>
          <div className="target-metadata">{detail.target.type && <span className="planning-status">{detail.target.type}</span>}{!detail.target.active && <span className="planning-status">Inactive</span>}{detail.target.parent && <span>Family <button className="text-button" onClick={() => selectTarget(detail.target.parent!)}>{targets.find((target) => target.public_id === detail.target.parent)?.name || detail.target.parent}</button></span>}{detail.target.aliases.length > 0 && <span>Also known as <strong>{detail.target.aliases.join(', ')}</strong></span>}</div>
          <a className="compatibility-inventory-link" href={`?view=inventory&compatibility=${encodeURIComponent(detail.target.public_id)}`}>View compatible inventory <Icon name="chevron" size={15} /></a>
        </section>
        {detail.linked_items?.length > 0 && <section className="compatibility-section"><header><h3>Physical items</h3><span>{detail.linked_items.length}</span></header><div className="compatibility-items">{detail.linked_items.map((item) => <button key={item.public_id} onClick={() => onOpenItem(item)}><span className="compatibility-item-main"><strong>{item.name}{item.archived_at ? ' (archived)' : ''}</strong><small>{item.category_path || 'Uncategorised'} · {item.location_path}</small></span><Icon name="chevron" size={15} /></button>)}</div></section>}
        <section className="compatibility-section"><header><h3>Related inventory</h3><span>{detail.total}</span></header>
          <div className="compatibility-items">{detail.items.map((item) => <button key={item.public_id} onClick={() => onOpenItem(item)}>
            <span className="compatibility-item-main"><strong>{item.name}</strong><small>{item.quantity} {item.unit} · {item.location_path || 'Unassigned'}</small></span>
            <span className="compatibility-relation"><span className={`planning-status relation-${item.effective_compatibility.status}`}>{item.effective_compatibility.status.replaceAll('_', ' ')}</span>{item.effective_compatibility.inherited && <small>From {item.effective_compatibility.source_name}</small>}</span><Icon name="chevron" size={15} />
          </button>)}</div>
          {!detail.items.length && <p className="planning-empty">No related inventory yet.</p>}
          {detail.next_offset !== null && <button disabled={busy} onClick={() => { setBusy(true); void extensions.target(selected, detail.next_offset!).then((next) => setDetail((current) => current?.target.public_id === next.target.public_id ? { ...next, items: [...current.items, ...next.items] } : current)).catch((reason: Error) => setError(reason.message)).finally(() => setBusy(false)); }}>Load more relationships</button>}
        </section>
        <section className="compatibility-section"><header><h3>Related projects</h3><span>{detail.projects.length}</span></header><div className="compatibility-projects">{detail.projects.map((project) => <a key={project.public_id} href={`?view=projects&project=${project.public_id}`}><strong>{project.name}</strong><Icon name="chevron" size={15} /></a>)}</div>{!detail.projects.length && <p className="planning-empty">No projects use this target yet.</p>}</section>
      </> : <div className="compatibility-placeholder"><Icon name="tag" size={28} /><h2>{busy ? 'Loading target…' : 'Choose a target'}</h2><p>{busy ? 'Fetching inventory and projects.' : 'Select a target to see its inventory and projects.'}</p></div>}</div>
    </div>
    {editing && <div role="dialog" aria-modal="true" aria-label="Compatibility target editor" className="modal-backdrop"><section className="planning-dialog"><header><h2>{editing === 'new' ? 'New target' : 'Edit target'}</h2><button aria-label="Close target editor" onClick={() => setEditing(null)}>Close</button></header>{error && <p role="alert">{error}</p>}<TargetEditor target={editing === 'new' ? null : editing} targets={targets} busy={busy} onSave={save} /></section></div>}
  </section>;
}
function TargetEditor({ target, targets, busy, onSave }: { target: CompatibilityTarget | null; targets: CompatibilityTarget[]; busy: boolean; onSave: (data: Record<string, unknown>) => Promise<void> }) {
  const [values, setValues] = useState({ name: target?.name || '', manufacturer: target?.manufacturer || '', model: target?.model || '', type: target?.type || '', aliases: target?.aliases.join('\n') || '', parent: target?.parent || '', active: target?.active ?? true });
  return <form className="form-card compact-form" onSubmit={(event) => { event.preventDefault(); void onSave({ ...values, aliases: values.aliases.split('\n').map((value) => value.trim()).filter(Boolean), parent: values.parent || null }); }}>{(['name', 'manufacturer', 'model', 'type'] as const).map((key) => <label key={key}>{key}<input required={key === 'name'} value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} /></label>)}<label>Aliases, one per line<textarea value={values.aliases} onChange={(event) => setValues({ ...values, aliases: event.target.value })} /></label><label>Parent / family<select value={values.parent} onChange={(event) => setValues({ ...values, parent: event.target.value })}><option value="">No parent</option>{targets.filter((entry) => entry.public_id !== target?.public_id).map((entry) => <option key={entry.public_id} value={entry.public_id}>{entry.name}</option>)}</select></label><label><input type="checkbox" checked={values.active} onChange={(event) => setValues({ ...values, active: event.target.checked })} />Active</label><p>Deactivation retains relationships. Choose family parents carefully: their relationships can apply to descendants unless explicitly overridden.</p><button className="primary" disabled={busy}>Save target</button></form>;
}
