import type { ReactNode } from "react";
import { CATEGORY_ICON_PATHS } from "./categoryIconPaths";
import { ELECTRONICS_ICON_PATHS } from "./categoryIconPathsElectronics";
import { TOOLS_ICON_PATHS } from "./categoryIconPathsTools";
import { MAKING_ICON_PATHS } from "./categoryIconPathsMaking";

/** The drawn source for the marks the server ships; exported to SVG, not bundled. */
export const MARK_PATHS: Record<string, ReactNode> = {
  ...CATEGORY_ICON_PATHS,
  ...ELECTRONICS_ICON_PATHS,
  ...TOOLS_ICON_PATHS,
  ...MAKING_ICON_PATHS,
};
