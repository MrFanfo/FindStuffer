import type { InventoryDisplaySettings, Item } from "../../api";
import { Icon } from "../../components/Icon";
import { CategoryMark } from "../../components/CategoryMark";
import { categoryLabel, expirationState } from "../../domain/inventory";
import { expirationCopy, isLowStock, placeParts, restockQuantity } from "./itemStatus";

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
  onToggleCommands: () => void;
};

/**
 * One item, one row: photo, name, place, amount. Three targets, each with its own
 * answer — the photo opens this item's commands, the amount opens the counted
 * amount, and the rest of the row opens the item itself.
 */
export function InventoryItemRow({
  item, display, density, busy, syncing, bulkMode, selected, commandsOpen, categoryMark, actions,
}: {
  item: Item;
  categoryMark: string;
  display: InventoryDisplaySettings;
  density: InventoryDensity;
  busy: boolean;
  syncing: boolean;
  bulkMode: boolean;
  selected: boolean;
  commandsOpen: boolean;
  actions: ItemRowActions;
}) {
  const low = isLowStock(item);
  const expiry = expirationState(item);
  const place = placeParts(item);
  const category = categoryLabel(item);
  const quantity = display.show_quantity && !bulkMode;
  return (
    <article
      className={[
        "inv-row", `inv-${density}`,
        low || expiry === "expired" ? "needs-attention" : "",
        syncing ? "syncing" : "", bulkMode ? "selectable" : "", selected ? "selected" : "", commandsOpen ? "commands-open" : "",
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
      {display.show_photo && (bulkMode || density === "grid" ? (
        <div className={`inv-thumb ${item.primary_photo_url ? "has-photo" : ""}`} aria-hidden="true">
          {item.primary_photo_url ? <img src={item.primary_photo_url} alt="" loading="lazy" /> : <Icon name="box" size={density === "grid" ? 26 : 20} />}
        </div>
      ) : (
        <button
          type="button"
          className={`inv-thumb tappable ${item.primary_photo_url ? "has-photo" : ""}`}
          aria-expanded={commandsOpen}
          aria-label={`Commands for ${item.name}`}
          onClick={actions.onToggleCommands}
        >
          {item.primary_photo_url ? <img src={item.primary_photo_url} alt="" loading="lazy" /> : <Icon name="box" size={20} />}
        </button>
      ))}
      <div className="inv-copy">
        <h3 className="inv-name">
          <span>{item.name}</span>
          {low && <button type="button" className="inv-badge warning" onClick={actions.onFilterLow}>Low</button>}
          {expiry && <button type="button" className={`inv-badge ${expiry}`} onClick={actions.onFilterExpiring}>{expiry === "expired" ? "Expired" : expirationCopy(item)}</button>}
        </h3>
        <p className="inv-meta">
          {display.show_category && category && (
            <button type="button" className="inv-cat" aria-label={`Filter by ${category}`} title={category} onClick={actions.onFilterCategory}>
              <CategoryMark name={categoryMark} size={20} />
            </button>
          )}
          {display.show_location && (
            <button type="button" className="inv-chip" onClick={actions.onFilterPlace} title={item.containment_path || item.location_path}>
              <b>{place.head}</b>{place.tail && <span> · {place.tail}</span>}
            </button>
          )}
          {display.show_category && category && (
            <button type="button" className="inv-chip quiet" onClick={actions.onFilterCategory}>{category}</button>
          )}
          {((display.show_brand && item.brand) || (display.show_model && item.model)) && (
            <span className="inv-chip quiet plain">{[display.show_brand ? item.brand : "", display.show_model ? item.model : ""].filter(Boolean).join(" · ")}</span>
          )}
        </p>
      </div>
      {quantity && (
        <button type="button" className="inv-quantity" aria-label={`Set quantity for ${item.name}, currently ${item.quantity} ${item.unit}`} onClick={actions.onEditQuantity}>
          <strong>{item.quantity}</strong><small>{item.unit}</small>
        </button>
      )}
      {commandsOpen && !bulkMode && (
        <div className="inv-strip">
          <button type="button" className="strip-step" aria-label={`Remove one ${item.name}`} disabled={busy || Number(item.quantity) <= 0} onClick={() => actions.onAdjust(-1)}><Icon name="minus" size={15} />1</button>
          <button type="button" className="strip-step" aria-label={`Add one ${item.name}`} disabled={busy} onClick={() => actions.onAdjust(1)}><Icon name="plus" size={15} />1</button>
          <button type="button" disabled={busy} onClick={actions.onEditQuantity}>Set amount</button>
          <button type="button" disabled={busy} onClick={actions.onMove}><Icon name="pin" size={15} />Move</button>
          {low && <button type="button" className="shopping-action" onClick={actions.onAddShopping}><Icon name="plus" size={15} />List {restockQuantity(item)} {item.unit}</button>}
          <button type="button" disabled={busy} onClick={actions.onArchive}>Archive</button>
          <button type="button" className="danger" disabled={busy} onClick={actions.onDelete}>Delete</button>
        </div>
      )}
    </article>
  );
}
