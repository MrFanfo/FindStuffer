import { useEffect, useRef } from "react";
import type { InventoryDisplaySettings } from "../../api";
import { Icon } from "../../components/Icon";
import type { InventoryDensity } from "./InventoryItemRow";

const DENSITIES: Array<[InventoryDensity, string, string]> = [
  ["compact", "Compact", "Most rows · name and place"],
  ["comfortable", "Comfortable", "Adds category and details"],
  ["grid", "Photo grid", "Recognise by sight"],
];

const FIELDS: Array<[keyof InventoryDisplaySettings, string]> = [
  ["show_photo", "Photo"], ["show_location", "Place"], ["show_category", "Category"],
  ["show_quantity", "Quantity"], ["show_brand", "Brand"], ["show_model", "Model"],
];

/** The list's own appearance controls, beside the list they change. */
export function InventoryDisplayMenu({ density, display, onDensity, onField, onClose }: {
  density: InventoryDensity;
  display: InventoryDisplaySettings;
  onDensity: (value: InventoryDensity) => void;
  onField: (key: keyof InventoryDisplaySettings, value: boolean) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (event: MouseEvent) => { if (!panel.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("mousedown", away); window.removeEventListener("keydown", escape); };
  }, [onClose]);
  return (
    <div className="inventory-display-menu" ref={panel}>
      <div role="radiogroup" aria-label="List density">
        {DENSITIES.map(([value, label, detail]) => (
          <button type="button" role="radio" aria-checked={density === value} key={value} className={density === value ? "active" : ""} onClick={() => onDensity(value)}>
            <strong>{label}</strong><small>{detail}</small>
          </button>
        ))}
      </div>
      <p className="menu-heading">Show on each row</p>
      <div className="display-fields">
        {FIELDS.map(([key, label]) => (
          <label key={key}><input type="checkbox" checked={display[key]} onChange={(event) => onField(key, event.target.checked)} />{label}</label>
        ))}
      </div>
      <small className="menu-note">Density is for this device. The row fields are shared with your other devices.</small>
      <button type="button" className="menu-close" onClick={onClose}><Icon name="check" size={15} />Done</button>
    </div>
  );
}
