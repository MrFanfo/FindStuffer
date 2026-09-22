import { type FormEvent, useState } from "react";
import type { Item } from "../../api";
import { Icon } from "../../components/Icon";
import { quantityDelta } from "./itemStatus";

/**
 * Setting a counted amount directly. The stepper covers "one more, one less";
 * this covers "there are actually 237 left", which is what a count produces.
 */
export function QuantityEditor({ item, onApply, onClose }: {
  item: Item;
  onApply: (delta: number) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(item.quantity);
  const target = value.trim().replace(",", ".");
  const valid = target !== "" && Number.isFinite(Number(target)) && Number(target) >= 0;
  const delta = valid ? quantityDelta(item.quantity, target) : 0;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || delta === 0) { onClose(); return; }
    onApply(delta);
    onClose();
  }
  return (
    <div className="modal-backdrop picker-backdrop quantity-backdrop" role="dialog" aria-modal="true" aria-label={`Quantity for ${item.name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="picker-sheet quantity-sheet" onSubmit={submit}>
        <header>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" size={17} /></button>
          <div><p className="eyebrow">SET QUANTITY</p><h2>{item.name}</h2><small>Now {item.quantity} {item.unit}</small></div>
        </header>
        <label className="quantity-field">
          <span>Counted amount</span>
          <input autoFocus type="text" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} aria-label={`Quantity in ${item.unit}`} />
          <b>{item.unit}</b>
        </label>
        <div className="quantity-presets">
          <button type="button" onClick={() => setValue("0")}>Use all up</button>
          <button type="button" onClick={() => setValue(String(Number(item.quantity) + 1))}>+1</button>
          <button type="button" onClick={() => setValue(String(Math.max(0, Number(item.quantity) - 1)))}>−1</button>
          <button type="button" onClick={() => setValue(item.quantity)}>Reset</button>
        </div>
        <p className="quantity-outcome" role="status">
          {!valid ? "Enter a number of 0 or more." : delta === 0 ? "No change yet." : `${delta > 0 ? "Adds" : "Removes"} ${Math.abs(delta)} ${item.unit} · saved as one change you can undo.`}
        </p>
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!valid || delta === 0}>Save quantity</button>
        </footer>
      </form>
    </div>
  );
}
