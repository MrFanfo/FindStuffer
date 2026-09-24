import { type ReactNode, useEffect, useState } from 'react';
import type { Item } from '../../api';
import { extensions, type CompatibilityRelation, type CompatibilityTarget, type ItemExtensions } from '../../extensionApi';
import { TargetChoices } from '../planning/TargetChoices';
import { TargetParts } from './TargetParts';

export type RelatedDraft = { compatibility: CompatibilityRelation[]; compatibility_targets: string[] };

export function ItemStructuredData({ item, editing = false, relatedEnabled = true, children, onDraftChange }: {
  item: Item; editing?: boolean; relatedEnabled?: boolean; children?: ReactNode;
  onDraftChange?: (draft: RelatedDraft) => void;
}) {
  const [data, setData] = useState<ItemExtensions | null>(null);
  const [targets, setTargets] = useState<CompatibilityTarget[]>([]);
  const [relations, setRelations] = useState<CompatibilityRelation[]>([]);
  const [represented, setRepresented] = useState<string[]>([]);
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void extensions.item(item.public_id).then((details) => {
      if (!active) return;
      setData(details); setRelations(details.compatibility);
      setRepresented((details.compatibility_targets || []).map((target) => target.public_id)); setError('');
    }).catch(() => { if (active) setError('Item properties and related data could not load.'); });
    return () => { active = false; };
  }, [item.public_id, item.version, retry]);
  useEffect(() => {
    if (!editing || !relatedEnabled) return;
    let active = true;
    void extensions.targets().then((choices) => { if (active) setTargets(choices); }).catch(() => { if (active) setError('Related target choices could not load.'); });
    return () => { active = false; };
  }, [editing, relatedEnabled, retry]);
  function change(nextRelations: CompatibilityRelation[], nextTargets = represented) {
    setRelations(nextRelations); setRepresented(nextTargets);
    onDraftChange?.({ compatibility: nextRelations.map(({ target, status, notes, source_url, adapter }) => ({ target, status, notes, source_url, adapter })), compatibility_targets: nextTargets });
  }
  const properties = data?.field_definitions.flatMap((field) => {
    const value = Object.hasOwn(data.custom_fields, field.value_field_id) ? data.custom_fields[field.value_field_id] : field.default;
    return value === null || value === undefined || value === '' ? [] : [{ field, value }];
  }) || [];
  const showRelated = relatedEnabled && (editing || relations.length > 0 || represented.length > 0 || children || Boolean(data?.projects?.length));
  return <>
    {error && <p role="alert">{error} <button type="button" onClick={() => setRetry(retry + 1)}>Retry related details</button></p>}
    {!editing && properties.length > 0 && <section className="detail-section structured-item-data">
      <div className="section-heading"><div><h2>Properties</h2><span>{properties.length} recorded</span></div></div>
      <dl className="fact-rows">{properties.map(({ field, value }) => <div className="fact-row" key={field.public_id}>
        <dt>{field.label}</dt>
        <dd>{typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value)}{field.unit ? <small>{field.unit}</small> : null}</dd>
      </div>)}</dl>
    </section>}
    {showRelated && <section className="detail-section related-section"><h2>Related</h2>
      {(editing || relations.length > 0) && <><h3>Works with</h3>{relations.map((relation, index) => <div className="item-compatibility-row" key={`${index}-${relation.target}`}>
        {editing ? <><label>Target<select value={relation.target} onChange={(event) => change(relations.map((row, i) => i === index ? { ...row, target: event.target.value } : row))}><option value="">Choose target</option>{targets.map((target) => <option key={target.public_id} value={target.public_id}>{target.name}{!target.active ? ' (inactive)' : ''}</option>)}</select></label><label>Relationship<select value={relation.status} onChange={(event) => change(relations.map((row, i) => i === index ? { ...row, status: event.target.value } : row))}>{['compatible', 'incompatible', 'requires_adapter', 'partial', 'unknown'].map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></label>{(['notes', 'source_url', 'adapter'] as const).map((key) => <label key={key}>{key.replaceAll('_', ' ')}<input value={relation[key]} onChange={(event) => change(relations.map((row, i) => i === index ? { ...row, [key]: event.target.value } : row))} /></label>)}<button type="button" onClick={() => change(relations.filter((_, i) => i !== index))}>Remove relationship</button></> : <><a href={`?view=compatibility&target=${encodeURIComponent(relation.target)}`}>{relation.target_name || relation.target}</a><strong>{relation.status.replaceAll('_', ' ')}</strong>{relation.notes && <p>{relation.notes}</p>}{relation.adapter && <p>Adapter: {relation.adapter}</p>}{relation.source_url && <a href={relation.source_url} target="_blank" rel="noreferrer">Evidence</a>}</>}
      </div>)}{editing && <button type="button" onClick={() => change([...relations, { target: '', status: 'compatible', notes: '', source_url: '', adapter: '' }])}>Add relationship</button>}</>}
      {editing ? <><TargetChoices label="This item is a physical instance of" targets={targets} values={represented} onChange={(next) => change(relations, next)} /><p className="muted">For example, link your printer to its model target. Its compatible parts appear here. The target and its relationships survive selling or deleting this item.</p><a href="?view=compatibility" target="_blank" rel="noreferrer">Manage related targets</a></> : data?.compatibility_targets?.map((target) => <TargetParts key={target.public_id} target={target} excludeItem={item.public_id} />)}
      {children}
      {!editing && Boolean(data?.projects?.length) && <><h3>Used in projects</h3>{data?.projects?.map((project) => <p key={project.requirement_public_id}><a href={`?view=projects&project=${encodeURIComponent(project.public_id)}`}>{project.name}</a> · {project.requirement_name}</p>)}</>}
    </section>}
  </>;
}
