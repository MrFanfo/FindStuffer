import { useEffect, useMemo, useState } from 'react';
import { Icon } from "../../components/Icon";
import type { Category } from '../../api';
import { applyOperation, extensions, type CompatibilityTarget } from '../../extensionApi';
import { TargetEditor } from './TargetEditor';

export function CompatibilityView({ categories, onBack, onOpenTarget }: {
  categories: Category[];
  onBack: () => void;
  onOpenTarget: (publicId: string) => void;
}) {
  const [targets, setTargets] = useState<CompatibilityTarget[]>([]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<'new' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => { void extensions.targets().then(setTargets).catch((reason: Error) => setError(reason.message)); }, [retry]);
  async function save(data: Record<string, unknown>) {
    setBusy(true); setError('');
    try { await applyOperation({ op: 'add', type: 'compatibility_target', data }); setEditing(null); setRetry(retry + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save target'); }
    finally { setBusy(false); }
  }
  const groups = useMemo(() => {
    const needle = query.toLowerCase();
    const matching = targets.filter((target) => [target.name, target.manufacturer, target.model, ...target.aliases].join(' ').toLowerCase().includes(needle));
    const collected = new Map<number | null, { name: string; entries: CompatibilityTarget[] }>();
    for (const target of matching) {
      const category = categories.find((entry) => entry.id === target.category);
      const key = category?.id ?? null;
      if (!collected.has(key)) collected.set(key, { name: category?.path || category?.name || 'Uncategorised', entries: [] });
      collected.get(key)!.entries.push(target);
    }
    return [...collected].sort(([a, first], [b, second]) => a === null ? 1 : b === null ? -1 : first.name.localeCompare(second.name));
  }, [categories, query, targets]);
  const matches = groups.reduce((total, [, group]) => total + group.entries.length, 0);
  return <section className="workspace-page compatibility-page planning-page">
    <header className="workspace-header"><button className="planning-back" onClick={onBack}><Icon name="chevron" size={15} />More</button><h1>Compatibility</h1></header>
    {error && <p role="alert" className="error-banner">{error} <button onClick={() => setRetry(retry + 1)}>Retry</button></p>}
    <div className="target-browser">
      <div className="target-browser-controls">
        <label className="target-search">Search targets<input type="search" placeholder="Name, model or alias" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <button className="primary" onClick={() => setEditing('new')}><Icon name="plus" size={15} />Create target</button>
      </div>
      <p className="target-browser-count">{matches} of {targets.length} target{targets.length === 1 ? '' : 's'}</p>
      {groups.map(([id, group]) => <section className="target-group" key={id ?? 'uncategorised'} aria-label={group.name}>
        <header><h2>{group.name}</h2><span>{group.entries.length}</span></header>
        <div className="target-group-list">{group.entries.map((target) => <button className="target-card" key={target.public_id} onClick={() => onOpenTarget(target.public_id)}>
          <span className="target-card-main"><strong>{target.name}</strong><small>{[target.manufacturer, target.model, target.type].filter(Boolean).join(' · ') || 'No model details'}</small></span>
          {!target.active && <span className="planning-status">Inactive</span>}
          <Icon name="chevron" size={15} />
        </button>)}</div>
      </section>)}
      {!groups.length && <p className="planning-empty">{query ? 'No matching targets.' : 'No targets yet. Create one to group compatible parts around a model or platform.'}</p>}
    </div>
    {editing && <div role="dialog" aria-modal="true" aria-label="Compatibility target editor" className="modal-backdrop"><section className="planning-dialog"><header><h2>New target</h2><button aria-label="Close target editor" onClick={() => setEditing(null)}>Close</button></header>{error && <p role="alert">{error}</p>}<TargetEditor target={null} targets={targets} categories={categories} busy={busy} onSave={save} /></section></div>}
  </section>;
}
