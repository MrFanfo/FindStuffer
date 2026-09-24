import { useMemo, useState } from "react";
import { Icon } from "../../components/Icon";
import { CategoryMark, useCategoryMarkNames } from "../../components/CategoryMark";

/**
 * Choosing a category's mark by eye. The marks are searched by name, and the one
 * in use is shown first so that changing a mind is as quick as making the choice.
 */
export function CategoryIconPicker({ categoryPath, selected, onChoose, onClose, subject = "category" }: {
  /** What the icon is for, as the picker's heading says it. */
  subject?: "category" | "place";
  categoryPath: string;
  selected: string;
  onChoose: (icon: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const available = useCategoryMarkNames();
  const marks = useMemo(() => {
    const term = query.trim().toLowerCase();
    const names = available.filter((name) => !term || name.includes(term));
    return names.sort((left, right) => (
      Number(right === selected) - Number(left === selected) || left.localeCompare(right)
    ));
  }, [available, query, selected]);
  return (
    <div className="modal-backdrop picker-backdrop" role="dialog" aria-modal="true" aria-label={`Icon for ${categoryPath}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="picker-sheet icon-picker-sheet">
        <header>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" size={17} /></button>
          <div><p className="eyebrow">{subject === "place" ? "PLACE ICON" : "CATEGORY ICON"}</p><h2>{categoryPath}</h2><small>{available.length} icons to choose from</small></div>
        </header>
        <label className="icon-picker-search">
          <span className="sr-only">Search icons</span>
          <Icon name="search" size={16} />
          <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="resistor, leather, drill…" />
        </label>
        <div className="icon-picker-grid" role="listbox" aria-label="Icons">
          {marks.map((name) => (
            <button
              type="button"
              key={name}
              role="option"
              aria-selected={name === selected}
              className={name === selected ? "chosen" : ""}
              onClick={() => { onChoose(name); onClose(); }}
            >
              <CategoryMark name={name} size={22} />
              <small>{name}</small>
            </button>
          ))}
          {marks.length === 0 && <p className="muted">No icon by that name.</p>}
        </div>
        <footer>
          <button type="button" onClick={() => { onChoose(""); onClose(); }}>Use the suggested icon</button>
        </footer>
      </div>
    </div>
  );
}
