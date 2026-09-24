import type { Category } from "../api";

/**
 * One quiet line drawing per kind of thing, chosen from the category's own words.
 * Categories are free text and often Italian here, so both languages are matched;
 * anything unrecognised keeps the neutral tag.
 */
export const MARKS: Array<[string, string[]]> = [
  ["cutlery", ["food", "cibo", "alimentari", "grocer", "spesa", "pantry", "dispensa", "kitchen", "cucina", "pasta", "snack", "baking", "dairy", "latticini"]],
  ["bottle", ["drink", "bevande", "bottle", "bottigli", "liquid", "liquidi", "oil", "olio", "wine", "vino", "beer", "birra", "water", "acqua"]],
  ["chip", ["electronic", "elettronic", "component", "componenti", "circuit", "esp32", "arduino", "sensor", "sensori", "board", "microcontroll"]],
  ["plug", ["cable", "cavi", "power", "alimentazione", "charger", "caricabatt", "battery", "batterie", "adapter", "adattator"]],
  ["bolt", ["hardware", "ferramenta", "screw", "viti", "bolt", "bullon", "nut", "dadi", "nail", "chiodi", "fasten", "minuteria"]],
  ["wrench", ["tool", "attrezz", "utensil", "drill", "trapano", "workshop", "officina", "garage", "repair", "riparazion"]],
  ["spool", ["thread", "filo", "fili", "yarn", "filat", "sewing", "cucito", "textile", "tessut", "fabric", "stoffa", "wool", "lana"]],
  ["layers", ["leather", "pelle", "cuoio", "material", "materiali", "sheet", "fogli", "board", "cartone", "plywood", "compensato"]],
  ["book", ["book", "libri", "bookbinding", "legatoria", "binding", "notebook", "quaderni", "journal"]],
  ["sketchbook", ["paper", "carta", "document", "document", "print", "stampa", "office", "ufficio", "stationery", "cancelleria", "template", "modelli"]],
  ["palette", ["art", "arte", "paint", "pittura", "vernic", "colour", "color", "craft", "hobby", "glue", "colla", "ink", "inchiostro"]],
  ["leaf", ["garden", "giardin", "plant", "piante", "seed", "semi", "outdoor", "esterno", "flower", "fiori"]],
  ["shirt", ["cloth", "abbigliament", "wear", "vestit", "shoe", "scarpe", "bag", "borse", "accessor"]],
  ["jar", ["medicine", "medicin", "farmac", "health", "salute", "first aid", "pronto soccorso", "supplement", "integrator"]],
  ["spray", ["clean", "puliz", "detergent", "laundry", "bucato", "chemical", "chimic", "bathroom", "bagno"]],
  ["gamepad", ["sport", "game", "giochi", "toy", "giocatt", "fitness", "palestra", "music", "musica"]],
  ["gear", ["car", "auto", "vehicle", "veicol", "bike", "bici", "moto", "travel", "viaggi"]],
  ["shield", ["key", "chiavi", "lock", "serratur", "security", "sicurezza", "document", "documenti"]],
];

/**
 * The mark a category carries, which the owner chose or the server suggested.
 * A category that has none yet borrows its nearest ancestor's, and failing that
 * the list reads the words itself, so a new category is never blank.
 */
export function categoryIcons(categories: Category[]): Map<number, string> {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const resolved = new Map<number, string>();
  for (const category of categories) {
    let current: Category | undefined = category;
    const seen = new Set<number>();
    while (current && !current.icon && !seen.has(current.id)) {
      seen.add(current.id);
      current = current.parent_id === null ? undefined : byId.get(current.parent_id);
    }
    resolved.set(category.id, current?.icon || categoryIcon(category.path));
  }
  return resolved;
}

export function categoryIcon(categoryPath: string): string {
  const text = categoryPath.toLowerCase();
  for (const [icon, words] of MARKS) {
    if (words.some((word) => text.includes(word))) return icon;
  }
  return "tag";
}
