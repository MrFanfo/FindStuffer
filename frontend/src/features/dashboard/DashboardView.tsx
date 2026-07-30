import { useCallback, useEffect, useState } from "react";

import { api, Dashboard, ShoppingEntry } from "../../api";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { InventoryFilter } from "../inventory/formula";

type CaptureMode = "scan" | "quick" | "putaway" | "consume" | "assistant";

export function DashboardView({
  dashboard,
  detailsCount,
  connectionIssue,
  onRetry,
  onCapture,
  onGlobalSearch,
  onInventory,
  onNotice,
}: {
  dashboard: Dashboard | null;
  detailsCount: number;
  connectionIssue: string;
  onRetry: () => void;
  onCapture: (mode?: CaptureMode) => void;
  onGlobalSearch: () => void;
  onInventory: (filter: InventoryFilter) => void;
  onNotice: (message: string) => void;
}) {
  const [shopping, setShopping] = useState<ShoppingEntry[]>([]);
  const [newEntry, setNewEntry] = useState("");
  const loadShopping = useCallback(async () => {
    try { setShopping(await api.shopping()); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Could not load the shopping list"); }
  }, [onNotice]);
  useEffect(() => {
    if (!dashboard || connectionIssue) return;
    void loadShopping();
  }, [connectionIssue, dashboard, loadShopping]);
  async function shoppingAction(action: () => Promise<unknown>, success?: string): Promise<boolean> {
    try { await action(); await loadShopping(); if (success) onNotice(success); return true; }
    catch (error) { onNotice(error instanceof Error ? error.message : "Could not update the shopping list"); return false; }
  }
  if (!dashboard) return (
    <div className="dashboard-load-failed">
      <EmptyState icon="spark" title="Home could not load" text={connectionIssue || "Findstuff could not reach the backend."} action={{ label: "Try again", onClick: onRetry }} />
    </div>
  );
  return (
    <section className="dashboard-page">
      {connectionIssue && <div className="connection-panel" role="status"><div><strong>Using local view</strong><span>{connectionIssue}</span></div><button className="outline-button" type="button" onClick={onRetry}>Retry</button></div>}
      <button className="where-button" onClick={onGlobalSearch}><span><Icon name="search" size={25} /></span><div><small>GLOBAL SEARCH</small><strong>Find anything in Findstuff</strong></div><kbd>⌘K</kbd></button>
      <div className="attention-strip" aria-label="Inventory shortcuts">
        <button className={dashboard.low_stock_count ? "hot" : ""} onClick={() => onInventory("low")}><strong>{dashboard.low_stock_count}</strong><span>low stock</span></button>
        <button className={dashboard.expiring_count ? "hot" : ""} onClick={() => onInventory("expiring")}><strong>{dashboard.expiring_count}</strong><span>expiring</span></button>
        <button className={detailsCount ? "hot" : ""} onClick={() => onInventory("details")}><strong>{detailsCount}</strong><span>missing location</span></button>
      </div>
      <div className="quick-grid">
        <button onClick={() => onCapture("quick")}><span><Icon name="plus" /></span><strong>Quick capture</strong><small>Type, photo, or template</small></button>
        <button onClick={() => onCapture("scan")}><span><Icon name="scan" /></span><strong>Scan code</strong><small>Barcode or QR</small></button>
      </div>
      <div className="dashboard-columns">
        <section className="shopping-panel"><div className="section-heading"><div><h2>Shopping list</h2><span>{shopping.filter((entry) => !entry.checked).length} remaining</span></div><button className="text-button" onClick={() => onInventory("low")}>Review low stock</button></div><form className="search shopping-add" onSubmit={(event) => { event.preventDefault(); if (newEntry.trim()) void shoppingAction(() => api.addShopping(newEntry), "Shopping item added").then((ok) => { if (ok) setNewEntry(""); }); }}><input value={newEntry} onChange={(event) => setNewEntry(event.target.value)} placeholder="Add something to buy" aria-label="Shopping item" /><button className="icon-button primary" aria-label="Add shopping item"><Icon name="plus" /></button></form><div className="shopping-list">{shopping.length === 0 && <div className="empty-inline"><span>Your list is clear</span></div>}{shopping.map((entry) => <label className={`shopping-entry ${entry.checked ? "checked" : ""}`} key={entry.public_id}><input type="checkbox" checked={entry.checked} onChange={(event) => void shoppingAction(() => api.checkShopping(entry, event.target.checked))} /><span>{entry.name}</span><small>{entry.quantity} {entry.unit}</small></label>)}</div></section>
      </div>
    </section>
  );
}
