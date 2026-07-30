import { CSSProperties, useEffect } from "react";

import { Icon } from "../../components/Icon";
import { type PrintDensity, type PrintDesign, type PrintLayout, type PrintQueueItem, type PrintQueueSettings, type PrintTextMode } from "./printModel";

function printDensityMetrics(settings: PrintQueueSettings): { gap: number; margin: number; labelPadding: number } {
  if (settings.density === "compact") return { gap: 1.5, margin: 6, labelPadding: 0.5 };
  if (settings.density === "spacious") return { gap: 6, margin: 14, labelPadding: 1.4 };
  return { gap: 3, margin: 10, labelPadding: 0.8 };
}

function printLabelText(entry: PrintQueueItem, settings: PrintQueueSettings): string {
  if (settings.textMode === "name") return entry.name;
  const levels = entry.path.split(" > ").map((part) => part.trim()).filter(Boolean);
  if (settings.textMode === "last-levels") return levels.slice(-settings.pathLevels).join(" › ") || entry.name;
  return levels.join(" › ") || entry.name;
}

export function printColumnCount(settings: PrintQueueSettings): number {
  const { gap, margin } = printDensityMetrics(settings);
  const printableWidth = 210 - (margin * 2);
  const labelWidth = settings.qrSize + (settings.design === "clean" ? 4 : 5.5);
  const fittingColumns = Math.max(1, Math.min(5, Math.floor((printableWidth + gap) / (labelWidth + gap))));
  if (settings.layout === "two") return Math.min(2, fittingColumns);
  if (settings.layout === "three") return Math.min(3, fittingColumns);
  if (settings.layout === "four") return Math.min(4, fittingColumns);
  return fittingColumns;
}

function printLabelLineCount(entry: PrintQueueItem, settings: PrintQueueSettings): number {
  const text = printLabelText(entry, settings);
  const labelWidth = settings.qrSize + (settings.design === "clean" ? 4 : 5.5);
  const fontSize = Math.min(4.2, Math.max(2.5, settings.qrSize / 11.5));
  const usableWidth = Math.max(12, labelWidth - 4);
  // A conservative print-font estimate keeps complete paths on the page even
  // when a level is one long word and must wrap between characters.
  const charactersPerLine = Math.max(6, Math.floor(usableWidth / (fontSize * 0.62)));
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  let lines = 1;
  let usedCharacters = 0;
  for (const token of tokens) {
    const tokenLength = Array.from(token).length;
    if (tokenLength > charactersPerLine) {
      if (usedCharacters) {
        lines += 1;
        usedCharacters = 0;
      }
      lines += Math.floor((tokenLength - 1) / charactersPerLine);
      usedCharacters = tokenLength % charactersPerLine || charactersPerLine;
      continue;
    }
    const requiredCharacters = tokenLength + (usedCharacters ? 1 : 0);
    if (usedCharacters + requiredCharacters > charactersPerLine) {
      lines += 1;
      usedCharacters = tokenLength;
    } else {
      usedCharacters += requiredCharacters;
    }
  }
  return lines;
}

function printLabelHeight(entry: PrintQueueItem, settings: PrintQueueSettings): number {
  const { labelPadding } = printDensityMetrics(settings);
  const fontSize = Math.min(4.2, Math.max(2.5, settings.qrSize / 11.5));
  const textHeight = printLabelLineCount(entry, settings) * fontSize * 1.14;
  const kindHeight = settings.showKind ? 4 : 0;
  const frameAndBorders = settings.design === "clean" ? 3 : 5;
  return settings.qrSize + textHeight + kindHeight + frameAndBorders + (labelPadding * 2);
}

export function paginatePrintQueue(queue: PrintQueueItem[], settings: PrintQueueSettings): PrintQueueItem[][] {
  const columns = printColumnCount(settings);
  const { gap, margin } = printDensityMetrics(settings);
  const printableHeight = 297 - (margin * 2) - 4;
  const pages: PrintQueueItem[][] = [];
  let page: PrintQueueItem[] = [];
  let usedHeight = 0;
  for (let index = 0; index < queue.length; index += columns) {
    const row = queue.slice(index, index + columns);
    const rowHeight = Math.max(...row.map((entry) => printLabelHeight(entry, settings)));
    const nextHeight = usedHeight + (page.length ? gap : 0) + rowHeight;
    if (page.length && nextHeight > printableHeight) {
      pages.push(page);
      page = [];
      usedHeight = 0;
    }
    page.push(...row);
    usedHeight += (usedHeight ? gap : 0) + rowHeight;
  }
  if (page.length) pages.push(page);
  return pages;
}

function LocationQrLabel({ entry, settings }: { entry: PrintQueueItem; settings: PrintQueueSettings }) {
  const { labelPadding } = printDensityMetrics(settings);
  const labelText = printLabelText(entry, settings);
  const style = {
    "--label-color": settings.color,
    "--qr-size": `${settings.qrSize}mm`,
    "--label-padding": `${labelPadding}mm`,
  } as CSSProperties;
  return <article className={`location-qr-label design-${settings.design}`} style={style}>
    <header><h3 title={labelText}>{labelText}</h3></header>
    <div className="qr-jewel-frame">
      <span className="qr-corner qr-corner-one" aria-hidden="true" />
      <span className="qr-corner qr-corner-two" aria-hidden="true" />
      <span className="qr-corner qr-corner-three" aria-hidden="true" />
      <span className="qr-corner qr-corner-four" aria-hidden="true" />
      <img src={`/api/v1/qr/locations/${entry.publicId}.svg?color=${encodeURIComponent(settings.color)}`} alt={`QR code for ${entry.name}`} />
    </div>
    {settings.showKind && <p className="qr-label-kind">{entry.kind}</p>}
  </article>;
}

export function PrintQueueDialog({ queue, settings, onChangeQueue, onChangeSettings, onClose, onNotice }: {
  queue: PrintQueueItem[];
  settings: PrintQueueSettings;
  onChangeQueue: (queue: PrintQueueItem[]) => void;
  onChangeSettings: (settings: PrintQueueSettings) => void;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const selected = queue.filter((entry) => entry.selected);
  const pages = paginatePrintQueue(selected, settings);
  const columns = printColumnCount(settings);
  const densityMetrics = printDensityMetrics(settings);
  const maximumLabelsOnPage = Math.max(0, ...pages.map((page) => page.length));
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);
  function toggle(publicId: string) {
    onChangeQueue(queue.map((entry) => entry.publicId === publicId ? { ...entry, selected: !entry.selected } : entry));
  }
  function toggleAll() {
    const shouldSelect = selected.length !== queue.length;
    onChangeQueue(queue.map((entry) => ({ ...entry, selected: shouldSelect })));
  }
  function clearQueue() {
    if (queue.length > 0 && window.confirm("Clear every location from the print queue?")) onChangeQueue([]);
  }
  async function printSelected() {
    if (!selected.length) {
      onNotice("Select at least one QR code to print");
      return;
    }
    const images = [...document.querySelectorAll<HTMLImageElement>(".print-page .location-qr-label img")];
    await Promise.all(images.map((image) => image.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      })));
    window.requestAnimationFrame(() => window.print());
  }
  return <div className="print-queue-backdrop" role="dialog" aria-modal="true" aria-label="Location QR print queue" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="print-queue-sheet">
      <header className="print-queue-header"><div><p className="eyebrow">A4 LABEL STUDIO</p><h2>Print queue</h2><p>{selected.length} of {queue.length} QR label{queue.length === 1 ? "" : "s"} selected</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close print queue"><Icon name="close" /></button></header>
      <div className="print-queue-workspace">
        <aside className="print-queue-controls">
          <div className="print-queue-control-heading"><strong>Queued locations</strong><button type="button" className="text-button" disabled={!queue.length} onClick={toggleAll}>{selected.length === queue.length && queue.length ? "Select none" : "Select all"}</button></div>
          <div className="print-queue-list">
            {!queue.length && <div className="print-queue-empty"><Icon name="qr" size={26} /><strong>Your queue is empty</strong><small>Use “Print QR” on any Place to add a label.</small></div>}
            {queue.map((entry) => <label className={entry.selected ? "selected" : ""} key={entry.publicId}><input type="checkbox" checked={entry.selected} onChange={() => toggle(entry.publicId)} /><span><strong>{entry.name}</strong><small>{entry.path}</small></span><button type="button" onClick={(event) => { event.preventDefault(); onChangeQueue(queue.filter((item) => item.publicId !== entry.publicId)); }} aria-label={`Remove ${entry.name}`}><Icon name="close" size={14} /></button></label>)}
          </div>
          <div className="print-designer">
            <strong>Label design</strong>
            <div className="print-style-control"><span>Style</span><div className="print-style-grid" role="radiogroup" aria-label="Label style">{([
              ["ornate", "Ornate"],
              ["clean", "Clean"],
              ["bold", "Bold"],
              ["soft", "Soft"],
              ["technical", "Technical"],
              ["ticket", "Ticket"],
            ] as Array<[PrintDesign, string]>).map(([design, label]) => <button type="button" role="radio" aria-checked={settings.design === design} className={settings.design === design ? "active" : ""} key={design} onClick={() => onChangeSettings({ ...settings, design })}><i className={`style-sample sample-${design}`} aria-hidden="true" /><small>{label}</small></button>)}</div></div>
            <label>QR color<div className="print-color-control"><input type="color" value={settings.color} onChange={(event) => onChangeSettings({ ...settings, color: event.target.value.toUpperCase() })} /><output>{settings.color}</output></div></label>
            <div className="color-swatches" aria-label="QR color presets">{["#4923A8", "#006B5E", "#B52A60", "#1B3A6F", "#111827"].map((color) => <button type="button" key={color} className={settings.color === color ? "active" : ""} style={{ background: color }} onClick={() => onChangeSettings({ ...settings, color })} aria-label={`Use color ${color}`} />)}</div>
            <label>QR size <output>{settings.qrSize} mm</output><input type="range" min="20" max="64" step="2" value={settings.qrSize} onChange={(event) => onChangeSettings({ ...settings, qrSize: Number(event.target.value) })} /></label>
            <label>Printed location text<select value={settings.textMode} onChange={(event) => onChangeSettings({ ...settings, textMode: event.target.value as PrintTextMode })}><option value="name">Location name only</option><option value="full-path">Full location path</option><option value="last-levels">Last levels of path</option></select></label>
            {settings.textMode === "last-levels" && <label>Path levels <output>{settings.pathLevels}</output><input type="range" min="1" max="8" step="1" value={settings.pathLevels} onChange={(event) => onChangeSettings({ ...settings, pathLevels: Number(event.target.value) })} /></label>}
            <label className="print-check-control"><input type="checkbox" checked={settings.showKind} onChange={(event) => onChangeSettings({ ...settings, showKind: event.target.checked })} /><span>Print location type</span></label>
            <label>Stacking density<select value={settings.density} onChange={(event) => onChangeSettings({ ...settings, density: event.target.value as PrintDensity })}><option value="compact">Compact · minimal gaps</option><option value="balanced">Balanced · standard gaps</option><option value="spacious">Spacious · easy cutting</option></select></label>
            <label>Page layout<select value={settings.layout} onChange={(event) => onChangeSettings({ ...settings, layout: event.target.value as PrintLayout })}><option value="auto">Auto · fit by size</option><option value="two">Up to 2 columns</option><option value="three">Up to 3 columns</option><option value="four">Up to 4 columns</option></select></label>
            <small>{columns} column{columns === 1 ? "" : "s"} · up to {maximumLabelsOnPage || columns} labels per A4 with these paths · {pages.length || 1} page{pages.length === 1 ? "" : "s"}</small>
            <small>Long paths wrap onto as many lines as needed. Pagination adapts automatically so no location level is cut off.</small>
            <small>The QR always stores the stable location link; these options control the text printed around it.</small>
          </div>
          <div className="print-queue-actions"><button type="button" className="text-button danger-text" disabled={!queue.length} onClick={clearQueue}>Clear queue</button><button type="button" className="primary button-with-icon" disabled={!selected.length} onClick={() => void printSelected()}><Icon name="qr" size={17} />Print selected</button></div>
        </aside>
        <div className="print-preview-wrap">
          <div className="print-preview-toolbar"><span>A4 preview</span><small>{pages.length || 1} page{pages.length === 1 ? "" : "s"}</small></div>
          <div className="print-preview">
            {!pages.length && <div className="print-preview-placeholder"><Icon name="check" size={30} /><strong>Select labels to preview</strong></div>}
            {pages.map((page, pageIndex) => <section className="print-page" style={{ "--print-columns": columns, "--print-gap": `${densityMetrics.gap}mm`, "--print-margin": `${densityMetrics.margin}mm` } as CSSProperties} key={`page-${pageIndex}`} aria-label={`A4 page ${pageIndex + 1}`}><div className="print-page-content">{Array.from({ length: Math.ceil(page.length / columns) }, (_, rowIndex) => <div className="print-label-row" key={`row-${rowIndex}`}>{page.slice(rowIndex * columns, (rowIndex + 1) * columns).map((entry) => <LocationQrLabel key={entry.publicId} entry={entry} settings={settings} />)}</div>)}</div><span className="print-page-number">PAGE {pageIndex + 1} / {pages.length}</span></section>)}
          </div>
        </div>
      </div>
    </section>
  </div>;
}

export { loadPrintQueue, loadPrintSettings, savePrintQueue, savePrintSettings } from "./printModel";
export type { PrintQueueItem, PrintQueueSettings } from "./printModel";
