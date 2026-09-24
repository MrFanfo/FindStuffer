import { useEffect, useState } from 'react';
import { api, request, type Item, type LocationNode, type Category } from '../../api';
import { CategoryValueInputs } from '../../components/CategoryValueInputs';
import { HierarchyPicker, locationPickerNodes } from '../../components/HierarchyPicker';
import { Icon } from '../../components/Icon';

type Contents = { items: Item[]; total: number; quantities_by_unit: Record<string, string> };
export function ItemContents({ item, editing, locations, categories, onChanged }: { item: Item; editing: boolean; locations: LocationNode[]; categories: Category[]; onChanged: (item: Item) => Promise<void> }) {
  const [contents, setContents] = useState<Contents | null>(null);
  const [mode, setMode] = useState<'add' | 'move' | 'parent' | null>(null);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState('');
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [movingOut, setMovingOut] = useState<Item | null>(null);
  const [filter, setFilter] = useState('');
  const reload = () => request<Contents>(`/api/v1/items/${item.public_id}/contents`).then(setContents);
  useEffect(() => { if (item.is_container) void reload().catch(e => setError(String(e))); }, [item.public_id, item.version, item.is_container]);
  useEffect(() => {
    if (!query.trim() || !mode) { setCandidates([]); return; }
    let active = true;
    const timer = window.setTimeout(() => { void api.itemPage(query, null).then(page => {
      if (active) setCandidates(page.items.filter(row => row.public_id !== item.public_id && (mode !== 'parent' || row.is_container)));
    }).catch(e => { if (active) setError(String(e)); }); }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, mode, item.public_id]);
  async function perform(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); await onChanged(await api.item(item.public_id)); if (item.is_container) await reload(); setMode(null); setMovingOut(null); setQuery(''); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  if (!editing && !item.is_container && !item.container_item_id) return null;
  // The chain runs from the immediate container outwards.
  const parent = item.container_chain?.[0];
  const needle = filter.trim().toLowerCase();
  const shownContents = contents ? contents.items.filter((child) => !needle || `${child.name} ${child.category_path || ''}`.toLowerCase().includes(needle)) : [];
  const panels = <>
    {mode === 'add' && <form className="contents-panel" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void perform(() => api.createItem({ name: data.get('name'), quantity: data.get('quantity'), unit: data.get('unit'), category_id: category ? Number(category) : null, container_item_id: item.public_id, custom_fields: fields })); }}>
      <header><strong>New item inside {item.name}</strong><button type="button" className="contents-panel-close" aria-label="Close" onClick={() => setMode(null)}><Icon name="close" size={14} /></button></header>
      <label>Name<input name="name" required maxLength={240} autoFocus placeholder="What is it?" /></label>
      <div className="contents-panel-pair"><label>Quantity<input name="quantity" type="number" min="0" step="0.001" defaultValue="1" required /></label><label>Unit<input name="unit" defaultValue="pcs" required /></label></div>
      <label>Category<select value={category} onChange={event => { setCategory(event.target.value); setFields({}); }}><option value="">Uncategorised</option>{categories.map(row => <option key={row.id} value={row.id}>{row.path}</option>)}</select></label>
      <CategoryValueInputs category={category} values={fields} onChange={setFields} />
      <div className="contents-panel-actions"><button type="button" onClick={() => setMode(null)}>Cancel</button><button className="primary" disabled={busy}>Add inside</button></div>
    </form>}
    {(mode === 'move' || mode === 'parent') && <div className="contents-panel">
      <header><strong>{mode === 'parent' ? 'Put it inside…' : `Move an item into ${item.name}`}</strong><button type="button" className="contents-panel-close" aria-label="Close" onClick={() => { setMode(null); setQuery(''); }}><Icon name="close" size={14} /></button></header>
      <label className="contents-search"><Icon name="search" size={15} /><input aria-label="Search inventory" autoFocus type="search" placeholder={mode === 'parent' ? 'Search boxes, cases and bags' : 'Search your inventory'} value={query} onChange={event => setQuery(event.target.value)} /></label>
      {!query.trim() && <p className="contents-hint">{mode === 'parent' ? 'Only items that hold other items are listed.' : 'Type a name, brand or barcode.'}</p>}
      {query.trim() && candidates.length === 0 && <p className="contents-hint">Nothing matches yet.</p>}
      <div className="contents-choices">{candidates.map(candidate => <button type="button" className="contents-choice" key={candidate.public_id} disabled={busy} onClick={() => void perform(() => mode === 'parent' ? api.updateItem(item, { container_item_id: candidate.public_id }) : api.updateItem(candidate, { container_item_id: item.public_id }))}><span><strong>{candidate.name}</strong><small>{candidate.containment_path || candidate.location_path}</small></span><Icon name="plus" size={15} /></button>)}</div>
    </div>}
  </>;
  return <section className={`detail-section item-contents${item.is_container ? ' is-container' : ''}`}><div className="section-heading"><h2>{item.is_container ? 'Contents' : 'Storage'}</h2></div>
    {/* Editing shows two plain rows, like the More tab, rather than a loose checkbox and button. */}
    {editing && <div className="action-rows storage-rows">
      <label className="storage-toggle"><Icon name="box" size={17} /><span><strong>Holds other items</strong><small>{item.is_container ? 'A box, case or bag with contents' : 'Make it a box, case or bag'}</small></span><input type="checkbox" role="switch" checked={Boolean(item.is_container)} disabled={busy} onChange={event => void perform(() => api.updateItem(item, { is_container: event.target.checked }))} /></label>
      <button type="button" aria-expanded={mode === 'parent'} onClick={() => setMode(mode === 'parent' ? null : 'parent')}><Icon name="pin" size={17} /><span><strong>{parent ? 'Put in a different item' : 'Put inside another item'}</strong><small>{parent ? `Now inside ${parent.name}` : 'Not inside anything'}</small></span><Icon name="chevron" size={15} /></button>
    </div>}
    {item.container_item_id && <p>Inside {item.container_chain?.map((parent, index) => <span key={parent.public_id}>{index > 0 && ' > '}<a href={`?view=inventory&item=${parent.public_id}`}>{parent.name}</a></span>)} · {item.location_path}</p>}
    {item.container_item_id && <div className="compact-actions"><button type="button" onClick={() => setMovingOut(item)}>Move out</button></div>}
    {!item.is_container && panels}
    {contents && item.is_container && <>
      <div className="contents-summary"><span>{contents.total} kind{contents.total === 1 ? '' : 's'}{Object.entries(contents.quantities_by_unit).map(([unit, total]) => ` · ${total} ${unit}`)}</span><div className="contents-tools"><button type="button" className={mode === 'add' ? 'active' : ''} aria-expanded={mode === 'add'} onClick={() => setMode(mode === 'add' ? null : 'add')}><Icon name="plus" size={14} />Add</button><button type="button" className={mode === 'move' ? 'active' : ''} aria-expanded={mode === 'move'} onClick={() => { setMode(mode === 'move' ? null : 'move'); setQuery(''); }}><Icon name="box" size={14} />Move in</button></div></div>
      {contents.items.length > 8 && <label className="contents-search contents-filter"><Icon name="search" size={15} /><input type="search" aria-label="Filter contents" placeholder="Filter what is inside" value={filter} onChange={event => setFilter(event.target.value)} /></label>}
      {panels}
      <div className="contents-list">{shownContents.map(child => {
        const low = child.low_stock_enabled !== false && child.low_stock_threshold !== null && Number(child.quantity) <= Number(child.low_stock_threshold);
        const category = child.category_path || 'Uncategorised';
        return <div key={child.public_id}>
          <article className={`contents-row${child.is_container ? ' is-container' : ''}`}>
            <a className="contents-item" href={`?view=inventory&item=${child.public_id}`}>
              {child.primary_photo_url ? <img src={child.primary_photo_url} alt="" loading="lazy" /> : <span className="contents-thumb" aria-hidden="true"><Icon name="box" size={15} /></span>}
              <span className="contents-copy"><strong>{child.name}</strong><small title={category}>{category.split(' > ').pop()}{low && <b> · Low</b>}</small></span>
              <em>{child.is_container ? `${child.contents_count ?? 0} inside` : `${child.quantity} ${child.unit}`}</em>
            </a>
            <button type="button" className="contents-out" disabled={busy} aria-label={`Move ${child.name} out`} title="Move out" onClick={() => setMovingOut(child)}><Icon name="pin" size={15} /></button>
          </article>
        </div>;
      })}{shownContents.length === 0 && <p className="contents-none">Nothing inside matches “{filter}”.</p>}</div>
    </>}
    {movingOut && <HierarchyPicker title={`Move ${movingOut.name} out`} nodes={locationPickerNodes(locations)} selectedId={item.location_public_id} emptyLabel="No places inside this one" chooseLabel="Move here" currentChooseLabel="Move here" onChoose={(id) => { const leaving = movingOut; setMovingOut(null); void perform(() => api.updateItem(leaving, { container_item_id: null, location_public_id: id })); }} onClose={() => setMovingOut(null)} />}
    {error && <p role="alert">{error}</p>}
  </section>;
}
