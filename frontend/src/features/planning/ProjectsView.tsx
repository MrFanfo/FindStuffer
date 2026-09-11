import { Icon } from "../../components/Icon";
import { useCallback, useEffect, useState } from 'react';
import { applyOperation, extensions, type CompatibilityTarget, type PlanningProject } from '../../extensionApi';
import { TargetChoices } from './TargetChoices';

export function ProjectsView({ onBack, onOpenProject }: { onBack: () => void; onOpenProject: (publicId: string) => void }) {
  const [projects, setProjects] = useState<PlanningProject[]>([]);
  const [targets, setTargets] = useState<CompatibilityTarget[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [name, setName] = useState(''); const [description, setDescription] = useState('');
  const [projectTargets, setProjectTargets] = useState<string[]>([]);
  const reload = useCallback(async () => { const results = await Promise.allSettled([extensions.projects(), extensions.targets()]); if (results[0].status === 'fulfilled') setProjects(results[0].value); if (results[1].status === 'fulfilled') setTargets(results[1].value); const failed = results.filter((result) => result.status === 'rejected'); if (failed.length) throw new Error('Projects or compatibility targets could not load'); }, []);
  useEffect(() => { void reload().catch((reason: Error) => setError(reason.message)); }, [reload]);
  async function perform(action: () => Promise<unknown>) { setBusy(true); setError(''); try { await action(); await reload(); return true; } catch (reason) { setError(reason instanceof Error ? reason.message : 'Change failed'); return false; } finally { setBusy(false); } }
  return <section className="workspace-page projects-page planning-page">
    <header className="workspace-header"><button className="planning-back" onClick={onBack}><Icon name="chevron" size={15} />More</button><h1>Projects</h1></header>
    {error && <p role="alert" className="error-banner">{error} <button onClick={() => void perform(reload)}>Retry</button></p>}
    <div className="project-browser">
      <p className="target-browser-count">{projects.length} project{projects.length === 1 ? '' : 's'}</p>
      <div className="project-browser-list">{projects.map((entry) => <button className="project-card" key={entry.public_id} onClick={() => onOpenProject(entry.public_id)}>
        <span className="project-card-main"><strong>{entry.name}</strong><small>{entry.description || 'No description'}</small></span>
        <span className="project-card-progress"><span className="planning-status">{entry.status}</span><progress value={entry.progress?.percent || 0} max={100} aria-label={`${entry.name} stock coverage`} /><small>{entry.progress?.percent || 0}% covered</small></span>
        <Icon name="chevron" size={15} />
      </button>)}</div>
      {!projects.length && <p className="planning-empty">No projects yet. Create one to plan requirements, purchases and compatibility.</p>}
      <details className="project-create"><summary>Create project</summary><form className="form-card compact-form" onSubmit={(event) => { event.preventDefault(); void perform(() => applyOperation({ op: 'add', type: 'project', data: { name, description, compatibility: projectTargets } })).then((saved) => { if (saved) { setName(''); setDescription(''); setProjectTargets([]); } }); }}><label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label><TargetChoices targets={targets} values={projectTargets} onChange={setProjectTargets} /><button className="primary" disabled={busy}>Create project</button></form></details>
    </div>
  </section>;
}
