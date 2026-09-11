import { useEffect, useState } from 'react';
import { extensions, type CompatibilityTarget } from '../../extensionApi';

export function TargetParts({ target, excludeItem }: { target: CompatibilityTarget; excludeItem: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof extensions.target>> | null>(null);
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void extensions.target(target.public_id).then((next) => { if (active) { setData(next); setError(''); } }).catch(() => { if (active) setError('Could not load parts for this target.'); });
    return () => { active = false; };
  }, [target.public_id, retry]);
  return <div className="target-parts"><h3>Parts for <a href={`?view=compatibility&target=${encodeURIComponent(target.public_id)}`}>{target.name}</a>{!target.active && ' (inactive target)'}</h3>{error && <p role="alert">{error} <button type="button" onClick={() => setRetry(retry + 1)}>Retry</button></p>}
    {data?.items.filter((item) => item.public_id !== excludeItem).map((item) => <div className="related-part" key={item.public_id}><a href={`?view=inventory&item=${encodeURIComponent(item.public_id)}`}>{item.name}</a><span>{item.quantity} {item.unit} · {item.location_path}</span><small>{item.effective_compatibility.status.replaceAll('_', ' ')}{item.effective_compatibility.inherited ? ` · inherited from ${item.effective_compatibility.source_name}` : ''}</small>{item.effective_compatibility.notes && <p>{item.effective_compatibility.notes}</p>}{item.effective_compatibility.adapter && <p>Adapter: {item.effective_compatibility.adapter}</p>}{item.effective_compatibility.source_url && <a href={item.effective_compatibility.source_url} target="_blank" rel="noreferrer">Evidence</a>}</div>)}
    {data?.next_offset !== null && data?.next_offset !== undefined && <button type="button" disabled={busy} onClick={() => { setBusy(true); void extensions.target(target.public_id, data.next_offset!).then((next) => setData({ ...next, items: [...data.items, ...next.items] })).catch(() => setError('Could not load more parts.')).finally(() => setBusy(false)); }}>More related parts</button>}
  </div>;
}
