import { useDeviceDraft, draftField, DraftNotice } from "../shell/useDeviceDraft";
import { Icon } from "../../components/Icon";
import { RequirementRow } from "./RequirementRow";
import { ProjectActions } from "./ProjectActions";
import { parseLinkText } from "../../domain/inventory";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Category, type Item, type LocationNode } from '../../api';
import { applyOperation, extensions, type CompatibilityTarget, type PlanningProject, type Requirement } from '../../extensionApi';
import { RequirementEditor } from './RequirementEditor';
import { RequirementStockPicker } from './RequirementStockPicker';
import { TargetChoices } from './TargetChoices';

export function ProjectDetailView({ projectId, categories, locations, onBack, onOpenItem }: {
  projectId: string;
  categories: Category[];
  locations: LocationNode[];
  onBack: () => void;
  onOpenItem: (item: Item) => void;
}) {
  const [projects, setProjects] = useState<PlanningProject[]>([]);
  const [targets, setTargets] = useState<CompatibilityTarget[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Requirement | 'new' | null>(null);
  const [linking, setLinking] = useState<Requirement | null>(null);
  const [stocking, setStocking] = useState<Requirement | null>(null);
  const reload = useCallback(async () => { const results = await Promise.allSettled([extensions.projects(), extensions.targets()]); if (results[0].status === 'fulfilled') setProjects(results[0].value); if (results[1].status === 'fulfilled') setTargets(results[1].value); setLoaded(true); const failed = results.filter((result) => result.status === 'rejected'); if (failed.length) throw new Error('Projects or compatibility targets could not load'); }, []);
  useEffect(() => { void reload().catch((reason: Error) => setError(reason.message)); }, [reload]);
  const project = projects.find((entry) => entry.public_id === projectId);
  const sortedGroups = useMemo(() => {
    const collected = new Map<number | null, { name: string; entries: Requirement[] }>();
    for (const entry of project?.requirements || []) {
      const category = categories.find((value) => value.id === entry.category);
      const key = category?.id ?? null;
      if (!collected.has(key)) collected.set(key, { name: category?.path || category?.name || 'Uncategorised', entries: [] });
      collected.get(key)!.entries.push(entry);
    }
    return [...collected].sort(([a, first], [b, second]) => a === null ? 1 : b === null ? -1 : first.name.localeCompare(second.name));
  }, [categories, project]);
  async function perform(action: () => Promise<unknown>) { setBusy(true); setError(''); try { await action(); await reload(); return true; } catch (reason) { setError(reason instanceof Error ? reason.message : 'Change failed'); return false; } finally { setBusy(false); } }
  const patchRequirement = (entry: Requirement, data: Record<string, unknown>) => perform(() => applyOperation({ op: 'modify', type: 'project_requirement', match: { public_id: entry.public_id }, data }));
  return <section className="workspace-page projects-page project-detail-page planning-page">
    <header className="workspace-header"><button className="planning-back" onClick={onBack}><Icon name="chevron" size={15} />Projects</button><h1>{project?.name || 'Project'}</h1></header>
    {error && <p role="alert" className="error-banner">{error} <button onClick={() => void perform(reload)}>Retry</button></p>}
    {project ? <div className="project-detail" key={project.public_id}>
      <section className="project-overview" aria-label="Project overview">
        <header className="planning-detail-heading"><div><h2>{project.name}</h2>{project.description && <p>{project.description}</p>}</div><span className="planning-status">{project.status}</span></header>
        <div className="project-progress"><strong>{project.progress.percent}% covered</strong><progress value={project.progress.percent} max={100} aria-label="Project stock coverage" /><span>{project.progress.completed_lines}/{project.progress.total_lines} covered · {project.progress.missing_lines} missing</span></div>
        <ProjectActions key={project.public_id} project={project} locations={locations} busy={busy} perform={perform}>
        <details className="project-edit"><summary>Project details</summary><ProjectEditor key={`${project.public_id}-${project.status}-${project.name}`} project={project} targets={targets} busy={busy} onSave={(data) => perform(() => applyOperation({ op: 'modify', type: 'project', match: { public_id: project.public_id }, data }))} /></details>
        </ProjectActions>
      </section>
      <header className="requirements-heading"><h3>Required items <span>{project.requirements.length}</span></h3><button className="primary" onClick={() => setEditing('new')}>Add requirement</button></header>
      {sortedGroups.map(([id, group]) => <section className="requirement-group" key={id ?? 'uncategorised'} aria-label={group.name}>
        <header><h4>{group.name}</h4><span>{group.entries.length} item{group.entries.length === 1 ? '' : 's'}</span></header>
        {group.entries.map((entry) => <RequirementRow key={entry.public_id} entry={entry} projectStatus={project.status} busy={busy}
          onOpenItem={() => { if (entry.item) void api.item(entry.item).then(onOpenItem).catch((reason: Error) => setError(reason.message)); }}
          onEdit={() => setEditing(entry)} onLink={() => setLinking(entry)} onStock={() => setStocking(entry)} onPatch={(data) => void patchRequirement(entry, data)} />)}
      </section>)}
      {!project.requirements.length && <div className="empty-inline">No required items yet. Add a requirement to start planning.</div>}
    </div> : <div className="compatibility-placeholder"><Icon name="tag" size={28} /><h2>{loaded ? 'Project unavailable' : 'Loading project…'}</h2><p>{loaded ? 'Go back and choose a project from the list.' : 'Fetching requirements and stock coverage.'}</p></div>}
    {project && editing && <RequirementEditor key={`${project.public_id}:${editing === "new" ? "new" : editing.public_id}`} currency={project.currency} error={error} entry={editing === 'new' ? null : editing} project={project.public_id} categories={categories} targets={targets} busy={busy} onClose={() => setEditing(null)} onSave={async (data) => { const saved = await perform(() => applyOperation({ op: editing === 'new' ? 'add' : 'modify', type: 'project_requirement', ...(editing !== 'new' ? { match: { public_id: editing.public_id } } : {}), data })); if (saved) setEditing(null); return saved; }} />}
    {project && (linking || stocking) && <RequirementStockPicker error={error} entry={(linking || stocking)!} project={project.public_id} locations={locations} mode={linking ? 'link' : 'stock'} busy={busy} onClose={() => { setLinking(null); setStocking(null); }} onApply={async (action) => { const saved = await perform(action); if (saved) { setLinking(null); setStocking(null); } }} />}
  </section>;
}

function ProjectEditor({ project, targets, busy, onSave }: { project: PlanningProject; targets: CompatibilityTarget[]; busy: boolean; onSave: (data: Record<string, unknown>) => Promise<boolean> }) {
  const draft = useDeviceDraft(`project:${project.public_id}`, { name: project.name, description: project.description, notes: project.notes, status: project.status, compatibility: project.compatibility, multiplier: project.multiplier, currency: project.currency, links: project.links.map(link => `${link.label} | ${link.url}`).join("\n") });
  const { value: values, set: setValues } = draft;
  const [links, setLinks] = draftField(draft, "links");
  return <form className="form-card compact-form" onSubmit={(event) => { event.preventDefault(); void onSave({ ...values, links: parseLinkText(links) }).then(saved => { if (saved) void draft.clear(values); }); }}><DraftNotice draft={draft} onDiscard={() => { void draft.clear(); }} /><label>Name<input required value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} /></label><label>Description<textarea value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} /></label><label>Notes<textarea value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} /></label><label>Build count<input type="number" min="1" max="10000" required value={values.multiplier} onChange={event => setValues({ ...values, multiplier: Number(event.target.value) })} /></label><label>Currency<input required pattern="[A-Z]{3}" maxLength={3} value={values.currency} onChange={event => setValues({ ...values, currency: event.target.value.toUpperCase() })} /></label><label>Links (label | URL, one per line)<textarea value={links} onChange={event => setLinks(event.target.value)} /></label><label>Status<select value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value })}>{['planned', 'active', 'completed', 'archived'].map((status) => <option key={status}>{status}</option>)}</select></label><TargetChoices targets={targets} values={values.compatibility} onChange={(compatibility) => setValues({ ...values, compatibility })} /><button disabled={busy}>Save project</button></form>;
}
