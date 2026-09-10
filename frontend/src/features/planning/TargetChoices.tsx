import type { CompatibilityTarget } from '../../extensionApi';
export function TargetChoices({ targets, values, onChange, label = 'Compatibility targets' }: { targets: CompatibilityTarget[]; values: string[]; onChange: (values: string[]) => void; label?: string }) {
  return <label>{label}<select multiple value={values} onChange={(event) => onChange(Array.from(event.target.selectedOptions, (option) => option.value))}>{targets.filter((target) => target.active || values.includes(target.public_id)).map((target) => <option key={target.public_id} value={target.public_id}>{target.name}{!target.active ? ' (inactive)' : ''}</option>)}</select><small>Select none to leave unspecified. Use Ctrl/Cmd to select several.</small></label>;
}
