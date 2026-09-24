import type { ReactNode } from "react";

/** Tool and hardware marks: 24×24, stroke only, drawn to read clearly at 20px. */
export const TOOLS_ICON_PATHS = {
  pliers: <>
    <path d="M10 3l-1 7-2 11"/>
    <path d="M14 3l1 7 2 11"/>
    <circle cx="12" cy="10" r="1.4"/>
    <path d="M9.4 5.5h1.6M8.8 7.8h1.6"/>
    <path d="M13 5.5h1.6M13.6 7.8h1.6"/>
    <path d="M7.3 18l2-.6M15.7 18l-2-.6"/>
  </>,
  hexkey: <>
    <path d="M7 4v9h10"/>
    <polygon points="7,3 8.7,4 8.7,6 7,7 5.3,6 5.3,4"/>
    <path d="M5.5 8.5h3M5.5 11h3"/>
    <path d="M15 13.5v2"/>
  </>,
  socket: <>
    <path d="M8 5h8l4 7-4 7H8l-4-7z"/>
    <rect x="9.5" y="9.5" width="5" height="5"/>
    <path d="M8 5v2M16 5v2M8 17v-2M16 17v-2"/>
    <path d="M4.5 12h2M17.5 12h2"/>
  </>,
  ratchet: <>
    <circle cx="15" cy="8" r="5"/>
    <rect x="13.4" y="6.4" width="3.2" height="3.2"/>
    <path d="M19.3 5.5l1.4-.4-.3 1.4"/>
    <path d="M11 12l-6 8"/>
    <path d="M8.8 14.6l-1.4 1.8M7 17l-1.4 1.8"/>
  </>,
  mallet: <>
    <rect x="4" y="5" width="12" height="7" rx="2"/>
    <path d="M4 8.5h12"/>
    <path d="M10 12v9"/>
    <path d="M7.5 15.5h5M7.5 18h5"/>
  </>,
  chisel: <>
    <rect x="3" y="15" width="6" height="5" rx="1"/>
    <path d="M4 17h4"/>
    <path d="M9 16.5h1.5"/>
    <path d="M9.5 17.5l10-10"/>
    <path d="M19.5 7l-2.5 2.5"/>
  </>,
  saw: <>
    <path d="M4 19L20 3"/>
    <path d="M6 17l2 2M9.5 13.5l2 2M13 10l2 2M16.5 6.5l2 2"/>
    <path d="M3.5 19.5a2.5 2.5 0 0 1 3.3 -2.4"/>
    <circle cx="4.3" cy="18.5" r="0.6"/>
  </>,
  tweezers: <>
    <path d="M8 4L12 19"/>
    <path d="M16 4L12 19"/>
    <path d="M8 4q4 -2 8 0"/>
    <path d="M9 8.3l1.6 .6M8.5 11.3l1.6 .6M15 8.3l-1.6 .6M15.5 11.3l-1.6 .6"/>
  </>,
  heatgun: <>
    <rect x="4" y="6" width="9" height="6" rx="1"/>
    <path d="M13 8h3M13 10.5h3"/>
    <path d="M8 12v7l-2 2"/>
    <path d="M6.5 16.5h3"/>
    <path d="M17 7.5q2 1.5 4 0M17 10.5q2 1.5 4 0"/>
  </>,
  gluegun: <>
    <rect x="5" y="7" width="8" height="5" rx="1"/>
    <path d="M9 12v7"/>
    <path d="M6.5 16h3"/>
    <path d="M13 8.5h5l2 2-2 1.5h-5z"/>
    <path d="M20 12.5v2"/>
    <circle cx="20" cy="16" r="0.6"/>
  </>,
  torch: <>
    <rect x="4" y="12" width="6" height="6" rx="1"/>
    <path d="M6 12V9"/>
    <circle cx="6" cy="8" r="1"/>
    <path d="M10 15h6"/>
    <path d="M18 8c3 3 3 7 0 9c-3 -2 -3 -6 0 -9z"/>
    <path d="M18 10.5c1.2 1.3 1.2 3.2 0 4.5"/>
  </>,
  whetstone: <>
    <rect x="4" y="15" width="14" height="4" rx="1"/>
    <path d="M6 17h10"/>
    <path d="M9 15l8-9"/>
    <path d="M15.5 7.5l1.5-1.5"/>
    <path d="M11 12.5q1.5 -1 3 0"/>
  </>,
  oilcan: <>
    <path d="M5 11h6v9H5z"/>
    <ellipse cx="8" cy="20" rx="3" ry="1"/>
    <path d="M6.5 11V8.5q0 -1.5 1.5 -1.5t1.5 1.5"/>
    <path d="M11 12q6-1 9-8"/>
    <circle cx="20.3" cy="3.7" r="0.8"/>
  </>,
  caliper: <>
    <path d="M6 4v9M14 4v6"/>
    <line x1="4" y1="13" x2="20" y2="13"/>
    <path d="M9 13v6M16 13v4"/>
    <path d="M11 15h1.6M11 17h1.6M11 19h1.6"/>
    <circle cx="17.5" cy="10" r="1"/>
  </>,
  tapemeasure: <>
    <circle cx="9" cy="10" r="6"/>
    <circle cx="9" cy="10" r="1.3"/>
    <path d="M15 10h5"/>
    <path d="M20 8.5v3"/>
    <path d="M17 9v2M18.8 9v2"/>
    <rect x="7.5" y="4.3" width="3" height="1.6" rx="0.5"/>
  </>,
  square: <>
    <path d="M5 5v14h14"/>
    <path d="M8 5v11h11"/>
    <circle cx="6.5" cy="16.5" r="0.8"/>
    <path d="M5 8h2.3M5 11.5h2.3M5 15h2.3"/>
    <path d="M9 19h2.3M12.5 19h2.3M16 19h2.3"/>
  </>,
  level: <>
    <rect x="4" y="10" width="16" height="5" rx="1"/>
    <ellipse cx="12" cy="12.5" rx="3" ry="1.8"/>
    <circle cx="12" cy="12.5" r="1"/>
    <path d="M9.5 11v3M14.5 11v3"/>
    <path d="M6 10v5M18 10v5"/>
  </>,
  vise: <>
    <rect x="5" y="6" width="3" height="12" rx="0.5"/>
    <rect x="12" y="6" width="3" height="12" rx="0.5"/>
    <path d="M17 9v7"/>
    <path d="M15.6 10.3h2.8M15.6 12.3h2.8M15.6 14.3h2.8"/>
    <path d="M17 6v3"/>
    <path d="M15 7.2h4"/>
  </>,
  tapdie: <>
    <path d="M6 4h8l2 3-2 3H6l-2-3z"/>
    <circle cx="10" cy="7" r="2"/>
    <path d="M10 9v10"/>
    <path d="M8 11l2-1 2 1M8 14l2-1 2 1M8 17l2-1 2 1"/>
  </>,
  bitset: <>
    <rect x="5" y="15" width="14" height="4" rx="1"/>
    <path d="M6 15h12"/>
    <path d="M8 15V7M6.5 7h3"/>
    <path d="M13 15V7M11.7 7.3h2.6"/>
    <path d="M18 15V8M16.6 8l1.4-1.2 1.4 1.2"/>
  </>,
  gear: <>
    <circle cx="12" cy="12" r="4.2"/>
    <circle cx="12" cy="12" r="1.4"/>
    <path d="M12 6.2v1.6M12 16.2v1.6M6.2 12h1.6M16.2 12h1.6"/>
    <path d="M8.1 8.1l1.1 1.1M14.8 14.8l1.1 1.1M15.9 8.1l-1.1 1.1M9.2 14.8l-1.1 1.1"/>
  </>,
  bearing: <>
    <circle cx="12" cy="12" r="7.2"/>
    <circle cx="12" cy="12" r="3.6"/>
    <circle cx="12" cy="6.8" r="1"/>
    <circle cx="17.2" cy="12" r="1"/>
    <circle cx="12" cy="17.2" r="1"/>
    <circle cx="6.8" cy="12" r="1"/>
  </>,
  magnet: <>
    <path d="M6 5v7Q6 19 12 19Q18 19 18 12v-7"/>
    <rect x="5" y="3.3" width="3.4" height="3" rx="0.6"/>
    <rect x="15.6" y="3.3" width="3.4" height="3" rx="0.6"/>
    <path d="M6.7 4.6h2"/>
    <path d="M15.9 4.6h2"/>
  </>,
  pump: <>
    <rect x="5" y="9" width="8" height="7" rx="1"/>
    <path d="M9 9V4"/>
    <path d="M7 4h4"/>
    <path d="M5 12h8"/>
    <path d="M13 12.5q4 1 6 6"/>
    <circle cx="19.3" cy="19.3" r="0.8"/>
  </>,
  valve: <>
    <circle cx="12" cy="7" r="4"/>
    <path d="M12 3.4v7.2M8.4 7h7.2"/>
    <path d="M12 11v6"/>
    <path d="M6 17h12"/>
    <path d="M6 15.3v3.4M18 15.3v3.4"/>
  </>,
  tube: <>
    <rect x="9.5" y="4" width="5" height="3" rx="0.8"/>
    <path d="M10 7l-2 3h8l-2-3z"/>
    <path d="M8 10h8v6.5H8z"/>
    <path d="M8 13h8"/>
    <path d="M8.3 16.5l1.5 1 1.4-1 1.4 1 1.4-1 1.5 1"/>
  </>,
  nail: <>
    <path d="M7.5 5h9v3h-9z"/>
    <path d="M9 6.5h5"/>
    <path d="M12 8v9"/>
    <path d="M12 17l-2 3"/>
    <path d="M14 8v7"/>
  </>,
  anchor: <>
    <circle cx="12" cy="5" r="1.6"/>
    <path d="M12 6.6v11"/>
    <path d="M9 9h6"/>
    <path d="M12 17.6q-4 3 -6.5 0.5"/>
    <path d="M12 17.6q4 3 6.5 0.5"/>
    <path d="M4.8 17.3l1.3 1.4M19.2 17.3l-1.3 1.4"/>
  </>,
  hinge: <>
    <rect x="4" y="5" width="9" height="5" rx="0.8"/>
    <rect x="4" y="14" width="9" height="5" rx="0.8"/>
    <circle cx="7.5" cy="7.5" r="0.8"/>
    <circle cx="7.5" cy="16.5" r="0.8"/>
    <path d="M14 4v16"/>
    <path d="M12.5 8.5h3M12.5 12h3M12.5 15.5h3"/>
  </>,
  caster: <>
    <circle cx="12" cy="16" r="4"/>
    <circle cx="12" cy="16" r="1"/>
    <rect x="9" y="4.5" width="6" height="2.2" rx="0.6"/>
    <path d="M9.5 6.7l1.8 6.3M14.5 6.7l-1.8 6.3"/>
    <path d="M12 6.7v3"/>
  </>,
  hook: <>
    <path d="M12 4v9a4 4 0 1 1 -4 -4"/>
    <path d="M10.3 4h3.4"/>
    <path d="M11 5.6h2M11 7.2h2"/>
    <path d="M8.3 12.6l-.9 1.6"/>
  </>,
  hanger: <>
    <path d="M9 6.2Q12 3 15 6.2"/>
    <path d="M12 6.2l9 8H3z"/>
    <path d="M7.2 13.6h2M11 13.6h2M14.8 13.6h2"/>
    <path d="M12 4.2v1.6"/>
  </>,
  ziptie: <>
    <path d="M6.5 11a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0"/>
    <rect x="13.3" y="3.8" width="3.6" height="3" rx="0.5"/>
    <path d="M16.9 5.3h4"/>
    <path d="M18.2 4.3v2M20.2 4.3v2"/>
  </>,
  velcro: <>
    <rect x="4" y="5" width="16" height="4" rx="1"/>
    <path d="M7 6q0 1.8 1.8 0M11 6q0 1.8 1.8 0M15 6q0 1.8 1.8 0"/>
    <rect x="4" y="15" width="16" height="4" rx="1"/>
    <path d="M7 16v1.6q0 .8 .8 0M11 16v1.6q0 .8 .8 0M15 16v1.6q0 .8 .8 0"/>
  </>,
  rope: <>
    <path d="M5 7a2.6 1.8 0 1 0 5.2 0a2.6 1.8 0 1 0 -5.2 0"/>
    <path d="M9.4 11a2.6 1.8 0 1 0 5.2 0a2.6 1.8 0 1 0 -5.2 0"/>
    <path d="M13.8 15a2.6 1.8 0 1 0 5.2 0a2.6 1.8 0 1 0 -5.2 0"/>
    <path d="M7.6 8.2l1.8 1.8M12 12.2l1.8 1.8"/>
  </>,
  chain: <>
    <rect x="4" y="6" width="9" height="5" rx="2.5"/>
    <rect x="9" y="9" width="5" height="9" rx="2.5"/>
    <rect x="11" y="13" width="9" height="5" rx="2.5"/>
    <path d="M6 7.5h3"/>
    <path d="M15 16h3"/>
  </>,
  sewing: <>
    <path d="M11 3v9"/>
    <path d="M11 3q2 1 0 2q-2 1 0 2"/>
    <rect x="6" y="12" width="10" height="5" rx="1"/>
    <circle cx="11" cy="14.5" r="1"/>
    <path d="M7.5 17.5h1.5M10.5 17.5h1.5M13.5 17.5h1.5"/>
  </>,
  needle: <>
    <path d="M7.5 17.5l9-12.5"/>
    <path d="M6 19l1.5-1.5"/>
    <circle cx="17.3" cy="5.3" r="1.4"/>
    <path d="M16.2 6.4c-4 3-2 7 2 8"/>
    <path d="M18.2 14.2q1.2 1.3 -0.2 2.3"/>
  </>,
  sponge: <>
    <rect x="4" y="7" width="16" height="7" rx="3"/>
    <rect x="4" y="14" width="16" height="3" rx="1"/>
    <path d="M7.5 9.5h0M11 9h0M14.5 10h0M9 12h0M13 12.3h0M17 9.5h0"/>
    <path d="M6 15.5h3M10.5 15.5h3M15 15.5h3"/>
  </>,
  mop: <>
    <path d="M12 3v10"/>
    <path d="M10.5 6h3M10.5 8.5h3"/>
    <path d="M7 13h10"/>
    <path d="M8 13l-1.5 6M10 13v6M12 13l0.5 6M14 13l1.5 6M16.5 13l1.7 5.5"/>
  </>,
} as const satisfies Record<string, ReactNode>;

export type ToolsIconName = keyof typeof TOOLS_ICON_PATHS;
