import { useEffect, useState } from "react";
import { api, type Item, type PhotoSuggestion, type PhotoSuggestionPage } from "../api";
import { usePreferences } from "../features/shell/usePreferences";
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
  const { preferences, loaded: preferencesLoaded } = usePreferences();
  const count = Math.min(8, Math.max(1, preferences.photo_suggestion_count || 4));
  const [position, setPosition] = useState(0);
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState<PhotoSuggestionPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const item = items[position];

  useEffect(() => {
    if (!item || !preferencesLoaded) return;
    let cancelled = false;
    setLoading(true);
    setPage(null);
    setError("");
    void api.photoSuggestions(item.public_id, offset, count)
      .then((found) => { if (!cancelled) setPage(found); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Image search is unavailable. Try again."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [item?.public_id, offset, count, preferencesLoaded, retry]);

  function advance() { setPosition((value) => value + 1); setOffset(0); setPage(null); setError(""); }

  async function accept(suggestion: PhotoSuggestion) {
    if (!item || saving) return;
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

  return <div className="modal-backdrop photo-finder-backdrop" role="dialog" aria-modal="true" aria-label="Find item photo" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="photo-finder-sheet">
      <header><div><p className="eyebrow">FIND PHOTO</p><h2>{title}</h2><span>{item ? `${position + 1} of ${items.length}` : "Done"}</span></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close photo finder"><Icon name="close" /></button></header>
      {item ? <>
        <div className="photo-finder-item"><strong>{item.name}</strong><small>{item.brand ? `${item.brand} · ` : ""}{item.location_path}</small></div>
        {(loading || !preferencesLoaded) && <div className="photo-finder-preview"><span>Finding photos…</span></div>}
        {!loading && page && page.suggestions.length > 0 && <>
          <p className="photo-finder-hint">Choose a photo to save it to this item.</p>
          <div className={`photo-finder-grid${count === 1 ? " single" : ""}`}>
            {page.suggestions.map((suggestion) => {
              const source = safeSource(suggestion.source_page);
              return <div className="photo-finder-choice" key={suggestion.result_index}>
                <button type="button" disabled={saving} onClick={() => void accept(suggestion)} aria-label={`Save photo: ${suggestion.title}`}>
                  <img src={suggestion.data_url} alt={suggestion.title} />
                  <span>{suggestion.title}</span>
                </button>
                <small>{Math.ceil(suggestion.size_bytes / 1024)} KB{source && <> · <a href={source} target="_blank" rel="noreferrer">Source</a></>}</small>
              </div>;
            })}
          </div>
        </>}
        {!loading && page && page.suggestions.length === 0 && <div className="photo-finder-preview"><span>No usable photos found in these results.</span></div>}
        {saving && <p className="photo-finder-hint" role="status">Saving photo…</p>}
        {error && <p className="inline-alert" role="alert">{error}</p>}
        <footer>
          <button type="button" className="secondary" disabled={saving} onClick={advance}>Skip item</button>
          <button type="button" className="secondary" disabled={loading || saving || (!page?.has_more && !(error && !page))} onClick={() => {
            if (error && !page) { setRetry((value) => value + 1); }
            else if (page) setOffset(page.next_offset);
          }}>{error && !page ? "Try search again" : `Next ${count === 1 ? "photo" : "photos"}`}</button>
        </footer>
      </> : <div className="photo-finder-done"><Icon name="check" size={32} /><strong>All items reviewed</strong><button type="button" className="primary" onClick={onClose}>Done</button></div>}
    </section>
  </div>;
}
