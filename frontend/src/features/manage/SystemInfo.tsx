import type { ApplicationSettings } from "../../api";
import { Icon } from "../../components/Icon";

type SystemInfoData = NonNullable<ApplicationSettings["system"]>;
type SetupHealthEntry = { label: string; status: string; detail: string };

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return "<1 min";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function SystemInfo({
  system,
  diskFreePercent,
  setupHealth,
  onRefresh,
}: {
  system: SystemInfoData | undefined;
  diskFreePercent: number;
  setupHealth: SetupHealthEntry[];
  onRefresh: () => void;
}) {
  return <details className="app-info-section"><summary><span className="summary-icon"><Icon name="settings" /></span><span><strong>App info</strong><small>{setupHealth.some((entry) => entry.status === "Needs attention") ? `${setupHealth.filter((entry) => entry.status === "Needs attention").length} need attention` : system ? `Everything ready · version ${system.app.version}` : "Health, storage, resources, and version"}</small></span><Icon name="chevron" /></summary><div className="manage-panel app-info-panel">
    <section className="app-info-health"><div className="section-heading"><div><h2>Setup health</h2><span>Connection, protection, Backups, integrations, and updates</span></div></div><div className="setup-health-grid">{setupHealth.map((entry) => <article key={entry.label}><span>{entry.label}</span><b className={`health-status ${entry.status.toLowerCase().replace(" ", "-")}`}>{entry.status}</b><small>{entry.detail}</small></article>)}</div></section>
    {system ? <>
      <div className="section-heading app-info-metrics-heading"><div><h2>Storage & resources</h2><span>Current usage on this FindStuffer machine</span></div></div>
      <div className="app-metric-grid">
        <div><span>Total data</span><strong>{formatBytes(system.storage.total_managed_bytes)}</strong><small>Database + photos + documents</small></div>
        <div><span>Database</span><strong>{formatBytes(system.storage.database_bytes)}</strong><small>{formatBytes(system.storage.database_main_bytes)} main · {formatBytes(system.storage.database_wal_bytes)} WAL</small></div>
        <div><span>Photos</span><strong>{formatBytes(system.storage.photos_bytes)}</strong><small>{system.inventory.photos} saved photo{system.inventory.photos === 1 ? "" : "s"}</small></div>
        <div><span>Documents</span><strong>{formatBytes(system.storage.documents_bytes)}</strong><small>{system.inventory.documents} owned document{system.inventory.documents === 1 ? "" : "s"}</small></div>
        <div><span>App CPU</span><strong>{system.resources.cpu_percent.toFixed(1)}%</strong><small>{system.resources.cpu_count} CPU core{system.resources.cpu_count === 1 ? "" : "s"} available</small></div>
        <div><span>App RAM</span><strong>{formatBytes(system.resources.memory_rss_bytes)}</strong><small>Current resident memory</small></div>
        <div><span>Disk free</span><strong>{formatBytes(system.storage.disk_free_bytes)}</strong><small>{diskFreePercent}% of {formatBytes(system.storage.disk_total_bytes)}</small></div>
      </div>
      <div className="integration-list app-info-list"><p><span>Inventory</span><small>{system.inventory.items} Items · {system.inventory.locations} Places · {system.inventory.categories} Categories</small></p><p><span>Version</span><code>{system.app.version}</code></p><p><span>License</span><a href="https://github.com/MrFanfo/FindStuffer" target="_blank" rel="noreferrer">AGPL-3.0-only · Source code</a></p><p><span>Running for</span><small>{formatUptime(system.app.uptime_seconds)}</small></p></div>
      <details className="nested-form technical-details"><summary>Technical details</summary><div className="integration-list app-info-list">
        <p><span>Other data folder usage</span><small>{formatBytes(system.storage.other_data_bytes)}</small></p>
        <p><span>Database engine</span><small>{system.database.journal_mode.toUpperCase()} · {system.database.page_count.toLocaleString()} pages · {formatBytes(system.database.page_size)} page size</small></p>
        <p><span>Started</span><small>{new Date(system.app.started_at).toLocaleString()}</small></p>
        <p><span>Process</span><small>PID {system.app.process_id} · Python {system.app.python_version}</small></p>
        <p><span>Database path</span><code>{system.storage.database_path}</code></p>
        <p><span>Data folder</span><code>{system.storage.data_dir}</code></p>
      </div></details>
      <button className="outline-button" onClick={onRefresh}>Refresh info</button>
    </> : <div className="empty-inline"><span>Loading app information</span></div>}
  </div></details>;
}
