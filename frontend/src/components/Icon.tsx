import { ReactNode } from "react";

export type IconName =
  | "home" | "search" | "plus" | "scan" | "more" | "pin" | "box"
  | "camera" | "mic" | "spark" | "chevron" | "close" | "user"
  | "settings" | "qr" | "minus" | "check" | "filter" | "tag"
  // Category marks: one quiet line drawing per kind of thing.
  | "wrench" | "bolt" | "chip" | "spool" | "book" | "layers" | "cutlery" | "bottle"
  | "sheet" | "leaf" | "shirt" | "pill" | "spray" | "brush" | "plug" | "ball" | "car" | "key";

const ICON_PATHS: Record<IconName, ReactNode> = {
    home: <><path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.5V21h13V9.5M9 21v-7h6v7"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    scan: <><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M7 12h10"/></>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    box: <><path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/></>,
    camera: <><path d="M4 7h3l2-3h6l2 3h3v13H4V7Z"/><circle cx="12" cy="13" r="4"/></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></>,
    spark: <><path d="m12 2 1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2Z"/><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.8-1.8.9-2-2.1-2.1-2 .9-1.8-.8L10.5 2h-3l-.7 2-1.8.8-2-.9L.9 6l.9 2-.8 1.8-2 .7v3l2 .7.8 1.8-.9 2L3 20.1l2-.9 1.8.8.7 2h3l.7-2 1.8-.8 2 .9 2.1-2.1-.9-2 .8-1.8 2-.7Z" transform="translate(2) scale(.83)"/></>,
    qr: <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM15 14h2v2h-2zM18 14h2v6h-2zM14 18h3v2h-3z"/></>,
    minus: <path d="M5 12h14"/>,
    check: <path d="m4 12 5 5L20 6"/>,
    filter: <path d="M4 5h16l-6 7v5l-4 2v-7L4 5Z"/>,
    tag: <><path d="M4 5v6.5L12.5 20 20 12.5 11.5 4H5.5A1.5 1.5 0 0 0 4 5.5Z"/><circle cx="8.5" cy="8.5" r="1"/></>,
    wrench: <path d="M15.5 3.5a5 5 0 0 0-5.9 6.4L3.5 16a2 2 0 1 0 2.8 2.8l6.1-6.1a5 5 0 0 0 6.4-5.9l-3 3-2.8-2.8 2.5-3.5Z"/>,
    bolt: <><path d="m12 3.5 6.5 3.75v7.5L12 20.5 5.5 14.75v-7.5L12 3.5Z"/><circle cx="12" cy="12" r="2.8"/></>,
    chip: <><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M11 4v3M15 4v3M11 17v3M15 17v3M4 11h3M4 15h3M17 11h3M17 15h3"/></>,
    spool: <><path d="M6.5 4.5h11M6.5 19.5h11"/><rect x="9" y="7.5" width="6" height="9" rx="1.2"/><path d="M9 11h6M9 14h6"/></>,
    book: <><path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z"/><path d="M5 17h12"/></>,
    layers: <><path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z"/><path d="m4 12 8 4.5 8-4.5M4 16.5 12 21l8-4.5"/></>,
    cutlery: <><path d="M7 3v8a2 2 0 0 0 2 2v8M7 3v5M11 3v5"/><path d="M17 3c-1.5 1.5-2 3-2 5s.7 3 2 3v10"/></>,
    bottle: <><path d="M10 3h4v3.5l2 3V21H8V9.5l2-3V3Z"/><path d="M8 13h8"/></>,
    sheet: <><path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></>,
    leaf: <><path d="M20 4C9 4 4 9 4 15a5 5 0 0 0 5 5c6 0 11-5 11-16Z"/><path d="M4 20 14 10"/></>,
    shirt: <><path d="M9 3 4 6l2 4 2-1v12h8V9l2 1 2-4-5-3-3 2-3-2Z"/></>,
    pill: <><rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-45 12 12)"/><path d="m9 9 6 6"/></>,
    spray: <><path d="M9 8h6v13H9zM9 8V5h4M15 5h2M17 3v4"/><path d="M9 12h6"/></>,
    brush: <><path d="M14 4h4v7h-4zM16 11v3"/><path d="M13 14h6l-2 7h-2l-2-7Z"/></>,
    plug: <><path d="M9 3v5M15 3v5"/><path d="M7 8h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V8Z"/><path d="M12 16v5"/></>,
    ball: <><circle cx="12" cy="12" r="9"/><path d="M12 3c3 3 3 15 0 18M3.5 9h17M3.5 15h17"/></>,
    car: <><path d="M4 16v-3l2-5h12l2 5v3"/><path d="M4 16h16v3h-3v-3M7 19H4v-3"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/></>,
    key: <><circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M15 12v2.5"/></>,
};

/** Every mark this app can draw, for pickers that offer a choice. */
export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  );
}
