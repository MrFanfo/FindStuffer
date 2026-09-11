import { useEffect, useState } from 'react';
import { Icon } from "../../components/Icon";
import type { Category, Item } from '../../api';
import { applyOperation, extensions, type CompatibilityTarget } from '../../extensionApi';
import { TargetEditor } from './TargetEditor';

export function TargetDetailView({ targetId, categories, onBack, onOpenItem, onOpenTarget, onOpenProject }: {
  targetId: string;
  categories: Category[];
  onBack: () => void;
  onOpenItem: (item: Item) => void;
  onOpenTarget: (publicId: string) => void;
  onOpenProject: (publicId: string) => void;
}) {
  const [targets, setTargets] = useState<CompatibilityTarget[]>([]);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof extensions.target>> | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => { void extensions.targets().then(setTargets).catch(() => { /* Family names degrade to IDs. */ }); }, [retry]);
  useEffect(() => {
    let active = true;
    setDetail(null); setBusy(true);
    void extensions.target(targetId)
      .then((value) => { if (active) { setDetail(value); setError(''); } })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [targetId, retry]);
  async function save(data: Record<string, unknown>) {
    setBusy(true); setError('');
    try { await applyOperation({ op: 'modify', type: 'compatibility_target', match: { public_id: targetId }, data }); setEditing(false); setRetry(retry + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save target'); }
    finally { setBusy(false); }
  }
  const category = detail ? categories.find((entry) => entry.id === detail.target.category) : undefined;
  return <section className="workspace-page compatibility-page target-detail-page planning-page">
    <header className="workspace-header"><button className="planning-back" onClick={onBack}><Icon name="chevron" size={15} />Compatibility</button><h1>{detail?.target.name || 'Target'}</h1></header>
    {error && <p role="alert" className="error-banner">{error} <button onClick={() => setRetry(retry + 1)}>Retry</button></p>}
    <div className="compatibility-detail" aria-busy={busy}>{detail ? <>
      <section className="compatibility-overview">
        <header className="planning-detail-heading"><div><h2>{detail.target.name}</h2>{(detail.target.manufacturer || detail.target.model) && <p>{[detail.target.manufacturer, detail.target.model].filter(Boolean).join(' · ')}</p>}</div><button onClick={() => setEditing(true)}>Edit target</button></header>
        <div className="target-metadata">{category && <span className="planning-status">{category.path || category.name}</span>}{detail.target.type && <span className="planning-status">{detail.target.type}</span>}{!detail.target.active && <span className="planning-status">Inactive</span>}{detail.target.parent && <span>Family <button className="text-button" onClick={() => onOpenTarget(detail.target.parent!)}>{targets.find((target) => target.public_id === detail.target.parent)?.name || detail.target.parent}</button></span>}{detail.target.aliases.length > 0 && <span>Also known as <strong>{detail.target.aliases.join(', ')}</strong></span>}</div>
        <a className="compatibility-inventory-link" href={`?view=inventory&compatibility=${encodeURIComponent(detail.target.public_id)}`}>View compatible inventory <Icon name="chevron" size={15} /></a>
      </section>
      {detail.linked_items?.length > 0 && <section className="compatibility-section"><header><h3>Physical items</h3><span>{detail.linked_items.length}</span></header><div className="compatibility-items">{detail.linked_items.map((item) => <button key={item.public_id} onClick={() => onOpenItem(item)}><span className="compatibility-item-main"><strong>{item.name}{item.archived_at ? ' (archived)' : ''}</strong><small>{item.category_path || 'Uncategorised'} · {item.location_path}</small></span><Icon name="chevron" size={15} /></button>)}</div></section>}
      <section className="compatibility-section"><header><h3>Related inventory</h3><span>{detail.total}</span></header>
        <div className="compatibility-items">{detail.items.map((item) => <button key={item.public_id} onClick={() => onOpenItem(item)}>
          <span className="compatibility-item-main"><strong>{item.name}</strong><small>{item.quantity} {item.unit} · {item.location_path || 'Unassigned'}</small></span>
          <span className="compatibility-relation"><span className={`planning-status relation-${item.effective_compatibility.status}`}>{item.effective_compatibility.status.replaceAll('_', ' ')}</span>{item.effective_compatibility.inherited && <small>From {item.effective_compatibility.source_name}</small>}</span><Icon name="chevron" size={15} />
        </button>)}</div>
        {!detail.items.length && <p className="planning-empty">No related inventory yet.</p>}
        {detail.next_offset !== null && <button disabled={busy} onClick={() => { setBusy(true); void extensions.target(targetId, detail.next_offset!).then((next) => setDetail((current) => current?.target.public_id === next.target.public_id ? { ...next, items: [...current.items, ...next.items] } : current)).catch((reason: Error) => setError(reason.message)).finally(() => setBusy(false)); }}>Load more relationships</button>}
      </section>
      <section className="compatibility-section"><header><h3>Related projects</h3><span>{detail.projects.length}</span></header><div className="compatibility-projects">{detail.projects.map((project) => <button key={project.public_id} onClick={() => onOpenProject(project.public_id)}><strong>{project.name}</strong><Icon name="chevron" size={15} /></button>)}</div>{!detail.projects.length && <p className="planning-empty">No projects use this target yet.</p>}</section>
    </> : <div className="compatibility-placeholder"><Icon name="tag" size={28} /><h2>{busy ? 'Loading target…' : 'Target unavailable'}</h2><p>{busy ? 'Fetching inventory and projects.' : 'Go back and choose a target from the list.'}</p></div>}</div>
    {editing && detail && <div role="dialog" aria-modal="true" aria-label="Compatibility target editor" className="modal-backdrop"><section className="planning-dialog"><header><h2>Edit target</h2><button aria-label="Close target editor" onClick={() => setEditing(false)}>Close</button></header>{error && <p role="alert">{error}</p>}<TargetEditor target={detail.target} targets={targets} categories={categories} busy={busy} onSave={save} /></section></div>}
  </section>;
}
