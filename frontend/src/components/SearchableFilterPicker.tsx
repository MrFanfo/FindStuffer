import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { Icon, IconName } from "./Icon";

export type SearchableFilterOption = { id: string; label: string; detail?: string };

export function SearchableFilterPicker({
  title,
  icon,
  options,
  selectedId,
  emptyLabel,
  contextLabel = "INVENTORY FILTER",
  emptyDetail = "Clear this filter",
  topLayer = false,
  onChoose,
  onClose,
}: {
  title: string;
  icon: IconName;
  options: SearchableFilterOption[];
  selectedId: string;
  emptyLabel: string;
  contextLabel?: string;
  emptyDetail?: string;
  topLayer?: boolean;
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const visibleOptions = useMemo(() => {
    const term = deferredQuery;
    if (!term) return options.slice(0, 60);
    return options.filter((option) =>
      `${option.label} ${option.detail || ""}`.toLocaleLowerCase().includes(term)
    ).slice(0, 120);
  }, [deferredQuery, options]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  function choose(id: string) {
    onChoose(id);
    onClose();
  }
  return (
    <div className={`modal-backdrop picker-backdrop searchable-filter-backdrop ${topLayer ? "top-layer" : ""}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <article className="picker-sheet searchable-filter-sheet">
        <header><button type="button" className="icon-button" onClick={onClose} aria-label="Close picker"><Icon name="close" size={17} /></button><div><p className="eyebrow">{contextLabel}</p><h2>{title}</h2></div></header>
        <label className="searchable-filter-input"><Icon name="search" size={19} /><input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${title.replace("Filter by ", "")}…`} aria-label={title} />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear picker search"><Icon name="close" size={15} /></button>}</label>
        <div className="searchable-filter-results">
          <button type="button" className={!selectedId ? "selected" : ""} onClick={() => choose("")}><span className="searchable-filter-icon"><Icon name={icon} size={17} /></span><span><strong>{emptyLabel}</strong><small>{emptyDetail}</small></span>{!selectedId && <Icon name="check" size={17} />}</button>
          {visibleOptions.map((option) => <button type="button" className={selectedId === option.id ? "selected" : ""} key={option.id} onClick={() => choose(option.id)}><span className="searchable-filter-icon"><Icon name={icon} size={17} /></span><span><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</span>{selectedId === option.id && <Icon name="check" size={17} />}</button>)}
          {visibleOptions.length === 0 && <div className="empty-inline"><span>No matching options</span></div>}
        </div>
      </article>
    </div>
  );
}
