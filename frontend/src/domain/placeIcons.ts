import type { LocationNode } from "../api";

/**
 * Icons for places, drawn from the same set as category icons. Place names are free
 * text and often Italian here, so both languages are matched against the name first
 * and the kind of place second.
 */
export const PLACE_ICONS: Array<[string, string[]]> = [
  ["snowflake", ["freezer", "congelator"]],
  ["fridge", ["fridge", "frigo"]],
  ["cutlery", ["kitchen", "cucina", "pantry", "dispensa"]],
  ["shower", ["bathroom", "bagno", "shower", "doccia"]],
  ["gear", ["garage", "car", "auto"]],
  ["toolbox", ["workshop", "officina", "laborator", "workbench", "banco"]],
  ["greenhouse", ["garden", "giardin", "orto", "greenhouse", "serra", "balcon", "terrazz"]],
  ["chair", ["office", "ufficio", "studio", "desk", "scrivania"]],
  ["hanger", ["wardrobe", "armadio", "closet", "guardaroba"]],
  ["book", ["bookcase", "libreria", "bookshelf"]],
  ["layers", ["shelf", "shelves", "scaffal", "mensol", "rack"]],
  ["case", ["drawer", "cassett", "cabinet", "mobile", "credenza", "comodino"]],
  ["boxes", ["box", "scatol", "container", "contenitor", "crate", "bin", "cesta"]],
  ["home", ["room", "stanza", "camera", "soggiorno", "salotto", "living", "bedroom", "house", "casa", "home", "cantina", "soffitta", "attic", "basement"]],
];

function guess(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [icon, words] of PLACE_ICONS) {
    if (words.some((word) => lower.includes(word))) return icon;
  }
  return null;
}

/**
 * The icon each place shows: the one chosen for it, otherwise a guess from its own
 * name and kind, otherwise the nearest parent's chosen icon, otherwise boxes.
 */
export function placeIcons(roots: LocationNode[]): Map<string, string> {
  const resolved = new Map<string, string>();
  const visit = (node: LocationNode, inherited: string | null) => {
    const own = node.icon || null;
    resolved.set(node.public_id, own || guess(node.name) || guess(node.kind) || inherited || "boxes");
    for (const child of node.children) visit(child, own || inherited);
  };
  for (const root of roots) visit(root, null);
  return resolved;
}
