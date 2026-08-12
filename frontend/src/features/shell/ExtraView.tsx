import { OfflineOperation } from "../../offline";
import { Icon } from "../../components/Icon";

export function ExtraView({
  offlineOperations,
  offlineMode,
  syncing,
  onAnalytics,
  onData,
  onInventoryManagement,
  onSettings,
  onSync,
  onDiscard,
}: {
  offlineOperations: OfflineOperation[];
  offlineMode: boolean;
  syncing: boolean;
  onAnalytics: () => void;
  onData: () => void;
  onInventoryManagement: () => void;
  onSettings: () => void;
  onSync: () => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
}) {
  return <section className="extra-page">
    <div className="page-heading"><div><p className="eyebrow">EXTRA</p><h1>More ways to use Findstuff</h1><p>Explore insights, protect your data, manage inventory life, and configure your installation from focused workspaces.</p></div></div>
    <div className="extra-tool-grid">
      <button type="button" className="extra-tool-card featured" onClick={onAnalytics}><span><Icon name="spark" size={24} /></span><div><strong>Analytics</strong><small>Inventory health, value, activity, Places, Categories, and consumption.</small></div><Icon name="chevron" size={18} /></button>
      <button type="button" className="extra-tool-card data" onClick={onData}><span><Icon name="qr" size={24} /></span><div><strong>Data</strong><small>Full backups, portable exports, safe restore, previewed imports, and undo history.</small></div><Icon name="chevron" size={18} /></button>
      <button type="button" className="extra-tool-card inventory-management" onClick={onInventoryManagement}><span><Icon name="box" size={24} /></span><div><strong>Inventory management</strong><small>Lost and archived items, projects, reservations, and borrowed or lent records.</small></div><Icon name="chevron" size={18} /></button>
      <button type="button" className="extra-tool-card" onClick={onSettings}><span><Icon name="settings" size={24} /></span><div><strong>Settings</strong><small>Appearance, security, notifications, integrations, customization, and system information.</small></div><Icon name="chevron" size={18} /></button>
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
