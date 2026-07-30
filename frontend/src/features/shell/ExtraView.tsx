import { OfflineOperation } from "../../offline";
import { Icon } from "../../components/Icon";

export function ExtraView({
  offlineOperations,
  offlineMode,
  syncing,
  onAnalytics,
  onSettings,
  onSync,
  onDiscard,
}: {
  offlineOperations: OfflineOperation[];
  offlineMode: boolean;
  syncing: boolean;
  onAnalytics: () => void;
  onSettings: () => void;
  onSync: () => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
}) {
  return <section className="extra-page">
    <div className="page-heading"><div><p className="eyebrow">EXTRA</p><h1>More ways to use Findstuff</h1><p>Analytics lives here now. Future tools can grow here without crowding the main inventory workflow.</p></div></div>
    <div className="extra-tool-grid">
      <button type="button" className="extra-tool-card featured" onClick={onAnalytics}><span><Icon name="spark" size={24} /></span><div><strong>Analytics</strong><small>Inventory health, value, activity, Places, Categories, and consumption.</small></div><Icon name="chevron" size={18} /></button>
      <button type="button" className="extra-tool-card" onClick={onSettings}><span><Icon name="settings" size={24} /></span><div><strong>Settings & data</strong><small>Backups, imports, integrations, customization, projects, and system information.</small></div><Icon name="chevron" size={18} /></button>
    </div>
    <section className="offline-queue-card">
      <header><div><p className="eyebrow">PWA OFFLINE CAPTURE</p><h2>{offlineOperations.length ? `${offlineOperations.length} change${offlineOperations.length === 1 ? "" : "s"} waiting` : "Everything is synchronized"}</h2></div><b className={offlineMode ? "offline" : "ready"}>{offlineMode ? "Offline" : "Online"}</b></header>
      <p>Add Items—with compressed photos—and adjust quantities while Findstuff is unreachable. This device synchronizes them in order after reconnecting.</p>
      {offlineOperations.length > 0 && <div className="offline-operation-list">{offlineOperations.map((operation) => <article key={operation.id} className={operation.error ? "error" : ""}><span><Icon name={operation.kind === "create_item" ? "plus" : "minus"} size={15} /></span><div><strong>{operation.kind === "create_item" ? String(operation.payload.name || "New item") : operation.payload.item_name}</strong><small>{operation.kind === "create_item" ? "Offline item capture" : `${operation.payload.delta > 0 ? "+" : ""}${operation.payload.delta} quantity`} · {new Date(operation.createdAt).toLocaleString()}</small>{operation.error && <em>{operation.error}</em>}</div>{operation.error && !offlineMode && <button type="button" onClick={() => void onDiscard(operation.id)}>Discard</button>}</article>)}</div>}
      <button type="button" className="primary wide" disabled={offlineMode || syncing || offlineOperations.length === 0} onClick={() => void onSync()}>{syncing ? "Synchronizing…" : "Synchronize now"}</button>
      <small>Unsynced captures remain only on this device until synchronization completes.</small>
    </section>
  </section>;
}
