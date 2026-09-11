import { useState } from 'react';
import type { Category } from '../../api';
import { categoryOptionLabel } from '../../domain/inventory';
import type { CompatibilityTarget } from '../../extensionApi';

export function TargetEditor({ target, targets, categories, busy, onSave }: {
  target: CompatibilityTarget | null;
  targets: CompatibilityTarget[];
  categories: Category[];
  busy: boolean;
  onSave: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = useState({ name: target?.name || '', manufacturer: target?.manufacturer || '', model: target?.model || '', type: target?.type || '', aliases: target?.aliases.join('\n') || '', parent: target?.parent || '', category: target?.category ? String(target.category) : '', active: target?.active ?? true });
  return <form className="form-card compact-form" onSubmit={(event) => { event.preventDefault(); void onSave({ ...values, aliases: values.aliases.split('\n').map((value) => value.trim()).filter(Boolean), parent: values.parent || null, category: values.category ? Number(values.category) : null }); }}>
    {(['name', 'manufacturer', 'model', 'type'] as const).map((key) => <label key={key}>{key}<input required={key === 'name'} value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} /></label>)}
    <label>Aliases, one per line<textarea value={values.aliases} onChange={(event) => setValues({ ...values, aliases: event.target.value })} /></label>
    <label>Category<select value={values.category} onChange={(event) => setValues({ ...values, category: event.target.value })}><option value="">Uncategorised</option>{categories.map((entry) => <option key={entry.id} value={entry.id}>{categoryOptionLabel(entry)}</option>)}</select></label>
    <label>Parent / family<select value={values.parent} onChange={(event) => setValues({ ...values, parent: event.target.value })}><option value="">No parent</option>{targets.filter((entry) => entry.public_id !== target?.public_id).map((entry) => <option key={entry.public_id} value={entry.public_id}>{entry.name}</option>)}</select></label>
    <label><input type="checkbox" checked={values.active} onChange={(event) => setValues({ ...values, active: event.target.checked })} />Active</label>
    <p>Category only groups targets on the Compatibility list; it never changes which items a target matches. Deactivation retains relationships. Choose family parents carefully: their relationships can apply to descendants unless explicitly overridden.</p>
    <button className="primary" disabled={busy}>Save target</button>
  </form>;
}
