import { useCallback, useEffect, useState } from "react";
import { HttpRequestError, request } from "../../api";
import { loadSavedInventoryViews, saveSavedInventoryViews, type SavedInventoryView } from "./formula";

const MIGRATED = "findstuff.savedViews.shared.v1";
export function useSavedViews() {
  const [views, setViews] = useState(loadSavedInventoryViews);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const reload = useCallback(async () => {
    try {
      let remote = await request<SavedInventoryView[]>("/api/v1/saved-views");
      if (!Array.isArray(remote)) throw new Error("Saved views could not load");
      if (!localStorage.getItem(MIGRATED)) {
        for (const old of loadSavedInventoryViews()) {
          if (remote.some((entry) => entry.id === old.id)) continue;
          const { revision: _revision, ...view } = old;
          try { await request(`/api/v1/saved-views/${encodeURIComponent(old.id)}`, { method: "PUT", body: JSON.stringify({ view, expected_revision: null }) }); }
          catch (reason) { if (!(reason instanceof HttpRequestError && reason.status === 409)) throw reason; }
        }
        remote = await request<SavedInventoryView[]>("/api/v1/saved-views");
        localStorage.setItem(MIGRATED, "1");
      }
      setViews(remote); saveSavedInventoryViews(remote); setConnected(true); setError("");
    } catch { setConnected(false); setError("Showing views saved on this device. Reconnect to share changes."); }
  }, []);
  useEffect(() => {
    void reload();
    const refresh = () => { if (document.visibilityState !== "hidden") void reload(); };
    window.addEventListener("online", refresh); window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh); };
  }, [reload]);
  const save = async (view: SavedInventoryView) => {
    setBusy(true);
    try {
      const { revision, ...body } = view;
      await request(`/api/v1/saved-views/${encodeURIComponent(view.id)}`, { method: "PUT", body: JSON.stringify({ view: body, expected_revision: revision ?? null }) });
      await reload(); return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save view"); return false; }
    finally { setBusy(false); }
  };
  const remove = async (view: SavedInventoryView) => {
    if (!view.revision) return;
    setBusy(true);
    try { await request(`/api/v1/saved-views/${encodeURIComponent(view.id)}?revision=${view.revision}`, { method: "DELETE" }); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete view"); }
    finally { setBusy(false); }
  };
  return { views, save, remove, reload, busy, error, connected };
}
