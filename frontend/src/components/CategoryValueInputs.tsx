import { useEffect, useState } from 'react';
import { extensions, type CategoryField } from '../extensionApi';

export function CategoryValueInputs({ category, values, onChange }: { category: string; values: Record<string, unknown>; onChange: (values: Record<string, unknown>) => void }) {
  const [fields, setFields] = useState<CategoryField[]>([]);
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true; setFields([]); setError('');
    if (category) void extensions.fields(Number(category)).then((result) => { if (current) setFields(result.filter((field) => field.active)); }).catch(() => { if (current) setError('Category properties could not load. You can retry, or save to Inbox and complete them later.'); });
    return () => { current = false; };
  }, [category, retry]);
  if (!category || (!fields.length && !error)) return null;
  return <fieldset className="category-value-inputs"><legend>Category properties</legend>{error && <p role="alert">{error} <button type="button" onClick={() => setRetry(retry + 1)}>Retry properties</button></p>}{fields.map((field) => <label key={field.public_id}>{field.label}{field.unit ? ` (${field.unit})` : ''}{field.required ? ' *' : ''}<CustomFieldInput field={field} value={Object.hasOwn(values, field.value_field_id) ? values[field.value_field_id] : field.default} onChange={(value) => onChange({ ...Object.fromEntries(Object.entries(values).filter(([key]) => fields.some((entry) => entry.value_field_id === key))), [field.value_field_id]: value })} /><small>{field.description}{field.inherited ? ` · Inherited from ${field.source_category_path}` : ''}</small></label>)}</fieldset>;
}

export function CustomFieldInput({ field, value, onChange }: { field: CategoryField; value: unknown; onChange: (value: unknown) => void }) {
  if (field.type === 'boolean') return <select value={value === null || value === undefined ? '' : String(value)} onChange={(event) => onChange(event.target.value === '' ? null : event.target.value === 'true')}><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></select>;
  if (field.type === 'enum') return <select value={String(value ?? '')} onChange={(event) => onChange(event.target.value || null)}><option value="">Not set</option>{field.allowed_values.map((option) => <option key={option}>{option}</option>)}</select>;
  if (field.type === 'text') return <textarea value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />;
  return <input type={field.type === 'date' ? 'date' : field.type === 'url' ? 'url' : 'text'} inputMode={field.type === 'integer' || field.type === 'decimal' ? 'decimal' : undefined} value={String(value ?? '')} onChange={(event) => onChange(field.type === 'integer' ? event.target.value === '' ? null : Number(event.target.value) : field.type === 'decimal' || field.type === 'date' ? event.target.value || null : field.nullable && event.target.value === '' ? null : event.target.value)} />;
}
