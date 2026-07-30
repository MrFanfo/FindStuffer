import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { api, type Analytics } from "../../api";
import { Icon } from "../../components/Icon";
import { friendlyErrorMessage } from "../../domain/errors";
import type { InventoryFilter } from "../inventory/formula";

function analyticsMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

type ActivityBucket = {
  start: string;
  end: string;
  value: number;
  created: number;
  quantity_in: number;
  quantity_out: number;
  moved: number;
  changes: number;
};

type ActivityField = "changes" | "created" | "quantity_in" | "quantity_out" | "moved";
type ActivityMetric = ActivityField | `source:${string}`;
type ActivityRange = { start: string; end: string };

function analyticsDate(value: string, includeDay = true): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: includeDay ? "numeric" : undefined,
  });
}

function ActivityTrend({
  buckets,
  metricLabel,
  selected,
  onSelect,
}: {
  buckets: ActivityBucket[];
  metricLabel: string;
  selected: ActivityRange | null;
  onSelect: (range: ActivityRange) => void;
}) {
  const width = 720;
  const height = 250;
  const padding = { top: 18, right: 14, bottom: 36, left: 40 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(1, ...buckets.map((entry) => entry.value));
  const x = (index: number) => padding.left + (buckets.length === 1 ? plotWidth / 2 : index / (buckets.length - 1) * plotWidth);
  const y = (value: number) => padding.top + plotHeight - value / max * plotHeight;
  const points = buckets.map((entry, index) => `${x(index)},${y(entry.value)}`).join(" ");
  const area = buckets.length
    ? `${padding.left},${padding.top + plotHeight} ${points} ${x(buckets.length - 1)},${padding.top + plotHeight}`
    : "";
  const labelIndexes = new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1]);

  return <div className="trend-chart-wrap">
    <svg className="trend-chart interactive-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metricLabel} activity trend`}>
      {[0, .25, .5, .75, 1].map((ratio) => {
        const value = Math.round(max * ratio);
        return <g key={ratio}>
          <line x1={padding.left} x2={width - padding.right} y1={y(value)} y2={y(value)} />
          <text x={padding.left - 8} y={y(value) + 4} textAnchor="end">{value}</text>
        </g>;
      })}
      {buckets.length > 0 && <path className="trend-area" d={`M ${area} Z`} />}
      {buckets.length > 0 && <polyline className="trend-line" points={points} />}
      {buckets.map((entry, index) => {
        const isSelected = selected?.start === entry.start && selected.end === entry.end;
        const choose = () => onSelect({ start: entry.start, end: entry.end });
        return <g className={`trend-mark ${isSelected ? "selected" : ""}`} key={entry.start}>
        <circle className="trend-point" cx={x(index)} cy={y(entry.value)} r={entry.value ? 3.5 : 2} />
        <circle className="trend-hit" cx={x(index)} cy={y(entry.value)} r="13" tabIndex={0} role="button" aria-label={`${analyticsDate(entry.start)}: ${entry.value} ${metricLabel.toLowerCase()}`} onClick={choose} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") choose(); }} />
        <title>{analyticsDate(entry.start)}: {entry.value} {metricLabel.toLowerCase()}</title>
        {labelIndexes.has(index) && <text className="trend-date" x={x(index)} y={height - 10} textAnchor={index === 0 ? "start" : index === buckets.length - 1 ? "end" : "middle"}>{analyticsDate(entry.end)}</text>}
      </g>;
      })}
    </svg>
  </div>;
}

function ActivityHeatmap({
  activity,
  valueForDay,
  selected,
  onSelect,
}: {
  activity: Analytics["activity"];
  valueForDay: (date: string, entry: Analytics["activity"][number]) => number;
  selected: ActivityRange | null;
  onSelect: (range: ActivityRange) => void;
}) {
  const recent = activity.slice(-91);
  const values = recent.map((entry) => valueForDay(entry.date, entry));
  const max = Math.max(1, ...values);
  return <div className="activity-calendar" aria-label="Recent daily activity heatmap">
    {recent.map((entry, index) => {
      const value = values[index];
      const selectedDay = selected?.start === entry.date && selected.end === entry.date;
      return <button
        type="button"
        key={entry.date}
        className={selectedDay ? "selected" : ""}
        style={{ "--heat": String(.12 + value / max * .88) } as CSSProperties}
        title={`${analyticsDate(entry.date)}: ${value} changes`}
        aria-label={`${analyticsDate(entry.date)}: ${value} changes`}
        onClick={() => onSelect({ start: entry.date, end: entry.date })}
      />;
    })}
  </div>;
}

function StockStatusChart({
  segments,
  onSelect,
}: {
  segments: Analytics["stock"];
  onSelect: (label: string) => void;
}) {
  const styledSegments = segments.map((entry) => ({
    ...entry,
    className: entry.label === "In stock" ? "healthy" : entry.label === "Low" ? "low" : "empty",
  }));
  const total = Math.max(1, styledSegments.reduce((sum, entry) => sum + entry.count, 0));
  let offset = 0;
  return <div className="stock-status-chart">
    <div className="stock-donut">
      <svg viewBox="0 0 120 120" role="img" aria-label="Stock status">
        <circle className="stock-track" cx="60" cy="60" r="48" />
        {styledSegments.map((entry) => {
          const length = entry.count / total * 301.59;
          const segment = <circle key={entry.label} className={`${entry.className} interactive-segment`} cx="60" cy="60" r="48" strokeDasharray={`${length} ${301.59 - length}`} strokeDashoffset={-offset} onClick={() => onSelect(entry.label)} />;
          offset += length;
          return segment;
        })}
      </svg>
      <span><strong>{segments.reduce((sum, entry) => sum + entry.count, 0)}</strong><small>Items</small></span>
    </div>
    <div className="chart-legend">{styledSegments.map((entry) => <button type="button" key={entry.label} onClick={() => onSelect(entry.label)}><i className={entry.className} /><span>{entry.label}</span><strong>{entry.count}</strong><Icon name="chevron" size={13} /></button>)}</div>
  </div>;
}

export function AnalyticsView({
  onBack,
  onInventory,
  onCategory,
  onLocation,
  onItem,
}: {
  onBack: () => void;
  onInventory: (filter: InventoryFilter) => void;
  onCategory: (id: number | null) => void;
  onLocation: (id: string) => void;
  onItem: (id: string) => void;
}) {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [activityMetric, setActivityMetric] = useState<ActivityMetric>("changes");
  const [selectedRange, setSelectedRange] = useState<ActivityRange | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api.analytics(days)
      .then((result) => { if (active) setData(result); })
      .catch((reason) => { if (active) setError(friendlyErrorMessage(reason, "Could not load analytics")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [days]);

  useEffect(() => setSelectedRange(null), [activityMetric, days]);

  const maxCategory = Math.max(1, ...(data?.categories.map((entry) => entry.item_count) || [1]));
  const maxLocation = Math.max(1, ...(data?.locations.map((entry) => entry.item_count) || [1]));
  const sourceByDay = useMemo(() => new Map(
    data?.source_activity.map((entry) => [`${entry.date}:${entry.source}`, entry.changes]) || [],
  ), [data]);
  const valueForDay = useCallback((date: string, entry: Analytics["activity"][number]) => {
    if (activityMetric.startsWith("source:")) {
      return sourceByDay.get(`${date}:${activityMetric.slice(7)}`) || 0;
    }
    return entry[activityMetric as ActivityField];
  }, [activityMetric, sourceByDay]);
  const activityBuckets = useMemo(() => {
    if (!data?.activity.length) return [];
    const targetBuckets = days <= 30 ? 30 : days <= 90 ? 24 : 26;
    const bucketSize = Math.max(1, Math.ceil(data.activity.length / targetBuckets));
    const buckets: ActivityBucket[] = [];
    for (let index = 0; index < data.activity.length; index += bucketSize) {
      const group = data.activity.slice(index, index + bucketSize);
      buckets.push({
        start: group[0].date,
        end: group[group.length - 1].date,
        value: group.reduce((sum, entry) => sum + valueForDay(entry.date, entry), 0),
        changes: group.reduce((sum, entry) => sum + entry.changes, 0),
        created: group.reduce((sum, entry) => sum + entry.created, 0),
        quantity_in: group.reduce((sum, entry) => sum + entry.quantity_in, 0),
        quantity_out: group.reduce((sum, entry) => sum + entry.quantity_out, 0),
        moved: group.reduce((sum, entry) => sum + entry.moved, 0),
      });
    }
    return buckets;
  }, [data, days, valueForDay]);
  const comparison = data ? data.activity_summary.percent_change : null;
  const expirationTotal = Math.max(1, data?.expiration.reduce((sum, entry) => sum + entry.count, 0) || 1);
  const actionTotal = Math.max(1, data?.action_mix.reduce((sum, entry) => sum + entry.count, 0) || 1);
  const metricOptions: Array<{ key: ActivityMetric; label: string; count: number }> = data ? [
    { key: "changes", label: "All changes", count: data.activity_summary.current_events },
    { key: "created", label: "Created", count: data.action_mix.find((entry) => entry.key === "created")?.count || 0 },
    { key: "quantity_in", label: "Stock in", count: data.action_mix.find((entry) => entry.key === "stock_in")?.count || 0 },
    { key: "quantity_out", label: "Removed", count: data.action_mix.find((entry) => entry.key === "consumed")?.count || 0 },
    { key: "moved", label: "Moved", count: data.action_mix.find((entry) => entry.key === "moved")?.count || 0 },
  ] : [];
  const metricLabel = activityMetric.startsWith("source:")
    ? activityMetric.slice(7).replaceAll("_", " ")
    : metricOptions.find((entry) => entry.key === activityMetric)?.label || "All changes";
  const selectedActivity = useMemo(() => {
    if (!data || !selectedRange) return null;
    const entries = data.activity.filter((entry) => (
      entry.date >= selectedRange.start && entry.date <= selectedRange.end
    ));
    return {
      changes: entries.reduce((sum, entry) => sum + entry.changes, 0),
      created: entries.reduce((sum, entry) => sum + entry.created, 0),
      quantity_in: entries.reduce((sum, entry) => sum + entry.quantity_in, 0),
      quantity_out: entries.reduce((sum, entry) => sum + entry.quantity_out, 0),
      moved: entries.reduce((sum, entry) => sum + entry.moved, 0),
    };
  }, [data, selectedRange]);
  const stockFilters: Record<string, InventoryFilter> = {
    "In stock": "in-stock",
    Low: "low",
    Empty: "zero",
  };
  const expirationFilters: InventoryFilter[] = [
    "expired",
    "expiring-week",
    "expiry-8-30",
    "expiry-31-90",
    "expiry-later",
    "no-expiry",
  ];
  const ageFilters: InventoryFilter[] = ["added-30", "added-90", "added-365", "added-older"];

  return <section className="analytics-page">
    <header className="subpage-header analytics-title"><button className="icon-button" onClick={onBack} aria-label="Back to Extra"><Icon name="chevron" size={18} /></button><div><p className="eyebrow">EXTRA · ANALYTICS</p><h1>Inventory pulse</h1><p>Tap any signal to inspect the Items behind it.</p></div></header>
    <div className="analytics-toolbar"><div className="period-switch" aria-label="Activity period">{[30, 90, 365].map((period) => <button type="button" className={days === period ? "active" : ""} key={period} onClick={() => setDays(period)}>{period === 365 ? "1 year" : `${period} days`}</button>)}</div>{data && <small>Updated {new Date(data.generated_at).toLocaleString()}</small>}</div>
    {loading && <div className="analytics-loading"><span className="activity-spinner" />Calculating analytics…</div>}
    {error && <div className="inline-alert" role="alert">{error}</div>}
    {data && !loading && <>
      <section className="analytics-overview">
        <button type="button" onClick={() => onInventory("all")}><span>Active Items</span><strong>{data.summary.active_items}</strong><small>Browse inventory <Icon name="chevron" size={12} /></small></button>
        <button type="button" onClick={() => document.getElementById("analytics-activity")?.scrollIntoView({ behavior: "smooth" })}><span>Period changes</span><strong>{data.activity_summary.current_events}</strong><small className={comparison !== null && comparison > 0 ? "up" : comparison !== null && comparison < 0 ? "down" : ""}>{comparison === null ? "First period" : `${comparison > 0 ? "+" : ""}${comparison}% vs before`} <Icon name="chevron" size={12} /></small></button>
        <button type="button" onClick={() => onInventory("low")}><span>Low stock</span><strong>{data.summary.low_stock}</strong><small>Review stock <Icon name="chevron" size={12} /></small></button>
        <button type="button" onClick={() => onInventory("expiring-30")}><span>Expiring</span><strong>{data.summary.expiring_30_days}</strong><small>Next 30 days <Icon name="chevron" size={12} /></small></button>
      </section>
      <div className="analytics-metrics interactive-metrics" aria-label="Inventory alerts">
        {[
          ["Empty", data.summary.zero_stock, "No stock remaining", "attention", "zero"],
          ["Expired", data.summary.expired, "Past expiry date", "danger", "expired"],
          ["No place", data.summary.unassigned, "Still unassigned", "neutral", "details"],
          ["No category", data.summary.missing_category, "Needs classification", "neutral", "uncategorized"],
          ["No photo", data.summary.missing_photo, "Harder to recognise", "neutral", "missing-photo"],
          ["No notes", data.summary.missing_details, "No description or notes", "neutral", "missing-notes"],
        ].map(([label, value, detail, tone, filter]) => <button type="button" className={String(tone)} key={String(label)} onClick={() => onInventory(filter as InventoryFilter)}><span>{label}</span><strong>{value}</strong><small>{detail}</small><Icon name="chevron" size={14} /></button>)}
      </div>
      <section className="analytics-section activity-workspace" id="analytics-activity">
        <div className="section-heading analytics-heading"><div><p className="eyebrow">ACTIVITY</p><h2>Changes over time</h2><span>{data.days}-day event trend, grouped automatically for readability</span></div><div className="section-stat"><strong>{data.activity_summary.average_daily}</strong><span>daily average</span></div></div>
        <div className="analytics-filter-rail" aria-label="Activity metric">{metricOptions.map((entry) => <button type="button" key={entry.key} className={activityMetric === entry.key ? "active" : ""} aria-pressed={activityMetric === entry.key} onClick={() => setActivityMetric(entry.key)}><span>{entry.label}</span><strong>{entry.count}</strong></button>)}</div>
        {data.source_mix.length > 0 && <div className="source-chips analytics-source-filter"><span>Source</span>{data.source_mix.map((entry) => { const key: ActivityMetric = `source:${entry.source}`; return <button type="button" className={activityMetric === key ? "active" : ""} aria-pressed={activityMetric === key} key={entry.source} onClick={() => setActivityMetric(activityMetric === key ? "changes" : key)}><strong>{entry.count}</strong> {entry.source.replaceAll("_", " ")}</button>; })}</div>}
        <div className="activity-facts">
          <span><strong>{metricOptions.find((entry) => entry.key === activityMetric)?.count ?? data.source_mix.find((entry) => `source:${entry.source}` === activityMetric)?.count ?? 0}</strong> {metricLabel.toLowerCase()}</span>
          <span><strong>{data.activity_summary.active_days}</strong> active days</span>
          <span><strong>{data.activity_summary.busiest_day_events}</strong> busiest day{data.activity_summary.busiest_day && <small>{analyticsDate(data.activity_summary.busiest_day)}</small>}</span>
        </div>
        <ActivityTrend buckets={activityBuckets} metricLabel={metricLabel} selected={selectedRange} onSelect={setSelectedRange} />
        <div className="calendar-heading"><strong>Recent rhythm</strong><span>Tap a square to cross-filter the day</span></div>
        <ActivityHeatmap activity={data.activity} valueForDay={valueForDay} selected={selectedRange} onSelect={setSelectedRange} />
        {selectedRange && selectedActivity && <div className="selected-activity"><header><div><span>Selected</span><strong>{analyticsDate(selectedRange.start)}{selectedRange.end !== selectedRange.start ? ` – ${analyticsDate(selectedRange.end)}` : ""}</strong></div><button type="button" onClick={() => setSelectedRange(null)}>Clear</button></header><div>{[
          ["All", selectedActivity.changes],
          ["Created", selectedActivity.created],
          ["Stock in", selectedActivity.quantity_in],
          ["Removed", selectedActivity.quantity_out],
          ["Moved", selectedActivity.moved],
        ].map(([label, value]) => <button type="button" key={String(label)} onClick={() => setActivityMetric(label === "All" ? "changes" : label === "Created" ? "created" : label === "Stock in" ? "quantity_in" : label === "Removed" ? "quantity_out" : "moved")}><span>{label}</span><strong>{value}</strong></button>)}</div></div>}
      </section>
      <div className="analytics-columns">
        <section className="analytics-section"><div className="section-heading"><div><p className="eyebrow">STOCK</p><h2>Availability</h2><span>Tap a state to see its Items</span></div></div><StockStatusChart segments={data.stock} onSelect={(label) => onInventory(stockFilters[label])} /></section>
        <section className="analytics-section"><div className="section-heading"><div><p className="eyebrow">AGE</p><h2>Inventory age</h2><span>When active Items entered the catalog</span></div></div><div className="age-chart">{data.inventory_age.map((entry, index) => <button type="button" key={entry.label} onClick={() => onInventory(ageFilters[index])}><span><i style={{ height: `${Math.max(6, entry.count / Math.max(1, ...data.inventory_age.map((item) => item.count)) * 100)}%` }} /></span><strong>{entry.count}</strong><small>{entry.label}</small></button>)}</div></section>
      </div>
      <section className="analytics-section expiration-section"><div className="section-heading"><div><p className="eyebrow">EXPIRATION</p><h2>Expiry horizon</h2><span>Tap any window to open those Items</span></div></div><div className="expiration-bar interactive-composition" aria-label="Expiration timeline">{data.expiration.map((entry, index) => entry.count > 0 && <button type="button" key={entry.label} className={`expiry-${index}`} style={{ width: `${entry.count / expirationTotal * 100}%` }} title={`${entry.label}: ${entry.count}`} onClick={() => onInventory(expirationFilters[index])} />)}</div><div className="expiration-legend">{data.expiration.map((entry, index) => <button type="button" key={entry.label} onClick={() => onInventory(expirationFilters[index])}><i className={`expiry-${index}`} /><span>{entry.label}</span><strong>{entry.count}</strong><Icon name="chevron" size={13} /></button>)}</div></section>
      <section className="analytics-section">
        <div className="section-heading"><div><p className="eyebrow">VALUE</p><h2>Inventory value</h2><span>Unit price × current quantity, kept separate by currency</span></div></div>
        {data.values.length ? <div className="value-card-grid">{data.values.map((entry) => <button type="button" key={entry.currency} onClick={() => onInventory("priced")}><strong>{entry.currency}</strong><div><span>Purchase value<b>{analyticsMoney(entry.purchase_minor, entry.currency)}</b></span><span>Estimated value<b>{analyticsMoney(entry.estimated_minor, entry.currency)}</b></span></div><small>{data.summary.priced_items} priced Items <Icon name="chevron" size={12} /></small></button>)}</div> : <div className="empty-inline"><span>Add purchase or estimated prices to calculate value.</span></div>}
      </section>
      <div className="analytics-columns ranked-columns">
        <section className="analytics-section"><div className="section-heading"><div><p className="eyebrow">CATEGORIES</p><h2>Category concentration</h2><span>Tap a bar to open that Category</span></div></div><div className="rank-bars interactive-ranks">{data.categories.slice(0, 7).map((entry) => <button type="button" key={entry.label} onClick={() => onCategory(entry.category_id)}><div><strong title={entry.label}>{entry.label}</strong><b>{entry.item_count}</b></div><span><i style={{ width: `${entry.item_count / maxCategory * 100}%` }} /></span><Icon name="chevron" size={13} /></button>)}</div></section>
        <section className="analytics-section"><div className="section-heading"><div><p className="eyebrow">PLACES</p><h2>Inventory by Place</h2><span>Tap a bar to open that Place</span></div></div><div className="rank-bars interactive-ranks">{data.locations.slice(0, 7).map((entry) => <button type="button" key={entry.label} onClick={() => onLocation(entry.location_public_id)}><div><strong title={entry.label}>{entry.label}</strong><b>{entry.item_count}</b></div><span><i style={{ width: `${entry.item_count / maxLocation * 100}%` }} /></span><Icon name="chevron" size={13} /></button>)}</div></section>
      </div>
      {data.action_mix.length > 0 && <section className="analytics-section compact-mix"><div className="section-heading"><div><p className="eyebrow">WORKFLOW MIX</p><h2>How inventory changed</h2><span>Tap a segment to cross-filter the activity charts</span></div></div><div className="action-strip interactive-composition">{metricOptions.slice(1).map((entry, index) => <button type="button" key={entry.key} className={`mix-${index} ${activityMetric === entry.key ? "selected" : ""}`} style={{ width: `${entry.count / actionTotal * 100}%` }} onClick={() => { setActivityMetric(entry.key); document.getElementById("analytics-activity")?.scrollIntoView({ behavior: "smooth" }); }} title={`${entry.label}: ${entry.count}`} />)}</div><div className="action-details">{metricOptions.slice(1).map((entry, index) => <button type="button" key={entry.key} onClick={() => { setActivityMetric(entry.key); document.getElementById("analytics-activity")?.scrollIntoView({ behavior: "smooth" }); }}><i className={`mix-${index}`} /><span>{entry.label}</span><strong>{entry.count}</strong><Icon name="chevron" size={13} /></button>)}</div></section>}
      <div className="analytics-columns">
        <section className="analytics-section"><div className="section-heading"><div><p className="eyebrow">CONSUMPTION</p><h2>Most consumed</h2><span>Tap an Item to open it</span></div></div>{data.top_consumed.length ? <div className="consumption-list interactive-list">{data.top_consumed.map((entry, index) => <button type="button" key={entry.public_id} onClick={() => onItem(entry.public_id)}><b>{index + 1}</b><span><strong>{entry.name}</strong><small>{entry.quantity} {entry.unit} consumed</small></span><Icon name="chevron" size={14} /></button>)}</div> : <div className="empty-inline"><span>No quantity consumption recorded in this period.</span></div>}</section>
        <section className="analytics-section"><div className="section-heading"><div><p className="eyebrow">MOMENTUM</p><h2>Most changed</h2><span>Tap an Item to open it</span></div></div>{data.top_changed.length ? <div className="changed-list interactive-list">{data.top_changed.map((entry, index) => <button type="button" key={entry.public_id} onClick={() => onItem(entry.public_id)}><b>{index + 1}</b><span><strong>{entry.name}</strong><small>Last changed {new Date(entry.last_changed_at).toLocaleDateString()}</small></span><em>{entry.event_count} event{entry.event_count === 1 ? "" : "s"}</em><Icon name="chevron" size={14} /></button>)}</div> : <div className="empty-inline"><span>No Items changed in this period.</span></div>}</section>
      </div>
    </>}
  </section>;
}
