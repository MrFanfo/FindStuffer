import { type CSSProperties, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  flattenLocations,
  type AIScanProposal,
  type Category,
  type LocationNode,
} from "../../api";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";

type RetryNotice = { action: () => Promise<void>; label: string; message: string };

function AIScanProposalCard({ scan, categories, locations, units, busy, onSave, onApprove, onReject, onRetry }: {
  scan: AIScanProposal;
  categories: Category[];
  locations: LocationNode[];
  units: string[];
  busy: boolean;
  onSave: (changes: Record<string, unknown>) => Promise<void>;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onRetry: () => Promise<void>;
}) {
  const item = scan.proposal?.item;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item?.name || "");
  const [description, setDescription] = useState(item?.description || "");
  const [notes, setNotes] = useState(item?.notes || "");
  const [brand, setBrand] = useState(item?.brand || "");
  const [model, setModel] = useState(item?.model || "");
  const [barcode, setBarcode] = useState(item?.barcode || "");
  const [quantity, setQuantity] = useState(item?.quantity || "1");
  const [unit, setUnit] = useState(item?.unit || "pcs");
  const [categoryId, setCategoryId] = useState(item?.category_id ? String(item.category_id) : "");
  const [locationId, setLocationId] = useState(scan.location_public_id);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeSettling, setSwipeSettling] = useState(false);
  const swipeOffsetRef = useRef(0);
  const swipeFrame = useRef<number | null>(null);
  const swipeStart = useRef<{ x: number; y: number; pointerId: number; axis: "x" | "y" | null } | null>(null);
  const category = item?.category_id ? categories.find((entry) => entry.id === item.category_id) : null;

  useEffect(() => () => {
    if (swipeFrame.current !== null) window.cancelAnimationFrame(swipeFrame.current);
  }, []);

  useEffect(() => {
    if (editing || !item) return;
    setName(item.name);
    setDescription(item.description);
    setNotes(item.notes);
    setBrand(item.brand);
    setModel(item.model);
    setBarcode(item.barcode);
    setQuantity(item.quantity);
    setUnit(item.unit);
    setCategoryId(item.category_id ? String(item.category_id) : "");
    setLocationId(scan.location_public_id);
  }, [editing, item, scan.location_public_id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    await onSave({
      name,
      description,
      notes,
      brand,
      model,
      barcode,
      quantity,
      unit,
      category_id: categoryId ? Number(categoryId) : null,
      location_public_id: locationId,
    });
    setEditing(false);
  }

  function moveSwipe(offset: number) {
    swipeOffsetRef.current = offset;
    if (swipeFrame.current !== null) window.cancelAnimationFrame(swipeFrame.current);
    swipeFrame.current = window.requestAnimationFrame(() => {
      setSwipeOffset(offset);
      swipeFrame.current = null;
    });
  }

  function finishSwipe() {
    const offset = swipeOffsetRef.current;
    const threshold = Math.min(110, Math.max(76, window.innerWidth * 0.2));
    const action = offset > threshold ? onApprove : offset < -threshold ? onReject : null;
    const direction = offset > 0 ? 1 : -1;
    swipeStart.current = null;
    if (action && scan.status === "pending" && !busy && !editing) {
      setSwipeSettling(true);
      moveSwipe(direction * Math.max(window.innerWidth, 520));
      window.setTimeout(() => {
        void action().finally(() => {
          moveSwipe(0);
          setSwipeSettling(false);
        });
      }, 180);
      return;
    }
    setSwipeSettling(true);
    moveSwipe(0);
    window.setTimeout(() => setSwipeSettling(false), 180);
  }

  return <div
    className={`ai-swipe-shell ${swipeOffset > 0 ? "swiping-right" : swipeOffset < 0 ? "swiping-left" : ""}`}
    style={{ "--swipe-offset": `${swipeOffset}px`, "--swipe-opacity": Math.min(1, Math.abs(swipeOffset) / 70) } as CSSProperties}
  >
    <div className="ai-swipe-underlay approve" aria-hidden="true"><Icon name="check" size={24} /><strong>Approve</strong></div>
    <div className="ai-swipe-underlay reject" aria-hidden="true"><Icon name="close" size={24} /><strong>Reject</strong></div>
    <article
      className={`ai-proposal-card ${scan.status} ${swipeSettling ? "swipe-settling" : ""}`}
      onPointerDown={(event) => {
        if (editing || scan.status !== "pending" || busy || swipeSettling || !event.isPrimary) return;
        if (event.target instanceof Element && event.target.closest("button, input, select, textarea, label, a")) return;
        swipeStart.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, axis: null };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = swipeStart.current;
        if (!start || start.pointerId !== event.pointerId || editing || scan.status !== "pending") return;
        const x = event.clientX - start.x;
        const y = event.clientY - start.y;
        if (!start.axis && Math.max(Math.abs(x), Math.abs(y)) > 8) start.axis = Math.abs(x) > Math.abs(y) + 4 ? "x" : "y";
        if (start.axis === "x") {
          event.preventDefault();
          const resistance = 1 - Math.min(0.28, Math.abs(x) / Math.max(window.innerWidth, 1) * 0.28);
          moveSwipe(Math.max(-180, Math.min(180, x * resistance)));
        }
      }}
      onPointerUp={(event) => {
        if (swipeStart.current?.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        finishSwipe();
      }}
      onPointerCancel={() => { moveSwipe(0); swipeStart.current = null; }}
    >
      <div className="ai-proposal-photo">
        <img src={scan.photo_url} alt={item?.name || "Scanned Item"} />
        <span>{scan.status === "processing" ? "AI processing" : scan.status === "failed" ? "Needs attention" : `${Math.round((scan.proposal?.confidence || 0) * 100)}% confidence`}</span>
      </div>
      <div className="ai-proposal-main">
        {scan.status === "processing" && <>
          <div className="ai-proposal-context single"><span><Icon name="pin" size={17} /><small>Place</small><strong>{scan.location_path}</strong></span></div>
          <div className="ai-proposal-wait"><strong>Analyzing photo…</strong><small>You can leave this page while AI works.</small></div>
        </>}
        {scan.status === "failed" && <>
          <div className="ai-proposal-context single"><span><Icon name="pin" size={17} /><small>Place</small><strong>{scan.location_path}</strong></span></div>
          <div className="ai-proposal-wait error"><strong>Scan could not be analyzed</strong><small>{scan.error || "The AI provider did not return a result."}</small><div><button className="primary" disabled={busy} onClick={() => void onRetry()}>Retry</button><button disabled={busy} onClick={() => void onReject()}>Reject</button></div></div>
        </>}
        {scan.status === "pending" && item && <>
          {!editing ? <>
            <div className="ai-item-identity"><small>Suggested Item</small><h2>{item.name}</h2></div>
            <div className="ai-proposal-context">
              <span><Icon name="pin" size={17} /><small>Place</small><strong>{scan.location_path}</strong></span>
              <span><Icon name="tag" size={17} /><small>Category</small><strong>{category?.path || "Uncategorized"}</strong></span>
            </div>
            <div className="ai-item-details">
              <small className="ai-section-label">Item details</small>
              <div className="ai-proposal-facts">
                <span><small>Quantity</small><strong>{item.quantity} {item.unit}</strong></span>
                {item.brand && <span><small>Brand</small><strong>{item.brand}</strong></span>}
                {item.model && <span><small>Model</small><strong>{item.model}</strong></span>}
                {item.barcode && <span><small>Barcode</small><strong>{item.barcode}</strong></span>}
              </div>
              {item.description && <p>{item.description}</p>}
              {item.notes && <div className="ai-item-specifications"><small>Specifications</small>{item.notes.split("\n").filter(Boolean).map((line) => <span key={line}>{line}</span>)}</div>}
              {scan.proposal?.research?.url && <a href={scan.proposal.research.url} target="_blank" rel="noreferrer">{scan.proposal.research.label}</a>}
              {scan.proposal?.warnings.map((warning) => <em key={warning}>{warning}</em>)}
            </div>
          </> : <form className="ai-proposal-form" onSubmit={save}>
            <div className="ai-edit-heading"><strong>Edit suggestion</strong><small>Nothing is saved as an Item until you approve it.</small></div>
            <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
            <div className="form-row"><label>Brand<input value={brand} onChange={(event) => setBrand(event.target.value)} /></label><label>Model<input value={model} onChange={(event) => setModel(event.target.value)} /></label></div>
            <div className="form-row"><label>Quantity<input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label>Unit<select value={unit} onChange={(event) => setUnit(event.target.value)}>{Array.from(new Set([unit, ...units, "pcs"])).map((entry) => <option value={entry} key={entry}>{entry}</option>)}</select></label></div>
            <label>Category<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Uncategorized</option>{categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.path}</option>)}</select></label>
            <label>Place<select value={locationId} onChange={(event) => setLocationId(event.target.value)}>{locations.map((entry) => <option key={entry.public_id} value={entry.public_id}>{entry.path}</option>)}</select></label>
            <label>Barcode<input inputMode="numeric" value={barcode} onChange={(event) => setBarcode(event.target.value)} /></label>
            <label>Description<textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <label>Specifications<textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Material: Steel&#10;Size: 10 mm" /></label>
            <div className="button-row"><button type="button" onClick={() => setEditing(false)}>Cancel</button><button className="secondary" disabled={busy || !name.trim()}>Save changes</button></div>
          </form>}
          {!editing && <>
            <small className="ai-swipe-help">Swipe left to reject · right to approve</small>
            <div className="ai-proposal-actions">
              <button disabled={busy} onClick={() => void onReject()}><Icon name="close" size={16} />Reject</button>
              <button className="secondary" disabled={busy} onClick={() => setEditing(true)}><Icon name="settings" size={16} />Edit</button>
              <button className="primary" disabled={busy} onClick={() => void onApprove()}><Icon name="check" size={16} />Approve</button>
            </div>
          </>}
        </>}
      </div>
    </article>
  </div>;
}

export function AIScanInboxView({ categories, locations, units, busy, onBack, onInventoryChanged, notify }: {
  categories: Category[];
  locations: LocationNode[];
  units: string[];
  busy: boolean;
  onBack: () => void;
  onInventoryChanged: () => Promise<void>;
  notify: (message: string, action?: Omit<RetryNotice, "message">) => void;
}) {
  const [scans, setScans] = useState<AIScanProposal[]>([]);
  const [reviewBusy, setReviewBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const load = useCallback(async () => {
    try {
      setScans(await api.aiScans());
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load the AI Inbox");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);
  const processing = scans.some((scan) => scan.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [load, processing]);

  async function performScan(
    action: () => Promise<unknown>,
    success: string,
    inventoryChanged = false,
  ) {
    setReviewBusy("Updating Inbox…");
    try {
      await action();
      notify(success);
      await load();
      if (inventoryChanged) await onInventoryChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The AI scan action could not be completed");
    } finally {
      setReviewBusy("");
    }
  }

  async function approveScan(scan: AIScanProposal) {
    if (scan.status !== "pending" || reviewBusy) return;
    setReviewBusy("Approving Item…");
    try {
      const created = await api.approveAiScan(scan.public_id);
      await load();
      await onInventoryChanged();
      notify(`${created.name} approved`, {
        label: "Undo",
        action: async () => {
          const current = await api.item(created.public_id);
          await api.archive(current);
          await load();
          await onInventoryChanged();
          notify(`${created.name} approval undone`);
        },
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Item could not be approved");
      await load();
      await onInventoryChanged();
    } finally {
      setReviewBusy("");
    }
  }

  const orderedScans = useMemo(() => [...scans].sort((left, right) => {
    const priority = { pending: 0, failed: 1, processing: 2 } as Record<string, number>;
    return (priority[left.status] ?? 3) - (priority[right.status] ?? 3);
  }), [scans]);
  const currentScan = orderedScans[0] || null;
  return <section className="ai-inbox-page">
    <div className="ai-inbox-nav">
      <button type="button" className="ai-inbox-back" onClick={onBack}><Icon name="chevron" size={17} />Back</button>
      {orderedScans.length > 1 && <span>{orderedScans.length} remaining</span>}
    </div>
    {loading && <div className="inline-activity" role="status"><span className="activity-spinner" />Loading Inbox…</div>}
    {!loading && scans.length === 0 && <EmptyState icon="spark" title="Your Inbox is clear" text="New AI Scan results will appear here automatically." />}
    {currentScan && <div className="ai-card-stage">
      {reviewBusy && <div className="ai-review-progress" role="status"><span className="activity-spinner" />{reviewBusy}</div>}
      <AIScanProposalCard
        key={currentScan.public_id}
        scan={currentScan}
        categories={categories}
        locations={flatLocations}
        units={units}
        busy={busy || Boolean(reviewBusy)}
        onSave={(changes) => performScan(() => api.updateAiScan(currentScan.public_id, changes), "AI scan proposal updated")}
        onApprove={() => approveScan(currentScan)}
        onReject={() => performScan(() => api.rejectAiScan(currentScan.public_id), "AI scan proposal rejected")}
        onRetry={() => performScan(() => api.retryAiScan(currentScan.public_id), "AI scan queued again")}
      />
    </div>}
  </section>;
}
