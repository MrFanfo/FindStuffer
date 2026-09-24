import { useEffect, useState } from "react";
import { mediaUrl } from "../api";

/**
 * A category's mark, drawn by a file the server holds rather than by the app.
 *
 * The drawing is painted as a mask filled with the current text colour, so a set
 * imported by someone else follows the theme and never becomes part of the page:
 * a mask cannot carry script, links or remote references into the document.
 */
export function markUrl(name: string): string {
  return mediaUrl(`/api/v1/category-marks/${encodeURIComponent(name)}.svg`);
}

export function CategoryMark({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span
      className="category-mark-glyph"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        maskImage: `url(${markUrl(name)})`,
        WebkitMaskImage: `url(${markUrl(name)})`,
      }}
    />
  );
}

let known: string[] | null = null;
let arriving: Promise<string[]> | null = null;

/** The marks this installation holds, asked for once and remembered. */
export function useCategoryMarkNames(): string[] {
  const [names, setNames] = useState<string[]>(known || []);
  useEffect(() => {
    if (known) return;
    let live = true;
    arriving ||= fetch("/api/v1/category-marks", { credentials: "include" })
      .then((response) => response.json() as Promise<{ marks: string[] }>)
      .then((body) => { known = body.marks || []; return known; })
      .catch(() => []);
    void arriving.then((marks) => { if (live) setNames(marks); });
    return () => { live = false; };
  }, []);
  return names;
}
