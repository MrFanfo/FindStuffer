import { useEffect, useState } from "react";
import { downloadOfflineInventory, loadOfflineSnapshot } from "../../offline";
export function OfflineDownload({ offline }: { offline: boolean }) {
  const [summary, setSummary] = useState('Checking this device…');
  const [busy, setBusy] = useState(false);
  const load = () => loadOfflineSnapshot().then((cache) => setSummary(cache ? `${cache.value.items.length} items cached · ${cache.completeAt ? `full download ${new Date(cache.completeAt).toLocaleString()}` : 'partial inventory'}` : 'No inventory downloaded yet.')).catch(() => setSummary('Offline storage is unavailable.'));
  useEffect(() => {
    void load();
    const updated = () => { setBusy(false); void load(); };
    const progress = (event: Event) => { setBusy(true); setSummary(`Downloading… ${(event as CustomEvent<number>).detail} items`); };
    window.addEventListener('findstuff:cache-updated', updated);
    window.addEventListener('findstuff:cache-progress', progress);
    return () => { window.removeEventListener('findstuff:cache-updated', updated); window.removeEventListener('findstuff:cache-progress', progress); };
  }, []);
  async function download() {
    setBusy(true);
    try { await downloadOfflineInventory((count) => setSummary(`Downloading… ${count} items`)); await load(); }
    catch { setSummary('Download interrupted. Your previous cache is still available. Try again.'); }
    finally { setBusy(false); }
  }
  return <section className="workspace-card"><h2>Inventory on this device</h2><p role="status">{summary}</p><p>Item records download automatically while online and refresh every five minutes. Photos and documents require a connection. This cache is separate from a backup.</p><button disabled={busy || offline} onClick={() => void download()}>Download full inventory</button></section>;
}
