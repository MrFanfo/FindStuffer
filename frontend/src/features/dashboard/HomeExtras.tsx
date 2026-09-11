import { useEffect, useState } from "react";
import { api, flattenLocations, type Attention, type Item, type LocationNode } from "../../api";
import { SearchableFilterPicker } from "../../components/SearchableFilterPicker";
import { usePreferences } from "../shell/usePreferences";

export function HomeExtras({ locations, onItem, onPlace, onInbox, onManage, onCreatePlace, onCapture, onPrint, empty }: {
  locations: LocationNode[]; onItem: (item: Item) => void; onPlace: (id: string) => void;
  onInbox: () => void; onManage: () => void; onCreatePlace: () => void;
  onCapture: () => void; onPrint: () => void; empty: boolean;
}) {
  const { preferences, save, error: preferenceError, reload } = usePreferences();
  const [attention, setAttention] = useState<Attention | null>(null);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState(false);
  const places = flattenLocations(locations);
  const load = async () => {
    try { setAttention(await api.attention()); setError(''); }
    catch { setError('Home reminders could not load.'); }
  };
  useEffect(() => { void load(); }, []);
  const open = async (id: string) => { try { onItem(await api.item(id)); } catch { setError('This item could not open. Reconnect and retry.'); } };
  return <>
    {(error || preferenceError) && <p className="error-banner" role="alert">{error || preferenceError} <button onClick={() => { void load(); void reload(); }}>Retry</button></p>}
    {empty && <section className="workspace-card"><h2>Set up your first place</h2><ol className="onboarding-steps"><li><button onClick={onCreatePlace}>Create a room, shelf or box</button></li><li><button onClick={onCapture}>Add your first item</button></li><li><button onClick={onPrint}>Print a place label</button></li></ol></section>}
    <section className="home-section"><div className="section-heading"><h2>Pinned places</h2><button onClick={() => setPicker(true)}>Pin a place</button></div><div className="home-place-grid">{preferences.pinned_places.map((id) => places.find((place) => place.public_id === id)).filter((place) => place !== undefined).map((place) => <article key={place.public_id}><button onClick={() => onPlace(place.public_id)}><strong>{place.name}</strong><small>{place.path} · {place.total_item_count} items</small></button><button aria-label={`Unpin ${place.name}`} onClick={() => void save({ pinned_places: preferences.pinned_places.filter((id) => id !== place.public_id) })}>Unpin</button></article>)}{!preferences.pinned_places.length && <p className="muted">Keep frequently used places one tap away.</p>}</div></section>
    {attention && (attention.ai_pending > 0 || attention.reminders.length > 0) && <section className="home-section"><h2>Needs attention</h2>{attention.ai_pending > 0 && <button className="feature-link" onClick={onInbox}>AI Inbox · {attention.ai_pending} scans to review</button>}{attention.reminders.slice(0, 8).map((entry, index) => <button className="home-reminder" key={`${entry.item_id}-${index}`} onClick={() => entry.kind === 'loan' ? onManage() : void open(entry.item_id)}><strong>{entry.item_name}</strong><span>{entry.title} · {new Date(entry.due).toLocaleDateString()}</span></button>)}{attention.reminders.length > 8 && <p>{attention.reminders.length - 8} more reminders due</p>}</section>}
    {picker && <SearchableFilterPicker title="Pin a place to Home" icon="pin" selectedId="" emptyLabel="Cancel" options={places.filter((place) => !preferences.pinned_places.includes(place.public_id)).map((place) => ({ id: place.public_id, label: place.name, detail: place.path }))} onChoose={(id) => { if (id) void save({ pinned_places: [...preferences.pinned_places, id] }); }} onClose={() => setPicker(false)} />}
  </>;
}
