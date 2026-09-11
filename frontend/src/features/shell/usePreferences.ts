import { useEffect, useState } from "react";
import { api, type HomePreferences } from "../../api";
const initial: HomePreferences = { pinned_places: [], favorite_categories: [], show_shopping: true };
export function usePreferences() {
  const [preferences, setPreferences] = useState(initial);
  // Home sections stay hidden until the stored answer arrives, so a disabled
  // section never flashes into view on the optimistic defaults above.
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const load = () => api.preferences().then((value) => { setPreferences(value); setError(""); }).catch(() => setError("Preferences could not load. Reconnect and retry.")).finally(() => setLoaded(true));
  useEffect(() => { void load(); }, []);
  const save = async (values: Partial<HomePreferences>) => {
    try { setPreferences(await api.savePreferences(values)); setError(""); }
    catch { setError("Preferences could not be saved. Reconnect and retry."); }
  };
  return { preferences, loaded, save, error, reload: load };
}
