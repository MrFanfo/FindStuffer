import type { InventoryDisplaySettings, Item } from "../../api";
import { Icon } from "../../components/Icon";
import { categoryLabel, expirationState } from "../../domain/inventory";
import { expirationCopy, heldQuantity, isLowStock, placeParts, restockQuantity } from "./itemStatus";

export type InventoryDensity = "compact" | "comfortable" | "grid";

export type ItemRowActions = {
  onOpen: () => void;
  onAdjust: (delta: number) => void;
  onEditQuantity: () => void;
  onFilterPlace: () => void;
  onFilterCategory: () => void;
  onFilterLow: () => void;
  onFilterExpiring: () => void;
  onMove: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onAddShopping: () => void;
  onToggleExpand: () => void;
};

/**
 * One item, one row. The row opens the item; the chips beside it narrow the list
 * to that place or category, and the actions people reach for less often wait in
 * the strip behind the chevron so that every row stays a single line of height.
 */
export function InventoryItemRow({
  item, display, density, busy, syncing, bulkMode, selected, expanded, actions,
}: {
  item: Item;
  display: InventoryDisplaySettings;
  density: InventoryDensity;
  busy: boolean;
  syncing: boolean;
  bulkMode: boolean;
  selected: boolean;
  expanded: boolean;
  actions: ItemRowActions;
}) {
  const low = isLowStock(item);
  const expiry = expirationState(item);
  const place = placeParts(item);
  const held = heldQuantity(item);
  const contents = item.contents_count || 0;
  const category = categoryLabel(item);
  const showPhoto = display.show_photo && density !== "compact";
  const quantity = display.show_quantity && !bulkMode;
  return (
    <article
      className={[
        "inv-row", `inv-${density}`,
        low || expiry === "expired" ? "needs-attention" : "",
        syncing ? "syncing" : "", bulkMode ? "selectable" : "", selected ? "selected" : "", expanded ? "expanded" : "",
      ].filter(Boolean).join(" ")}
    >
      {/* Covers the row behind its chips, so the whole row opens the item while the
          chips and the stepper stay separately operable. */}
      <button
        type="button"
        className="inv-row-open"
        aria-label={bulkMode ? `Select ${item.name}` : `Open ${item.name}`}
        aria-pressed={bulkMode ? selected : undefined}
        onClick={actions.onOpen}
      />
      {bulkMode && <span className="inv-check" aria-hidden="true">{selected ? <Icon name="check" size={16} /> : null}</span>}
      {showPhoto && (
        <div className={`inv-thumb ${item.primary_photo_url ? "has-photo" : ""}`} aria-hidden="true">
          {item.primary_photo_url ? <img src={item.primary_photo_url} alt="" loading="lazy" /> : <Icon name="box" size={density === "grid" ? 26 : 20} />}
        </div>
      )}
      <div className="inv-copy">
        <h3 className="inv-name">
          <span>{item.name}</span>
          {low && <button type="button" className="inv-badge warning" onClick={actions.onFilterLow}>Low</button>}
          {expiry && <button type="button" className={`inv-badge ${expiry}`} onClick={actions.onFilterExpiring}>{expiry === "expired" ? "Expired" : expirationCopy(item)}</button>}
        </h3>
        <p className="inv-meta">
          {display.show_location && (
            <button type="button" className="inv-chip" onClick={actions.onFilterPlace} title={item.containment_path || item.location_path}>
              <Icon name="pin" size={12} /><b>{place.leaf}</b>{place.rest && <span> · {place.rest}</span>}
            </button>
          )}
          {display.show_category && category && (
            <button type="button" className="inv-chip quiet" onClick={actions.onFilterCategory}>{category}</button>
          )}
          {((display.show_brand && item.brand) || (display.show_model && item.model)) && (
            <span className="inv-chip quiet plain">{[display.show_brand ? item.brand : "", display.show_model ? item.model : ""].filter(Boolean).join(" · ")}</span>
          )}
          {held > 0 && <span className="inv-marker" title={`${held} ${item.unit} held for ${(item.project_holds || []).map((hold) => hold.name).join(", ")}`}><Icon name="lock" size={12} />{held}</span>}
          {contents > 0 && <span className="inv-marker" title={`${contents} items stored inside`}><Icon name="box" size={12} />{contents}</span>}
        </p>
      </div>
      {quantity && (
        <div className="inv-stepper">
          {density !== "grid" && (
            <button type="button" aria-label={`Remove one ${item.name}`} disabled={Number(item.quantity) <= 0} onClick={() => actions.onAdjust(-1)}><Icon name="minus" size={15} /></button>
          )}
          <button type="button" className="inv-quantity" aria-label={`Set quantity for ${item.name}, currently ${item.quantity} ${item.unit}`} onClick={actions.onEditQuantity}>
            <strong>{item.quantity}</strong><small>{item.unit}</small>
          </button>
          {density !== "grid" && (
            <button type="button" aria-label={`Add one ${item.name}`} onClick={() => actions.onAdjust(1)}><Icon name="plus" size={15} /></button>
          )}
        </div>
      )}
      {!bulkMode && density !== "grid" && (
        <button type="button" className="inv-expand" aria-expanded={expanded} aria-label={`More actions for ${item.name}`} onClick={actions.onToggleExpand}>
          <Icon name="chevron" size={16} />
        </button>
      )}
      {expanded && !bulkMode && (
        <div className="inv-strip">
          <button type="button" disabled={busy} onClick={actions.onMove}><Icon name="pin" size={15} />Move</button>
          {low && <button type="button" className="shopping-action" onClick={actions.onAddShopping}><Icon name="plus" size={15} />List {restockQuantity(item)} {item.unit}</button>}
          <button type="button" disabled={busy} onClick={actions.onArchive}>Archive</button>
          <button type="button" className="danger" disabled={busy} onClick={actions.onDelete}>Delete</button>
        </div>
      )}
    </article>
  );
}
