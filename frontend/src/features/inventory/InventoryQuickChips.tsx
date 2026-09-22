import type { LocationNode } from "../../api";
import { Icon } from "../../components/Icon";
import type { SavedInventoryView } from "./formula";

/**
 * The entry points worth one tap: the views someone saved and the places they
 * pinned. Both already existed — saved views behind the filter panel, pinned
 * places only on Home — and both answer "show me my usual list" immediately.
 */
export function InventoryQuickChips({
  views, places, activePlace, activeViewName, onApplyView, onChoosePlace, onPinPlace, canPinActivePlace,
}: {
  views: SavedInventoryView[];
  places: LocationNode[];
  activePlace: string;
  activeViewName: string;
  onApplyView: (view: SavedInventoryView) => void;
  onChoosePlace: (publicId: string) => void;
  onPinPlace: () => void;
  canPinActivePlace: boolean;
}) {
  if (views.length === 0 && places.length === 0 && !canPinActivePlace) return null;
  return (
    <div className="inventory-quick-chips" role="group" aria-label="Saved views and pinned places">
      {views.map((view) => (
        <button type="button" key={view.id} className={`quick-chip view ${activeViewName === view.name ? "active" : ""}`} onClick={() => onApplyView(view)}>
          <Icon name="filter" size={13} />{view.name}
        </button>
      ))}
      {places.map((place) => (
        <button type="button" key={place.public_id} className={`quick-chip ${activePlace === place.public_id ? "active" : ""}`} onClick={() => onChoosePlace(activePlace === place.public_id ? "" : place.public_id)}>
          <Icon name="pin" size={13} />{place.name}
        </button>
      ))}
      {canPinActivePlace && (
        <button type="button" className="quick-chip pin-current" onClick={onPinPlace}><Icon name="plus" size={13} />Pin this place</button>
      )}
    </div>
  );
}
