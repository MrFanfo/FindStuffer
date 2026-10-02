import { useEffect, useState } from "react";
import { api, type Item, type PhotoSuggestion } from "../api";
import { Icon } from "./Icon";

function safeSource(url: string): string | null {
  try { const parsed = new URL(url); return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null; }
  catch { return null; }
}

export function PhotoFinderSession({ title, items, onClose, onSaved }: {
  title: string;
  items: Item[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [position, setPosition] = useState(0);
  const [resultIndex, setResultIndex] = useState(0);
  const [suggestion, setSuggestion] = useState<PhotoSuggestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const item = items[position];
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setLoading(true);
    setSuggestion(null);
    setError("");
    void api.photoSuggestion(item.public_id, resultIndex)
      .then((found) => { if (!cancelled) setSuggestion(found); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not find a photo"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [item?.public_id, resultIndex]);
  function advance() { setPosition((value) => value + 1); setResultIndex(0); setSuggestion(null); setError(""); }
  async function accept() {
    if (!item || !suggestion || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(suggestion.data_url);
      const photo = await response.blob();
      await api.uploadPhoto(item, photo, suggestion.width, suggestion.height);
      await onSaved();
      advance();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save photo");
    } finally {
      setSaving(false);
    }
  }
  const source = suggestion ? safeSource(suggestion.source_page) : null;
  return <div className="modal-backdrop photo-finder-backdrop" role="dialog" aria-modal="true" aria-label="Find item photo" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="photo-finder-sheet">
      <header><div><p className="eyebrow">FIND PHOTO</p><h2>{title}</h2><span>{item ? `${position + 1} of ${items.length}` : "Done"}</span></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close photo finder"><Icon name="close" /></button></header>
      {item ? <>
        <div className="photo-finder-item"><strong>{item.name}</strong><small>{item.brand ? `${item.brand} · ` : ""}{item.location_path}</small></div>
        {loading && <div className="photo-finder-preview"><span>Searching images…</span></div>}
        {!loading && suggestion && <><div className="photo-finder-preview"><img src={suggestion.data_url} alt={`Suggested photo for ${item.name}`} /></div><div className="photo-finder-source"><span>{suggestion.title}</span><small>{suggestion.query} · {Math.ceil(suggestion.size_bytes / 1024)} KB</small>{source && <a href={source} target="_blank" rel="noreferrer">View source</a>}</div></>}
        {!loading && !suggestion && !error && <div className="photo-finder-preview"><span>No photo found</span></div>}
        {error && <p className="inline-alert" role="alert">{error}</p>}
        <footer><button type="button" className="secondary" disabled={saving} onClick={advance}>Skip item</button><button type="button" className="secondary" disabled={loading || saving || resultIndex >= 4} onClick={() => setResultIndex((value) => value + 1)}>Next image</button><button type="button" className="primary" disabled={!suggestion || loading || saving} onClick={() => void accept()}>{saving ? "Saving…" : "Accept & save"}</button></footer>
      </> : <div className="photo-finder-done"><Icon name="check" size={32} /><strong>All items reviewed</strong><button type="button" className="primary" onClick={onClose}>Done</button></div>}
    </section>
  </div>;
}
