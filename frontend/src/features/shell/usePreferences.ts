import { useEffect, useState } from "react";
import { api, type HomePreferences } from "../../api";
const initial: HomePreferences = { pinned_places: [], favorite_categories: [], show_shopping: true };
export function usePreferences() {
  const [preferences, setPreferences] = useState(initial);
  const [error, setError] = useState("");
  const load = () => api.preferences().then((value) => { setPreferences(value); setError(""); }).catch(() => setError("Preferences could not load. Reconnect and retry."));
  useEffect(() => { void load(); }, []);
  const save = async (values: Partial<HomePreferences>) => {
    try { setPreferences(await api.savePreferences(values)); setError(""); }
    catch { setError("Preferences could not be saved. Reconnect and retry."); }
  };
  return { preferences, save, error, reload: load };
}
