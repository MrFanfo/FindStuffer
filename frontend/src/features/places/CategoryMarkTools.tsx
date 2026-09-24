import { useRef, useState } from "react";
import { api, type CategoryIconSet, type CategoryMarkSet } from "../../api";
import { Icon } from "../../components/Icon";

/**
 * The whole set of category marks at once: fill in what has none, keep a copy,
 * or bring one back. Suggesting never overwrites a mark that was chosen by hand.
 */
export function CategoryMarkTools({ busy, onChanged }: { busy: boolean; onChanged: () => void }) {
  const [status, setStatus] = useState("");
  const [working, setWorking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function perform(label: string, action: () => Promise<string>) {
    setWorking(true);
    setStatus(`${label}…`);
    try { setStatus(await action()); }
    catch { setStatus(`${label} failed. Reconnect and try again.`); }
    finally { setWorking(false); }
  }

  const suggest = () => perform("Suggesting marks", async () => {
    const result = await api.suggestCategoryIcons();
    onChanged();
    return `${result.updated} categor${result.updated === 1 ? "y" : "ies"} marked · ${result.unchanged} left as they were.`;
  });

  const exportSet = () => perform("Exporting marks", async () => {
    const [assignments, drawings] = await Promise.all([api.exportCategoryIcons(), api.exportCategoryMarks()]);
    const set = { ...assignments, marks: drawings.marks };
    const url = URL.createObjectURL(new Blob([JSON.stringify(set, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `findstuff-category-icons-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    return `${set.icons.length} assignments and ${Object.keys(set.marks).length} drawings saved to your downloads.`;
  });

  async function importSet(file: File) {
    await perform("Reading the set", async () => {
      const payload = JSON.parse(await file.text()) as CategoryIconSet & Partial<CategoryMarkSet>;
      const drawings = payload.marks
        ? { format: "findstuff-category-marks", version: 1, marks: payload.marks } as CategoryMarkSet
        : null;
      const [assignments, incoming] = await Promise.all([
        payload.icons ? api.importCategoryIcons(payload, false) : Promise.resolve(null),
        drawings ? api.importCategoryMarks(drawings, false) : Promise.resolve(null),
      ]);
      const parts = [
        assignments ? `${assignments.matched} category assignment${assignments.matched === 1 ? "" : "s"}` : "",
        incoming ? `${incoming.added_count} new and ${incoming.replaced_count} replaced drawing${incoming.replaced_count === 1 ? "" : "s"}` : "",
      ].filter(Boolean).join(" and ");
      const missing = assignments?.unmatched_count
        ? ` ${assignments.unmatched_count} category name${assignments.unmatched_count === 1 ? "" : "s"} in the file are not here.`
        : "";
      if (!window.confirm(`Apply ${parts || "nothing"}?${missing}`)) return `Nothing changed. The file holds ${parts}.`;
      if (drawings) await api.importCategoryMarks(drawings, true);
      if (payload.icons) await api.importCategoryIcons(payload, true);
      onChanged();
      return `Applied ${parts}.`;
    });
  }

  return (
    <div className="category-mark-tools">
      <div className="button-row">
        <button type="button" className="secondary" disabled={busy || working} onClick={() => void suggest()}>
          <Icon name="spark" size={15} />Suggest marks
        </button>
        <button type="button" disabled={busy || working} onClick={() => void exportSet()}>
          <Icon name="more" size={15} />Export set
        </button>
        <button type="button" disabled={busy || working} onClick={() => fileInput.current?.click()}>
          <Icon name="plus" size={15} />Import set
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="Choose a mark set file to import"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importSet(file);
          }}
        />
      </div>
      {status && <p role="status" className="muted">{status}</p>}
    </div>
  );
}
