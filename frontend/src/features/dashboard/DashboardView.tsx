import { type ReactNode } from "react";
import { usePreferences } from "../shell/usePreferences";
import { useCallback, useEffect, useState } from "react";

import { api, Dashboard, ShoppingEntry } from "../../api";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { InventoryFilter } from "../inventory/formula";

type CaptureMode = "scan" | "quick" | "putaway" | "consume" | "assistant";

export function DashboardView({
  children,
  dashboard,
  detailsCount,
  connectionIssue,
  onRetry,
  onCapture,
  onGlobalSearch,
  onInventory,
  onNotice,
}: {
  children?: ReactNode;
  dashboard: Dashboard | null;
  detailsCount: number;
  connectionIssue: string;
  onRetry: () => void;
  onCapture: (mode?: CaptureMode) => void;
  onGlobalSearch: () => void;
  onInventory: (filter: InventoryFilter) => void;
  onNotice: (message: string) => void;
}) {
  const { preferences, loaded: preferencesLoaded, error: preferenceError, reload } = usePreferences();
  const [shoppingError, setShoppingError] = useState("");
  const [shopping, setShopping] = useState<ShoppingEntry[]>([]);
  const [newEntry, setNewEntry] = useState("");
  const loadShopping = useCallback(async () => {
    try { setShopping(await api.shopping()); setShoppingError(""); }
    catch { setShoppingError("Shopping list could not load."); }
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
  // Each row names the fix rather than the metric, and a count of zero is not
  // something to act on, so it leaves the list entirely.
  const plural = (count: number) => (count === 1 ? "" : "s");
  const attentionRows: Array<{ filter: InventoryFilter; count: number; tone: string; title: string; detail: string }> = ([
    { filter: "expiring" as InventoryFilter, count: dashboard.expiring_count, tone: "critical",
      title: `${dashboard.expiring_count} item${plural(dashboard.expiring_count)} expiring soon`, detail: "Use them up or plan a replacement" },
    { filter: "low" as InventoryFilter, count: dashboard.low_stock_count, tone: "hot",
      title: `${dashboard.low_stock_count} item${plural(dashboard.low_stock_count)} low on stock`, detail: "Review and add to the shopping list" },
    { filter: "details" as InventoryFilter, count: detailsCount, tone: "hot",
      title: `${detailsCount} item${plural(detailsCount)} without a place`, detail: "Put them away to make them findable" },
  ]).filter((row) => row.count > 0);
  return (
    <section className="dashboard-page"><header className="page-heading"><div><p className="eyebrow">YOUR INVENTORY</p><h1>Home</h1></div></header>
      {connectionIssue && <div className="connection-panel" role="status"><div><strong>Using local view</strong><span>{connectionIssue}</span></div><button className="outline-button" type="button" onClick={onRetry}>Retry</button></div>}
      <button className="where-button" onClick={onGlobalSearch}><span><Icon name="search" size={25} /></span><div><small>GLOBAL SEARCH</small><strong>Find anything in Findstuff</strong></div><kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"}</kbd></button>
      {attentionRows.length > 0 && <div className="attention-strip" aria-label="Needs attention">
        {attentionRows.map((row) => (
          <button key={row.filter} className={row.tone} onClick={() => onInventory(row.filter)}>
            <span className="attention-count">{row.count}</span>
            <span className="attention-copy"><strong>{row.title}</strong><small>{row.detail}</small></span>
            <Icon name="chevron" size={17} />
          </button>
        ))}
      </div>}
      <div className="quick-grid">
        <button onClick={() => onCapture("quick")}><span><Icon name="plus" /></span><strong>Quick capture</strong><small>Type, photo, or template</small></button>
        <button onClick={() => onCapture("scan")}><span><Icon name="scan" /></span><strong>Scan code</strong><small>Barcode or QR</small></button>
      </div>
      {children}
      {preferenceError && <p role="alert">{preferenceError} <button onClick={() => void reload()}>Retry</button></p>}
      {preferencesLoaded && preferences.show_shopping && <div className="dashboard-columns">
        <section className="shopping-panel">{shoppingError && <p className="error-banner" role="alert">{shoppingError} <button onClick={() => void loadShopping()}>Retry</button></p>}<div className="section-heading"><div><h2>Shopping list</h2><span>{shopping.filter((entry) => !entry.checked).length} remaining</span></div><button className="text-button" onClick={() => onInventory("low")}>Review low stock</button></div><form className="search shopping-add" onSubmit={(event) => { event.preventDefault(); if (newEntry.trim()) void shoppingAction(() => api.addShopping(newEntry), "Shopping item added").then((ok) => { if (ok) setNewEntry(""); }); }}><input value={newEntry} onChange={(event) => setNewEntry(event.target.value)} placeholder="Add something to buy" aria-label="Shopping item" /><button className="icon-button primary" aria-label="Add shopping item"><Icon name="plus" /></button></form><div className="shopping-list">{shopping.length === 0 && !shoppingError && <div className="empty-inline"><span>Your list is clear</span></div>}{shopping.map((entry) => <label className={`shopping-entry ${entry.checked ? "checked" : ""}`} key={entry.public_id}><input type="checkbox" checked={entry.checked} onChange={(event) => void shoppingAction(() => api.checkShopping(entry, event.target.checked))} /><span>{entry.name}</span><small>{entry.quantity} {entry.unit}</small></label>)}</div></section>
      </div>}
    </section>
  );
}
