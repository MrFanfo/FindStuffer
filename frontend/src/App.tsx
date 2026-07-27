import { CSSProperties, FormEvent, MutableRefObject, ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import {
  api,
  AICommand,
  AIConnectionDiagnostic,
  AIScanProposal,
  ApplicationSettings,
  AuthStatus,
  BarcodeResult,
  Bootstrap,
  Category,
  CategoryCapabilities,
  CategoryContents,
  Dashboard,
  flattenLocations,
  HistoryEvent,
  HttpRequestError,
  ImportBatch,
  ImportPreviewDetail,
  Item,
  ItemLot,
  ItemReservation,
  Loan,
  LocationContents,
  LocationNode,
  LocationRule,
  LocationType,
  MaintenanceTask,
  OffCategoryMapping,
  OffCategoryMappingImportResult,
  Photo,
  Project,
  RelatedItem,
  ShoppingEntry,
  SoftwareUpdateStatus,
  Enrichment,
  FullOffProduct,
  EnrichmentSuggestion,
  isAuthenticationError,
  isRequestAborted,
} from "./api";

type View = "inventory" | "capture" | "add" | "scan" | "places" | "locations" | "location" | "categories" | "category" | "off-category-mappings" | "dashboard" | "manage";
type CaptureMode = "scan" | "quick" | "putaway" | "consume" | "assistant";
type PlacesSection = "locations" | "categories";
type ThemePreference = "light" | "dark" | "system";
type InventoryFilter = "all" | "low" | "expiring" | "details";
type InventoryGroup = "none" | "room" | "location" | "category" | "tag" | "unit";
type InventorySort = "updated" | "name" | "location" | "quantity-asc" | "quantity-desc" | "expiration";
type DetailItemSort = "name" | "quantity-asc" | "quantity-desc" | "location" | "category";
type DetailItemView = "grid" | "list";
type InventorySearchOptions = { showBusy?: boolean };
type IconName = "home" | "search" | "plus" | "scan" | "more" | "pin" | "box" | "camera" | "mic" | "spark" | "chevron" | "close" | "user" | "settings" | "qr" | "minus" | "check" | "filter" | "tag";
type AdjustmentQueue = {
  confirmed: Item;
  inFlight: boolean;
  pendingDelta: number;
  timer: number | null;
};
type RefreshScope = "all" | "inventory" | "none";
type RetryNotice = {
  action: () => Promise<void>;
  label: string;
  message: string;
};
type ActionOptions = {
  progress?: string;
  undo?: () => Promise<void>;
};
type CategoryNode = Category & { children: CategoryNode[] };
type InventoryViewPrefs = {
  groupBy: InventoryGroup;
  sortBy: InventorySort;
};
type FormulaField = "name" | "brand" | "model" | "serial" | "description" | "notes" | "category" | "location" | "tag" | "quantity" | "unit" | "value" | "weight" | "length" | "width" | "height" | "expiration" | "barcode" | "updated" | "low_stock" | "has_photo" | "missing_location";
type FormulaOperator = "contains" | "not-contains" | "equals" | "not-equals" | "one-of" | "not-one-of" | "gt" | "gte" | "lt" | "lte" | "before" | "after" | "empty" | "not-empty";
type FormulaRule = { id: string; field: FormulaField; operator: FormulaOperator; value: string };
type InventoryFormula = { source: string };
type FormulaNode =
  | { type: "and" | "or"; left: FormulaNode; right: FormulaNode }
  | { type: "not"; node: FormulaNode }
  | { type: "condition"; rule: FormulaRule; choices?: string[] };
type FormulaToken = { value: string; position: number; kind: "word" | "string" | "operator" | "punctuation" };
type FormulaValidation = { node: FormulaNode | null; error: string };
type SavedInventoryView = {
  id: string;
  name: string;
  formula: InventoryFormula;
  query: string;
  filter: InventoryFilter;
  groupBy: InventoryGroup;
  sortBy: InventorySort;
  categoryFilter: string;
  locationFilter: string;
  tagFilter: string;
  includeZero: boolean;
};

const LEGACY_APP_CACHE_KEY = "findstuff.appSnapshot.v2";
const INVENTORY_PREFS_KEY = "findstuff.inventoryPrefs.v1";
const SAVED_INVENTORY_VIEWS_KEY = "findstuff.savedInventoryViews.v1";
const THEME_KEY = "findstuff.theme.v1";
const LOST_TAG = "lost";
const INITIAL_RESULT_WINDOW = 120;
const RESULT_WINDOW_STEP = 120;

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function emptyInventoryFormula(): InventoryFormula {
  return { source: "" };
}

function cloneFormula(formula: InventoryFormula): InventoryFormula {
  return { source: formula.source || "" };
}

function loadSavedInventoryViews(): SavedInventoryView[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_INVENTORY_VIEWS_KEY) || "[]") as SavedInventoryView[];
    return Array.isArray(parsed) ? parsed.filter((view) => view && typeof view.name === "string" && view.formula).map((view) => ({
      ...view,
      formula: typeof view.formula.source === "string" ? view.formula : emptyInventoryFormula(),
    })) : [];
  } catch {
    return [];
  }
}

function saveSavedInventoryViews(views: SavedInventoryView[]): void {
  try {
    localStorage.setItem(SAVED_INVENTORY_VIEWS_KEY, JSON.stringify(views));
  } catch {
    // Saved views are a local UI preference; inventory data remains untouched.
  }
}

function itemFormulaValues(item: Item, field: FormulaField): Array<string | number> {
  if (field === "name") return [item.name];
  if (field === "brand") return [item.brand];
  if (field === "model") return [item.model];
  if (field === "serial") return [item.serial_number];
  if (field === "description") return [item.description];
  if (field === "notes") return [item.notes];
  if (field === "category") return [item.category_path || item.category_name || ""];
  if (field === "location") return [item.location_path];
  if (field === "tag") return item.tags;
  if (field === "quantity") return [Number(item.quantity)];
  if (field === "unit") return [item.unit];
  if (field === "value") {
    const minor = item.estimated_price_minor ?? item.purchase_price_minor;
    return minor === null ? [""] : [minor / 100];
  }
  if (field === "weight") return [item.weight_g ?? ""];
  if (field === "length") return [item.length_mm ?? ""];
  if (field === "width") return [item.width_mm ?? ""];
  if (field === "height") return [item.height_mm ?? ""];
  if (field === "expiration") return [item.expiration_date || ""];
  if (field === "barcode") return [item.barcode];
  if (field === "low_stock") return [String(isLowStock(item))];
  if (field === "has_photo") return [String(Boolean(item.primary_photo_url))];
  if (field === "missing_location") return [String(item.location_public_id === "unassigned")];
  return [item.updated_at];
}

function formulaRuleMatches(item: Item, rule: FormulaRule, explicitChoices?: string[]): boolean {
  const values = itemFormulaValues(item, rule.field);
  const wanted = rule.value.trim();
  const textValues = values.map((value) => String(value).trim().toLocaleLowerCase());
  const wantedText = wanted.toLocaleLowerCase();
  const choices = (explicitChoices || wanted.split(",")).map((value) => value.trim().toLocaleLowerCase()).filter(Boolean);
  if (rule.operator === "empty") return textValues.length === 0 || textValues.every((value) => !value);
  if (rule.operator === "not-empty") return textValues.some(Boolean);
  if (!wanted) return true;
  if (rule.operator === "contains") return textValues.some((value) => value.includes(wantedText));
  if (rule.operator === "not-contains") return textValues.every((value) => !value.includes(wantedText));
  if (rule.operator === "equals") return textValues.some((value) => value === wantedText);
  if (rule.operator === "not-equals") return textValues.every((value) => value !== wantedText);
  if (rule.operator === "one-of") return textValues.some((value) => choices.some((choice) => value === choice || value.endsWith(` > ${choice}`)));
  if (rule.operator === "not-one-of") return textValues.every((value) => choices.every((choice) => value !== choice && !value.endsWith(` > ${choice}`)));
  if (["gt", "gte", "lt", "lte"].includes(rule.operator)) {
    if (!String(values[0] ?? "").trim()) return false;
    const actual = Number(values[0]);
    const expected = Number(wanted.replace(",", "."));
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
    if (rule.operator === "gt") return actual > expected;
    if (rule.operator === "gte") return actual >= expected;
    if (rule.operator === "lt") return actual < expected;
    return actual <= expected;
  }
  const actualDate = Date.parse(String(values[0] || ""));
  const expectedDate = Date.parse(wanted);
  if (!Number.isFinite(actualDate) || !Number.isFinite(expectedDate)) return false;
  return rule.operator === "before" ? actualDate < expectedDate : actualDate > expectedDate;
}

function tokenizeFormula(source: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let index = 0;
  while (index < source.length) {
    if (/\s/.test(source[index])) { index += 1; continue; }
    const position = index;
    const character = source[index];
    if (character === '"' || character === "'") {
      const quote = character;
      let value = "";
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\" && index + 1 < source.length) { value += source[index + 1]; index += 2; }
        else { value += source[index]; index += 1; }
      }
      if (source[index] !== quote) throw new Error(`Unclosed quote at character ${position + 1}`);
      index += 1;
      tokens.push({ value, position, kind: "string" });
      continue;
    }
    if ("()[],".includes(character)) {
      tokens.push({ value: character, position, kind: "punctuation" });
      index += 1;
      continue;
    }
    if ("<>=!".includes(character)) {
      const pair = source.slice(index, index + 2);
      const value = ["<=", ">=", "!=", "=="].includes(pair) ? pair : character;
      tokens.push({ value, position, kind: "operator" });
      index += value.length;
      continue;
    }
    let value = "";
    while (index < source.length && !/\s/.test(source[index]) && !"()[],<>=!\"'".includes(source[index])) {
      value += source[index];
      index += 1;
    }
    tokens.push({ value, position, kind: "word" });
  }
  return tokens;
}

class InventoryFormulaParser {
  private index = 0;
  constructor(private readonly tokens: FormulaToken[]) {}
  parse(): FormulaNode | null {
    if (!this.tokens.length) return null;
    const node = this.parseOr();
    if (this.peek()) this.fail(`Unexpected “${this.peek()?.value}”`, this.peek());
    return node;
  }
  private peek(offset = 0): FormulaToken | undefined { return this.tokens[this.index + offset]; }
  private take(): FormulaToken { return this.tokens[this.index++]; }
  private is(value: string, offset = 0): boolean { return this.peek(offset)?.value.toLocaleUpperCase() === value; }
  private accept(value: string): boolean { if (!this.is(value)) return false; this.index += 1; return true; }
  private fail(message: string, token = this.peek()): never { throw new Error(`${message}${token ? ` at character ${token.position + 1}` : " at the end of the formula"}`); }
  private parseOr(): FormulaNode {
    let node = this.parseAnd();
    while (this.accept("OR")) node = { type: "or", left: node, right: this.parseAnd() };
    return node;
  }
  private parseAnd(): FormulaNode {
    let node = this.parseUnary();
    while (this.accept("AND")) node = { type: "and", left: node, right: this.parseUnary() };
    return node;
  }
  private parseUnary(): FormulaNode {
    if (this.accept("NOT")) return { type: "not", node: this.parseUnary() };
    if (this.accept("(")) {
      const node = this.parseOr();
      if (!this.accept(")")) this.fail("Expected closing parenthesis");
      return node;
    }
    return this.parseCondition();
  }
  private parseValue(): string {
    const token = this.peek();
    if (!token || [")", "]", ","].includes(token.value) || this.is("AND") || this.is("OR")) this.fail("Expected a value", token);
    return this.take().value;
  }
  private parseList(): string[] {
    if (!this.accept("[")) this.fail("Expected [ after IN");
    const values: string[] = [];
    if (this.accept("]")) this.fail("A choice list cannot be empty");
    do { values.push(this.parseValue()); } while (this.accept(","));
    if (!this.accept("]")) this.fail("Expected ] after the choice list");
    return values;
  }
  private parseCondition(): FormulaNode {
    const fieldToken = this.peek();
    if (!fieldToken) this.fail("Expected a field");
    const aliases: Record<string, FormulaField> = { name: "name", brand: "brand", model: "model", serial: "serial", serial_number: "serial", description: "description", notes: "notes", category: "category", location: "location", tag: "tag", tags: "tag", quantity: "quantity", qty: "quantity", unit: "unit", value: "value", price: "value", weight: "weight", weight_g: "weight", length: "length", length_mm: "length", width: "width", width_mm: "width", height: "height", height_mm: "height", expiration: "expiration", expires: "expiration", barcode: "barcode", updated: "updated", low_stock: "low_stock", has_photo: "has_photo", missing_location: "missing_location" };
    const field = aliases[this.take().value.toLocaleLowerCase()];
    if (!field) this.fail(`Unknown field “${fieldToken.value}”`, fieldToken);
    let operator: FormulaOperator;
    let values: string[] = [];
    if (this.accept("IS")) {
      const negative = this.accept("NOT");
      if (!this.accept("EMPTY")) this.fail("Expected EMPTY after IS");
      operator = negative ? "not-empty" : "empty";
    } else {
      const negative = this.accept("NOT");
      if (this.accept("IN")) { operator = negative ? "not-one-of" : "one-of"; values = this.parseList(); }
      else if (this.accept("CONTAINS")) { operator = negative ? "not-contains" : "contains"; values = [this.parseValue()]; }
      else if (negative) this.fail("Expected IN or CONTAINS after NOT");
      else if (this.accept("BEFORE")) { operator = "before"; values = [this.parseValue()]; }
      else if (this.accept("AFTER")) { operator = "after"; values = [this.parseValue()]; }
      else {
        const comparison = this.take();
        const comparisons: Record<string, FormulaOperator> = { "=": "equals", "==": "equals", "!=": "not-equals", ">": "gt", ">=": "gte", "<": "lt", "<=": "lte" };
        operator = comparisons[comparison?.value];
        if (!operator) this.fail(`Unknown operator “${comparison?.value || ""}”`, comparison);
        values = [this.parseValue()];
      }
    }
    const numericFields: FormulaField[] = ["quantity", "value", "weight", "length", "width", "height"];
    const dateFields: FormulaField[] = ["expiration", "updated"];
    const booleanFields: FormulaField[] = ["low_stock", "has_photo", "missing_location"];
    if (["gt", "gte", "lt", "lte"].includes(operator) && !numericFields.includes(field)) this.fail(`${operator.toUpperCase()} requires a numeric field`, fieldToken);
    if (["before", "after"].includes(operator) && !dateFields.includes(field)) this.fail(`${operator.toUpperCase()} requires a date field`, fieldToken);
    if (["contains", "not-contains"].includes(operator) && [...numericFields, ...dateFields, ...booleanFields].includes(field)) this.fail("CONTAINS requires a text field", fieldToken);
    if (numericFields.includes(field) && ["equals", "not-equals", "gt", "gte", "lt", "lte"].includes(operator) && !Number.isFinite(Number(values[0]))) this.fail(`Expected a number for ${field}`, this.peek(-1));
    if (dateFields.includes(field) && ["equals", "not-equals", "before", "after"].includes(operator) && (!/^\d{4}-\d{2}-\d{2}$/.test(values[0]) || !Number.isFinite(Date.parse(values[0])))) this.fail(`Expected a YYYY-MM-DD date for ${field}`, this.peek(-1));
    if (booleanFields.includes(field) && ["equals", "not-equals"].includes(operator) && !["true", "false"].includes((values[0] || "").toLocaleLowerCase())) this.fail(`Expected true or false for ${field}`, this.peek(-1));
    return { type: "condition", rule: { id: uid("parsed"), field, operator, value: values[0] || "" }, choices: values };
  }
}

function validateInventoryFormula(source: string): FormulaValidation {
  try {
    return { node: new InventoryFormulaParser(tokenizeFormula(source.trim())).parse(), error: "" };
  } catch (error) {
    return { node: null, error: error instanceof Error ? error.message : "Invalid formula" };
  }
}

function inventoryFormulaMatches(item: Item, node: FormulaNode | null): boolean {
  if (!node) return true;
  if (node.type === "condition") return formulaRuleMatches(item, node.rule, node.choices);
  if (node.type === "not") return !inventoryFormulaMatches(item, node.node);
  if (node.type === "and") return inventoryFormulaMatches(item, node.left) && inventoryFormulaMatches(item, node.right);
  return inventoryFormulaMatches(item, node.left) || inventoryFormulaMatches(item, node.right);
}
const EMPTY_DASHBOARD: Dashboard = {
  item_count: 0,
  location_count: 0,
  low_stock_count: 0,
  expiring_count: 0,
  needs_details_count: 0,
  recent_events: [],
};

function hasLostTag(item: Item): boolean {
  return item.tags.some((tag) => tag.toLowerCase() === LOST_TAG);
}

function withLostTag(item: Item): string[] {
  return hasLostTag(item) ? item.tags : [...item.tags, LOST_TAG];
}

function withoutLostTag(item: Item): string[] {
  return item.tags.filter((tag) => tag.toLowerCase() !== LOST_TAG);
}

function friendlyErrorMessage(error: unknown, fallback: string): string {
  if (!navigator.onLine) return "You're offline. The change was not saved.";
  if (!(error instanceof Error)) return fallback;
  if (error.message === "Failed to fetch") return "Could not reach Findstuff. Check the connection and try again.";
  if (error.message.includes("timed out")) return "Findstuff took too long to respond. Please try again.";
  return error.message || fallback;
}

function activityLabel(action: string): string {
  const labels: Record<string, string> = {
    adjust_quantity: "Quantity changed",
    archive: "Archived",
    create: "Created",
    move: "Moved",
    restore: "Restored",
    update: "Updated",
    update_tags: "Tags updated",
  };
  return labels[action] || action.replaceAll("_", " ");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return "<1 min";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
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
    filter: <><path d="M4 5h16l-6 7v5l-4 2v-7L4 5Z"/></>,
    tag: <><path d="M4 5v6.5L12.5 20 20 12.5 11.5 4H5.5A1.5 1.5 0 0 0 4 5.5Z"/><circle cx="8.5" cy="8.5" r="1"/></>,
  };
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function BarcodeGraphic({ value }: { value: string }) {
  const barcodeRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    if (!barcodeRef.current) return;
    try {
      JsBarcode(barcodeRef.current, value, {
        format: "auto",
        displayValue: false,
        height: 42,
        width: 1.45,
        margin: 0,
        background: "transparent",
        lineColor: "currentColor",
      });
    } catch {
      JsBarcode(barcodeRef.current, value, {
        format: "CODE128",
        displayValue: false,
        height: 42,
        width: 1.2,
        margin: 0,
        background: "transparent",
        lineColor: "currentColor",
      });
    }
  }, [value]);
  return <div className="rendered-barcode"><svg ref={barcodeRef} role="img" aria-label={`Barcode ${value}`} /><strong>{value}</strong></div>;
}

function isLowStock(item: Item): boolean {
  return item.low_stock_threshold !== null && Number(item.quantity) <= Number(item.low_stock_threshold);
}

function expirationState(item: Item): "expired" | "soon" | null {
  if (!item.expiration_date) return null;
  const days = Math.ceil((new Date(`${item.expiration_date}T23:59:59`).getTime() - Date.now()) / 86400000);
  if (days < 0) return "expired";
  return days <= 7 ? "soon" : null;
}

function expirationCopy(item: Item): string {
  if (!item.expiration_date) return "";
  const days = Math.ceil((new Date(`${item.expiration_date}T23:59:59`).getTime() - Date.now()) / 86400000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `${days}d left`;
}

function expirationTime(item: Item): number {
  if (!item.expiration_date) return Number.POSITIVE_INFINITY;
  return new Date(`${item.expiration_date}T23:59:59`).getTime();
}

function itemNeedsDetails(item: Item): boolean {
  return item.location_public_id === "unassigned";
}

function addDecimal(value: string, delta: number): string {
  const next = Math.max(0, Number(value.replace(",", ".")) + delta);
  return Number.isInteger(next) ? String(next) : next.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function optimisticQuantity(item: Item, delta: number): Item {
  return { ...item, quantity: addDecimal(item.quantity, delta), version: item.version + 1 };
}

function restockQuantity(item: Item): string {
  const current = Number(item.quantity);
  const threshold = item.low_stock_threshold === null ? current : Number(item.low_stock_threshold);
  const desired = Math.max(1, Math.ceil(threshold - current));
  return String(desired);
}

function firstLocationPart(item: Item): string {
  return item.location_path.split(">").map((part) => part.trim()).filter(Boolean)[0] || "Unassigned";
}

function groupLabel(item: Item, groupBy: InventoryGroup): string {
  if (groupBy === "room") return firstLocationPart(item);
  if (groupBy === "location") return item.location_path || "Unassigned";
  if (groupBy === "category") return categoryLabel(item) || "Uncategorised";
  if (groupBy === "unit") return item.unit || "No unit";
  return "";
}

function categoryLabel(item: Item): string {
  return item.category_path || item.category_name || "";
}

function nutritionLabel(key: string): string {
  return key
    .replace("_100g", "")
    .replace("energy-kcal", "kcal")
    .replace("energy", "energy")
    .replace("saturated-fat", "sat fat")
    .replaceAll("-", " ");
}

function nutritionValueLabel(key: string, value: string | number): string {
  const rendered = String(value);
  if (!rendered || /[a-z%]$/i.test(rendered)) return rendered;
  if (key.includes("energy-kcal")) return `${rendered} kcal`;
  if (key.includes("energy")) return `${rendered} kJ`;
  if (key.endsWith("_100g") || ["fat", "saturated-fat", "carbohydrates", "sugars", "fiber", "proteins", "salt", "sodium"].includes(key)) {
    return `${rendered} g`;
  }
  return rendered;
}

function categoryOptionLabel(category: Category): string {
  return category.path || category.name;
}

function parseLinkText(value: string): Array<{ label: string; url: string }> {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [first, ...rest] = line.split("|").map((part) => part.trim());
      const url = rest.length ? rest.join("|").trim() : first;
      return { label: rest.length ? first : url.replace(/^https?:\/\//, ""), url };
    })
    .filter((link) => link.label && link.url);
}

function linkText(links: Array<{ label: string; url: string }> = []): string {
  return links.map((link) => `${link.label} | ${link.url}`).join("\n");
}

const OPEN_CAPABILITIES: CategoryCapabilities = {
  expiration: true,
  batches: true,
  maintenance: true,
  reservation: true,
  enrichment: true,
  photos: true,
  identity: true,
  specs: true,
  price: true,
  links: true,
  shopping_list: true,
  override: false,
  inherited_from: null,
  inherited_label: "uncategorised defaults",
};

const CATEGORY_DATA_FIELD_LABELS: Record<keyof Omit<CategoryCapabilities, "override" | "inherited_from" | "inherited_label">, string> = {
  expiration: "Expiration",
  batches: "Batches",
  maintenance: "Maintenance",
  reservation: "Reservations",
  enrichment: "Enrichment",
  photos: "Photos",
  identity: "Identity",
  specs: "Specs",
  price: "Prices",
  links: "Links",
  shopping_list: "Shopping list",
};

function capabilitiesForCategory(categories: Category[], categoryId: number | string | null | undefined): CategoryCapabilities {
  if (categoryId === null || categoryId === undefined || categoryId === "") return OPEN_CAPABILITIES;
  return categories.find((category) => category.id === Number(categoryId))?.capabilities || OPEN_CAPABILITIES;
}

function buildCategoryTree(categories: Category[]): CategoryNode[] {
  const nodes = new Map<number, CategoryNode>(
    categories.map((category) => [category.id, { ...category, children: [] }]),
  );
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id === null ? null : nodes.get(node.parent_id);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (entries: CategoryNode[]) => {
    entries.sort((left, right) => categoryOptionLabel(left).localeCompare(categoryOptionLabel(right)));
    entries.forEach((entry) => sortNodes(entry.children));
  };
  sortNodes(roots);
  return roots;
}

function categoryDescendantIds(categories: Category[], rootId: number): Set<number> {
  const result = new Set<number>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (
        category.parent_id !== null &&
        result.has(category.parent_id) &&
        !result.has(category.id)
      ) {
        result.add(category.id);
        changed = true;
      }
    }
  }
  return result;
}

function viewFromParameter(value: string | null): View | null {
  if (!value) return null;
  const views: Record<string, View> = {
    add: "capture",
    capture: "capture",
    categories: "places",
    category: "places",
    dashboard: "dashboard",
    find: "inventory",
    home: "dashboard",
    inventory: "inventory",
    locations: "places",
    manage: "manage",
    more: "manage",
    "off-category-mappings": "off-category-mappings",
    places: "places",
    scan: "capture",
  };
  return views[value.toLowerCase()] || null;
}

function loadInventoryPrefs(): InventoryViewPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(INVENTORY_PREFS_KEY) || "null") as Partial<InventoryViewPrefs> | null;
    const groups: InventoryGroup[] = ["none", "room", "location", "category", "tag", "unit"];
    const sorts: InventorySort[] = ["updated", "name", "location", "quantity-asc", "quantity-desc", "expiration"];
    return {
      groupBy: parsed?.groupBy && groups.includes(parsed.groupBy) ? parsed.groupBy : "none",
      sortBy: parsed?.sortBy && sorts.includes(parsed.sortBy) ? parsed.sortBy : "updated",
    };
  } catch {
    return { groupBy: "none", sortBy: "updated" };
  }
}

function saveInventoryPrefs(prefs: InventoryViewPrefs): void {
  try {
    localStorage.setItem(INVENTORY_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preference storage is best-effort.
  }
}

const nav: Array<{ id: View; label: string; icon: IconName }> = [
  { id: "dashboard", label: "Home", icon: "home" },
  { id: "inventory", label: "Inventory", icon: "search" },
  { id: "capture", label: "Capture", icon: "scan" },
  { id: "places", label: "Places", icon: "pin" },
  { id: "manage", label: "More", icon: "more" },
];

function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<LocationNode[]>([]);
  const [locationTypes, setLocationTypes] = useState<LocationType[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<string[]>(["pcs", "box", "pack", "bag", "g", "kg", "ml", "l"]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [retryNotice, setRetryNotice] = useState<RetryNotice | null>(null);
  const [connectionIssue, setConnectionIssue] = useState("");
  const [busy, setBusy] = useState(false);
  const [activityMessage, setActivityMessage] = useState("");
  const [inventorySearchBusy, setInventorySearchBusy] = useState(false);
  const [pendingItems, setPendingItems] = useState<Set<string>>(() => new Set());
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [addLocation, setAddLocation] = useState("unassigned");
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>("all");
  const [inventoryCategoryId, setInventoryCategoryId] = useState<number | null>(null);
  const [inventoryTag, setInventoryTag] = useState("");
  const [inventoryIncludeZero, setInventoryIncludeZero] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>("scan");
  const [placesSection, setPlacesSection] = useState<PlacesSection>("locations");
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });
  const itemsRef = useRef<Item[]>([]);
  const refreshTimer = useRef<number | null>(null);
  const inventoryRefreshTimer = useRef<number | null>(null);
  const refreshController = useRef<AbortController | null>(null);
  const inventoryRefreshController = useRef<AbortController | null>(null);
  const refreshGeneration = useRef(0);
  const inventoryRefreshGeneration = useRef(0);
  const adjustmentQueue = useRef<Map<string, AdjustmentQueue>>(new Map());

  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => {
    const applyTheme = () => {
      const resolved = theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
        : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    applyTheme();
    localStorage.setItem(THEME_KEY, theme);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setGlobalSearchOpen(true);
      }
      if (event.key === "/" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        setGlobalSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);
  const navigate = useCallback((nextView: View) => {
    setView(nextView);
    window.scrollTo({ top: 0 });
  }, []);
  const openCapture = useCallback((mode: CaptureMode = "scan", locationId?: string) => {
    setCaptureMode(mode);
    if (locationId) setAddLocation(locationId);
    navigate("capture");
  }, [navigate]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => {
      setNotice("");
      setRetryNotice(null);
    }, retryNotice?.message === notice ? 9000 : 4500);
    return () => window.clearTimeout(timeout);
  }, [notice, retryNotice]);

  const notify = useCallback((message: string, retry?: Omit<RetryNotice, "message">) => {
    setNotice(message);
    setRetryNotice(retry ? { ...retry, message } : null);
  }, []);

  const applyBootstrap = useCallback((snapshot: Bootstrap) => {
    setAuth(snapshot.auth);
    setItems(snapshot.items);
    setLocations(snapshot.locations);
    setCategories(snapshot.categories);
    setLocationTypes(snapshot.location_types);
    setDashboard(snapshot.dashboard);
    setUnits(snapshot.units);
    setConnectionIssue("");
  }, []);

  const refresh = useCallback(async (
    search = query,
    options: { showBusy?: boolean } = {},
  ) => {
    const showBusy = options.showBusy ?? true;
    if (refreshTimer.current !== null) {
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
    refreshController.current?.abort();
    const controller = new AbortController();
    const generation = refreshGeneration.current + 1;
    refreshGeneration.current = generation;
    refreshController.current = controller;
    if (showBusy) setBusy(true);
    try {
      const snapshot = await api.bootstrap(search, { signal: controller.signal }, inventoryIncludeZero);
      if (generation !== refreshGeneration.current) return;
      applyBootstrap(snapshot);
      if (showBusy) {
        notify("");
      }
    } catch (error) {
      if (isRequestAborted(error)) return;
      const message = friendlyErrorMessage(error, "Unable to load Findstuff");
      setConnectionIssue(message);
      notify(message, { label: "Retry", action: async () => refresh(search, { showBusy: true }) });
    } finally {
      if (refreshController.current === controller) refreshController.current = null;
      if (showBusy && generation === refreshGeneration.current) setBusy(false);
    }
  }, [applyBootstrap, inventoryIncludeZero, notify, query]);

  const refreshInventory = useCallback(async (
    search = query,
    options: { showBusy?: boolean } = {},
  ) => {
    const showBusy = options.showBusy ?? false;
    if (inventoryRefreshTimer.current !== null) {
      window.clearTimeout(inventoryRefreshTimer.current);
      inventoryRefreshTimer.current = null;
    }
    inventoryRefreshController.current?.abort();
    const controller = new AbortController();
    const generation = inventoryRefreshGeneration.current + 1;
    inventoryRefreshGeneration.current = generation;
    inventoryRefreshController.current = controller;
    if (showBusy) {
      setBusy(true);
      setInventorySearchBusy(true);
    }
    try {
      const [nextItems, nextDashboard] = await Promise.allSettled([
        api.items(search, { signal: controller.signal }, { includeZero: inventoryIncludeZero }),
        api.dashboard({ signal: controller.signal }),
      ]);
      if (generation !== inventoryRefreshGeneration.current) return;
      if (nextItems.status === "fulfilled") {
        setItems(nextItems.value.map((item) => (
          adjustmentQueue.current.has(item.public_id)
            ? itemsRef.current.find((entry) => entry.public_id === item.public_id) || item
            : item
        )));
      }
      if (nextDashboard.status === "fulfilled") setDashboard(nextDashboard.value);
      const failure = [nextItems, nextDashboard].find((result) => (
        result.status === "rejected" && !isRequestAborted(result.reason)
      ));
      if (failure?.status === "rejected" && showBusy) {
        notify(friendlyErrorMessage(failure.reason, "Unable to refresh inventory"), {
          label: "Retry",
          action: async () => refreshInventory(search, { showBusy: true }),
        });
      }
    } finally {
      if (inventoryRefreshController.current === controller) inventoryRefreshController.current = null;
      if (showBusy && generation === inventoryRefreshGeneration.current) {
        setBusy(false);
        setInventorySearchBusy(false);
      }
    }
  }, [inventoryIncludeZero, notify, query]);

  const searchInventory = useCallback((value: string, options: InventorySearchOptions = {}) => {
    void refreshInventory(value, { showBusy: options.showBusy ?? true });
  }, [refreshInventory]);

  const scheduleRefresh = useCallback((search = query) => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void refresh(search, { showBusy: false });
    }, 300);
  }, [query, refresh]);

  const scheduleInventoryRefresh = useCallback((search = query) => {
    if (inventoryRefreshTimer.current !== null) window.clearTimeout(inventoryRefreshTimer.current);
    inventoryRefreshTimer.current = window.setTimeout(() => {
      inventoryRefreshTimer.current = null;
      void refreshInventory(search, { showBusy: false });
    }, 350);
  }, [query, refreshInventory]);

  const refreshAfterMutation = useCallback((scope: RefreshScope = "inventory") => {
    if (scope === "none") return;
    if (scope === "all") {
      scheduleRefresh();
      return;
    }
    scheduleInventoryRefresh();
  }, [scheduleInventoryRefresh, scheduleRefresh]);

  useEffect(() => () => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    if (inventoryRefreshTimer.current !== null) window.clearTimeout(inventoryRefreshTimer.current);
    refreshController.current?.abort();
    inventoryRefreshController.current?.abort();
  }, []);

  useEffect(() => {
    const offlineMessage = "You're offline. Reconnect to load the inventory.";
    const handleOffline = () => {
      setConnectionIssue(offlineMessage);
      notify(offlineMessage);
    };
    const handleOnline = () => {
      notify("Back online. Refreshing...");
      void refresh("", { showBusy: false });
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [notify, refresh]);

  useEffect(() => {
    localStorage.removeItem(LEGACY_APP_CACHE_KEY);
    api.bootstrap("", undefined, inventoryIncludeZero)
      .then((snapshot) => {
        applyBootstrap(snapshot);
        setNotice("");
      })
      .catch((error) => {
        if (isAuthenticationError(error)) {
          setAuth({ authenticated: false, user: null });
          setDashboard(null);
          setConnectionIssue("");
          setNotice("");
          return;
        }
        const message = error instanceof Error ? error.message : "Unable to connect";
        setAuth({ authenticated: false, user: null });
        setDashboard(EMPTY_DASHBOARD);
        setConnectionIssue(message);
        notify(message, {
          label: "Retry",
          action: async () => {
            const snapshot = await api.bootstrap("", undefined, inventoryIncludeZero);
            applyBootstrap(snapshot);
            notify("");
          },
        });
      });
  }, [applyBootstrap, inventoryIncludeZero, notify]); // Initialize once; searches are explicitly submitted.

  useEffect(() => {
    if (!auth?.authenticated) return;
    const parameters = new URLSearchParams(window.location.search);
    const itemId = parameters.get("item");
    const locationId = parameters.get("location");
    if (itemId) api.item(itemId).then(setSelectedItem).catch(() => undefined);
    if (locationId) {
      setSelectedLocationId(locationId);
      if (parameters.get("mode") === "add") {
        setAddLocation(locationId);
        setCaptureMode("quick");
        navigate("capture");
      } else {
        navigate("location");
      }
      return;
    }
    const requestedView = viewFromParameter(parameters.get("view"));
    if (requestedView) navigate(requestedView);
  }, [auth?.authenticated, navigate]);

  async function run(
    action: () => Promise<unknown>,
    success: string,
    scope: RefreshScope = "inventory",
    options: ActionOptions = {},
  ) {
    setBusy(true);
    setActivityMessage(options.progress || "Saving changes…");
    try {
      await action();
      notify(success, options.undo ? { label: "Undo", action: options.undo } : undefined);
      refreshAfterMutation(scope);
    } catch (error) {
      notify(friendlyErrorMessage(error, "The action failed"), {
        label: "Retry",
        action: async () => run(action, success, scope, options),
      });
    } finally {
      setBusy(false);
      setActivityMessage("");
    }
  }

  function applyLocalItem(updated: Item) {
    setItems((current) => current.map((entry) => (
      entry.public_id === updated.public_id ? updated : entry
    )).filter((entry) => inventoryIncludeZero || Number(entry.quantity) > 0));
    setSelectedItem((current) => (
      current?.public_id === updated.public_id ? updated : current
    ));
  }

  function finishQueue(publicId: string) {
    adjustmentQueue.current.delete(publicId);
    setPendingItems((current) => {
      const next = new Set(current);
      next.delete(publicId);
      return next;
    });
    scheduleInventoryRefresh();
  }

  async function flushAdjustment(publicId: string) {
    const queued = adjustmentQueue.current.get(publicId);
    if (!queued || queued.inFlight || queued.pendingDelta === 0) return;
    const delta = queued.pendingDelta;
    queued.pendingDelta = 0;
    queued.inFlight = true;
    try {
      const updated = await api.adjust(queued.confirmed, delta);
      queued.confirmed = updated;
      queued.inFlight = false;
      if (queued.pendingDelta !== 0) {
        applyLocalItem(optimisticQuantity(updated, queued.pendingDelta));
        void flushAdjustment(publicId);
        return;
      }
      applyLocalItem(updated);
      notify(`${updated.name}: quantity updated`, {
        label: "Undo",
        action: async () => {
          const current = await api.item(updated.public_id);
          const restored = await api.adjust(current, -delta);
          applyLocalItem(restored);
          scheduleInventoryRefresh();
          notify(`${restored.name}: change undone`);
        },
      });
      finishQueue(publicId);
    } catch (error) {
      const retryDelta = delta;
      const retryBase = queued.confirmed;
      applyLocalItem(queued.confirmed);
      finishQueue(publicId);
      notify(friendlyErrorMessage(error, "Quantity was not saved"), {
        label: "Retry",
        action: async () => {
          setPendingItems((current) => new Set(current).add(publicId));
          try {
            const updated = await api.adjust(retryBase, retryDelta);
            applyLocalItem(updated);
            notify(`${updated.name}: quantity updated`);
            scheduleInventoryRefresh();
          } finally {
            setPendingItems((current) => {
              const next = new Set(current);
              next.delete(publicId);
              return next;
            });
          }
        },
      });
    }
  }

  async function quickAdjust(item: Item, delta: number) {
    const displayed = itemsRef.current.find((entry) => entry.public_id === item.public_id) || item;
    if (delta < 0 && Number(displayed.quantity) <= 0) return;
    const queued = adjustmentQueue.current.get(item.public_id) || {
      confirmed: displayed,
      inFlight: false,
      pendingDelta: 0,
      timer: null,
    };
    if (!adjustmentQueue.current.has(item.public_id)) {
      adjustmentQueue.current.set(item.public_id, queued);
    }
    queued.pendingDelta += delta;
    const optimistic = optimisticQuantity(displayed, delta);
    applyLocalItem(optimistic);
    setPendingItems((current) => new Set(current).add(item.public_id));
    if (queued.timer !== null) window.clearTimeout(queued.timer);
    queued.timer = window.setTimeout(() => {
      queued.timer = null;
      void flushAdjustment(item.public_id);
    }, 120);
  }

  async function moveItemFast(item: Item, destinationPublicId: string) {
    const destination = flattenLocations(locations).find((entry) => entry.public_id === destinationPublicId);
    const optimistic = {
      ...item,
      location_name: destination?.name || item.location_name,
      location_path: destination?.path || item.location_path,
      location_public_id: destinationPublicId,
      version: item.version + 1,
    };
    applyLocalItem(optimistic);
    try {
      const updated = await api.move(item, destinationPublicId);
      applyLocalItem(updated);
      notify(`${updated.name} moved`, {
        label: "Undo",
        action: async () => {
          const current = await api.item(updated.public_id);
          const restored = await api.move(current, item.location_public_id);
          applyLocalItem(restored);
          scheduleInventoryRefresh();
          notify(`${restored.name} moved back`);
        },
      });
      scheduleInventoryRefresh();
    } catch (error) {
      applyLocalItem(item);
      notify(friendlyErrorMessage(error, "Move failed"), {
        label: "Retry",
        action: async () => moveItemFast(item, destinationPublicId),
      });
    }
  }

  async function addLowStockToShopping(item: Item) {
    try {
      await api.addShopping(item.name, restockQuantity(item), item.unit, item.public_id);
      notify(`${item.name} added to shopping list`);
      scheduleInventoryRefresh();
    } catch (error) {
      notify(friendlyErrorMessage(error, "Could not add shopping item"), {
        label: "Retry",
        action: async () => addLowStockToShopping(item),
      });
    }
  }

  async function setItemLost(item: Item, lost: boolean) {
    setBusy(true);
    try {
      const updated = await api.setTags(item, lost ? withLostTag(item) : withoutLostTag(item));
      applyLocalItem(updated);
      notify(lost ? `${updated.name} marked lost` : `${updated.name} found`);
      scheduleInventoryRefresh();
    } catch (error) {
      notify(friendlyErrorMessage(error, "Could not update lost status"), {
        label: "Retry",
        action: async () => setItemLost(item, lost),
      });
    } finally {
      setBusy(false);
    }
  }

  async function foreverLost(item: Item) {
    if (!window.confirm(`${item.name} is forever lost? It will be archived, hidden from regular search, and kept in history.`)) return;
    setBusy(true);
    try {
      await api.archive(item);
      setItems((current) => current.filter((entry) => entry.public_id !== item.public_id));
      setSelectedItem((current) => current?.public_id === item.public_id ? null : current);
      notify(`${item.name} moved to forever lost`, {
        label: "Undo",
        action: async () => {
          const restored = await api.restoreItem(item.public_id);
          applyLocalItem(restored);
          scheduleInventoryRefresh();
          notify(`${restored.name} restored`);
        },
      });
      scheduleInventoryRefresh();
    } catch (error) {
      notify(friendlyErrorMessage(error, "Could not mark item forever lost"), {
        label: "Retry",
        action: async () => foreverLost(item),
      });
    } finally {
      setBusy(false);
    }
  }

  async function hardDeleteItem(item: Item) {
    if (!window.confirm(`Archive ${item.name}? It will disappear from the inventory, and you can undo this action.`)) return;
    setBusy(true);
    setActivityMessage(`Archiving ${item.name}…`);
    try {
      await api.archive(item);
      setItems((current) => current.filter((entry) => entry.public_id !== item.public_id));
      setSelectedItem((current) => current?.public_id === item.public_id ? null : current);
      notify(`${item.name} archived`, {
        label: "Undo",
        action: async () => {
          const restored = await api.restoreItem(item.public_id);
          applyLocalItem(restored);
          scheduleInventoryRefresh();
          notify(`${restored.name} restored`);
        },
      });
      scheduleInventoryRefresh();
    } catch (error) {
      notify(friendlyErrorMessage(error, "Could not delete item"), {
        label: "Retry",
        action: async () => hardDeleteItem(item),
      });
    } finally {
      setBusy(false);
      setActivityMessage("");
    }
  }

  async function createItemFast(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const item = await api.createItem(body);
      setItems((current) => [item, ...current.filter((entry) => entry.public_id !== item.public_id)]);
      notify(`${item.name} added`);
      setInventoryFilter("all");
      setInventoryCategoryId(item.category_id);
      navigate("inventory");
      scheduleInventoryRefresh();
    } catch (error) {
      notify(friendlyErrorMessage(error, "Could not add item"), {
        label: "Retry",
        action: async () => createItemFast(body),
      });
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function createScannedItem(body: Record<string, unknown>, imageUrl?: string, photoFile?: File) {
    setBusy(true);
    try {
      const tags = Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : [];
      const itemBody = { ...body };
      delete itemBody.tags;
      let item = await api.createItem(itemBody);
      if (tags.length) item = await api.setTags(item, tags);
      if (imageUrl) await api.importPhotoFromUrl(item, imageUrl);
      if (photoFile) {
        const resized = await resizePhoto(photoFile);
        await api.uploadPhoto(item, resized.blob, resized.width, resized.height);
        item = await api.item(item.public_id);
      }
      if (item.barcode) {
        try {
          await api.queueEnrichment(item);
          await api.runEnrichment();
          const enrichment = await api.enrichment(item);
          for (const candidate of enrichment.candidates.filter((entry) => entry.status === "proposed" && Object.keys(entry.proposed).length > 0)) {
            item = await api.applyEnrichment(candidate.public_id);
          }
        } catch {
          // Barcode enrichment is best effort; keep the scanned item save fast and reliable.
        }
      }
      setItems((current) => [item, ...current.filter((entry) => entry.public_id !== item.public_id)]);
      notify(imageUrl || photoFile ? `${item.name} added with image` : `${item.name} added`);
      scheduleInventoryRefresh();
      return item;
    } catch (error) {
      notify(friendlyErrorMessage(error, "Could not add scanned item"), {
        label: "Retry",
        action: async () => { await createScannedItem(body, imageUrl, photoFile); },
      });
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function createCategoryFast(name: string, parentId: number | null): Promise<Category> {
    const category = await api.createCategory(name, parentId);
    setCategories((current) => [...current.filter((entry) => entry.id !== category.id), category]);
    scheduleRefresh();
    return category;
  }

  async function signIn(username: string, password: string) {
    await api.login(username, password);
    const snapshot = await api.bootstrap("", undefined, inventoryIncludeZero);
    applyBootstrap(snapshot);
    setNotice("");
  }

  if (auth === null) {
    return <div className="splash"><div className="item-icon">F</div><h1>Findstuff</h1><p>{notice || "Opening your inventory…"}</p></div>;
  }
  if (!auth.authenticated) {
    return <LoginView onLogin={signIn} />;
  }

  const navView = view === "location" || view === "locations" || view === "category" || view === "categories"
    ? "places"
    : view === "add" || view === "scan" ? "capture" : view === "off-category-mappings" ? "manage" : view;
  return (
    <div className="app-shell">
      {busy && <div className="activity-banner" role="status" aria-live="polite"><span className="activity-spinner" aria-hidden="true" /><strong>{activityMessage || "Saving changes…"}</strong></div>}

      {notice && <div className={`toast ${retryNotice?.message === notice ? "has-action" : ""}`} role="status"><span className="toast-check"><Icon name="spark" size={16} /></span><p>{notice}</p>{retryNotice?.message === notice && <button className="toast-action" onClick={() => { const pendingAction = retryNotice; setRetryNotice(null); notify(`${pendingAction.label} in progress…`); void pendingAction.action().catch((error) => notify(friendlyErrorMessage(error, `${pendingAction.label} failed`))); }}>{retryNotice.label}</button>}<button onClick={() => { setNotice(""); setRetryNotice(null); }} aria-label="Dismiss message"><Icon name="close" size={16} /></button></div>}

      <main className="page-content">
        {view === "inventory" && (
          <div className={`inventory-desktop-layout ${selectedItem ? "has-detail" : ""}`}>
          <InventoryView
            items={items}
            locations={locations}
            categories={categories}
            totalItemCount={dashboard?.item_count ?? items.length}
            detailsTotalCount={dashboard?.needs_details_count ?? items.filter(itemNeedsDetails).length}
            query={query}
            setQuery={setQuery}
            onSearch={searchInventory}
            run={run}
            busy={busy}
            isSearchBusy={inventorySearchBusy}
            onOpen={setSelectedItem}
            onBulkStart={() => setSelectedItem(null)}
            onAdd={() => openCapture("quick")}
            onQuickAdjust={quickAdjust}
            onAddShopping={addLowStockToShopping}
            onDeleteItem={hardDeleteItem}
            includeZero={inventoryIncludeZero}
            onIncludeZeroChange={setInventoryIncludeZero}
            initialFilter={inventoryFilter}
            initialCategoryId={inventoryCategoryId}
            initialTag={inventoryTag}
            pendingItems={pendingItems}
          />
          {selectedItem && <div className="inventory-detail-pane"><ItemDetail
            key={selectedItem.public_id}
            embedded
            item={selectedItem}
            allItems={items}
            locations={locations}
            categories={categories}
            units={units}
            busy={busy}
            onClose={() => setSelectedItem(null)}
            onChanged={async (item) => { applyLocalItem(item); scheduleInventoryRefresh(); }}
            onQuickAdjust={quickAdjust}
            onQuickMove={moveItemFast}
            onAddShopping={addLowStockToShopping}
            onMarkLost={(item) => setItemLost(item, true)}
            onMarkFound={(item) => setItemLost(item, false)}
            onForeverLost={foreverLost}
            onDeleteItem={hardDeleteItem}
            onOpenLocation={(id) => { setSelectedLocationId(id); setSelectedItem(null); navigate("location"); }}
            onOpenTag={(tag) => { setInventoryTag(tag); setInventoryCategoryId(null); setInventoryFilter("all"); setQuery(""); searchInventory("", { showBusy: false }); setSelectedItem(null); navigate("inventory"); }}
            run={run}
          /></div>}
          </div>
        )}
        {(view === "capture" || view === "add" || view === "scan") && (
          <ScanView
            items={items}
            locations={locations}
            categories={categories}
            units={units}
            busy={busy}
            initialMode={view === "add" ? "quick" : view === "scan" ? "scan" : captureMode}
            initialLocation={addLocation}
            onOpenItem={(id) => api.item(id).then(setSelectedItem)}
            onUseLocation={(id) => { setSelectedLocationId(id); navigate("location"); }}
            onCreateLocation={(body) => api.createLocation(body)}
            onCreateCategory={createCategoryFast}
            onAdjust={quickAdjust}
            onCreate={createScannedItem}
            onInventoryChanged={() => refresh(undefined, { showBusy: false })}
          />
        )}
        {view === "places" && (
          <PlacesView
            section={placesSection}
            onSectionChange={setPlacesSection}
            locations={locations}
            categories={categories}
            locationTypes={locationTypes}
            selectedLocationId={selectedLocationId}
            busy={busy}
            onSelectLocation={setSelectedLocationId}
            onOpenItem={setSelectedItem}
            onCaptureHere={(id, mode = "quick") => openCapture(mode, id)}
            onCreateLocation={(body) => run(() => api.createLocation(body), "Place created", "all")}
            onUpdateLocation={(id, body) => run(() => api.updateLocation(id, body), "Place updated", "all")}
            onDeleteLocation={(id) => run(() => api.deleteLocation(id), "Place deleted", "all")}
            onDeleteLocationTree={(id) => run(() => api.deleteLocationTree(id), "Place group deleted", "all")}
            onCreateType={(name) => run(() => api.createLocationType(name), "Place type added", "all")}
            onOpenCategory={(id) => { setSelectedCategoryId(id); navigate("category"); }}
            onCreateCategory={(name, parentId) => run(() => api.createCategory(name, parentId), "Category created", "all")}
            onUpdateCategory={(id, body) => run(() => api.updateCategory(id, body), "Category updated", "all")}
            onDeleteCategory={(id) => run(() => api.deleteCategory(id), "Category deleted", "all")}
            onDeleteCategoryTree={(id) => run(() => api.deleteCategoryTree(id), "Category subtree deleted", "all")}
            onSaveCapabilities={(overrides) => run(() => api.saveCategoryDataSettings(overrides), "Required metadata saved", "all")}
            onSetDefaultLocation={(id, locationId) => run(() => api.setCategoryDefaultLocation(id, locationId), "Default Place saved", "all")}
            onDefaultsChanged={() => refresh(undefined, { showBusy: false })}
          />
        )}
        {view === "locations" && (
          <LocationsView
            locations={locations}
            locationTypes={locationTypes}
            busy={busy}
            onOpen={(id) => { setSelectedLocationId(id); navigate("location"); }}
            onCreate={(body) => run(() => api.createLocation(body), "Place created", "all")}
            onUpdate={(id, body) => run(() => api.updateLocation(id, body), "Place updated", "all")}
            onDelete={(id) => run(() => api.deleteLocation(id), "Place deleted", "all")}
            onDeleteTree={(id) => run(() => api.deleteLocationTree(id), "Place group deleted", "all")}
            onCreateType={(name) => run(() => api.createLocationType(name), "Place type added", "all")}
          />
        )}
        {view === "location" && selectedLocationId && (
          <LocationDetailView
            locationId={selectedLocationId}
            locations={locations}
            categories={categories}
            locationTypes={locationTypes}
            busy={busy}
            onOpenItem={setSelectedItem}
            onOpenLocation={setSelectedLocationId}
            onAddHere={(id) => openCapture("quick", id)}
            onCreateLocationHere={(body) => run(() => api.createLocation(body), "Place created", "all")}
            onDefaultsChanged={() => refresh(undefined, { showBusy: false })}
            onBack={() => { setPlacesSection("locations"); navigate("places"); }}
          />
        )}
        {view === "categories" && (
          <CategoriesView
            categories={categories}
            locations={locations}
            busy={busy}
            onOpen={(id) => { setSelectedCategoryId(id); navigate("category"); }}
            onCreate={(name, parentId) => run(() => api.createCategory(name, parentId), "Category created", "all")}
            onUpdate={(id, body) => run(() => api.updateCategory(id, body), "Category updated", "all")}
            onDelete={(id) => run(() => api.deleteCategory(id), "Category deleted", "all")}
            onDeleteTree={(id) => run(() => api.deleteCategoryTree(id), "Category subtree deleted", "all")}
            onSaveCapabilities={(overrides) => run(() => api.saveCategoryDataSettings(overrides), "Required metadata saved", "all")}
            onSetDefaultLocation={(id, locationId) => run(() => api.setCategoryDefaultLocation(id, locationId), "Default Place saved", "all")}
          />
        )}
        {view === "category" && selectedCategoryId && (
          <CategoryDetailView
            categoryId={selectedCategoryId}
            categories={categories}
            busy={busy}
            onOpenItem={setSelectedItem}
            onOpenCategory={(id) => { setSelectedCategoryId(id); navigate("category"); }}
            onInventory={(id) => { setInventoryCategoryId(id); setInventoryFilter("all"); navigate("inventory"); }}
            onCreateCategoryHere={(name, parentId) => run(() => api.createCategory(name, parentId), "Category created", "all")}
            onBack={() => { setPlacesSection("categories"); navigate("places"); }}
          />
        )}
        {view === "off-category-mappings" && <OffCategoryMappingsView categories={categories} busy={busy} onBack={() => navigate("manage")} onOpenItem={setSelectedItem} onNotice={setNotice} />}
        {view === "dashboard" && <DashboardView dashboard={dashboard} detailsCount={dashboard?.needs_details_count ?? items.filter(itemNeedsDetails).length} connectionIssue={connectionIssue} onRetry={() => void refresh("", { showBusy: true })} onNavigate={navigate} onCapture={openCapture} onGlobalSearch={() => setGlobalSearchOpen(true)} onInventory={(filter) => { setInventoryFilter(filter); setInventoryCategoryId(null); navigate("inventory"); }} onNotice={setNotice} />}
        {view === "manage" && (
          <ManageView items={items} dashboard={dashboard} locations={locations} categories={categories} locationTypes={locationTypes} units={units} busy={busy} theme={theme} setNotice={setNotice} notify={notify} onThemeChange={setTheme} onInventoryChanged={() => refresh()} onLocations={() => { setPlacesSection("locations"); navigate("places"); }} onCategories={() => { setPlacesSection("categories"); navigate("places"); }} onOffCategoryMappings={() => navigate("off-category-mappings")} onOpenItem={setSelectedItem} onMarkFound={(item) => setItemLost(item, false)} onForeverLost={foreverLost} onUnitsChanged={setUnits} onCreateType={(name) => run(() => api.createLocationType(name), "Place type added", "all")} />
        )}
        {selectedItem && view !== "inventory" && (
          <ItemDetail
            item={selectedItem}
            allItems={items}
            locations={locations}
            categories={categories}
            units={units}
            busy={busy}
            onClose={() => setSelectedItem(null)}
            onChanged={async (item) => { applyLocalItem(item); scheduleInventoryRefresh(); }}
            onQuickAdjust={quickAdjust}
            onQuickMove={moveItemFast}
            onAddShopping={addLowStockToShopping}
            onMarkLost={(item) => setItemLost(item, true)}
            onMarkFound={(item) => setItemLost(item, false)}
            onForeverLost={foreverLost}
            onDeleteItem={hardDeleteItem}
            onOpenLocation={(id) => { setSelectedLocationId(id); setSelectedItem(null); navigate("location"); }}
            onOpenTag={(tag) => { setInventoryTag(tag); setInventoryCategoryId(null); setInventoryFilter("all"); setQuery(""); searchInventory("", { showBusy: false }); setSelectedItem(null); navigate("inventory"); }}
            run={run}
          />
        )}
        {globalSearchOpen && <GlobalSearch items={items} locations={locations} categories={categories} onClose={() => setGlobalSearchOpen(false)} onOpenItem={(item) => { setGlobalSearchOpen(false); setSelectedItem(item); }} onOpenLocation={(id) => { setGlobalSearchOpen(false); setSelectedLocationId(id); setPlacesSection("locations"); navigate("places"); }} onOpenCategory={(id) => { setGlobalSearchOpen(false); setSelectedCategoryId(id); navigate("category"); }} onNavigate={(next) => { setGlobalSearchOpen(false); navigate(next); }} onCapture={(mode) => { setGlobalSearchOpen(false); openCapture(mode); }} />}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        {nav.map((entry) => (
          <button
            type="button"
            key={entry.id}
            className={`${navView === entry.id ? "active" : ""} ${entry.id === "capture" ? "add-tab" : ""}`}
            onClick={() => navigate(entry.id)}
            aria-current={navView === entry.id ? "page" : undefined}
          >
            <span className="nav-icon"><Icon name={entry.icon} size={22} /></span><span>{entry.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function LoginView({
  onLogin,
}: {
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onLogin(username.trim(), password);
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Could not sign in",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark" aria-hidden="true">F</div>
        <p className="eyebrow">PRIVATE INVENTORY</p>
        <h1>Welcome to Findstuff</h1>
        <p>Sign in once on this device. Your secure session stays available to the installed app for 90 days.</p>
        <form className="form-card compact-form" onSubmit={submit}>
          <label>Username<input required autoCapitalize="none" autoCorrect="off" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label>Password<input required autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="primary wide" disabled={submitting || !username.trim() || !password}>{submitting ? "Signing in…" : "Sign in"}</button>
        </form>
        <small>The password stays on this device and is sent only to your Findstuff server. Use the private HTTPS address when signing in from a phone.</small>
      </section>
    </main>
  );
}

function InventoryView({
  items,
  locations,
  categories,
  totalItemCount,
  detailsTotalCount,
  query,
  setQuery,
  onSearch,
  run,
  busy,
  isSearchBusy,
  onOpen,
  onBulkStart,
  onAdd,
  onQuickAdjust,
  onAddShopping,
  onDeleteItem,
  includeZero,
  onIncludeZeroChange,
  initialFilter,
  initialCategoryId,
  initialTag,
  pendingItems,
}: {
  items: Item[];
  locations: LocationNode[];
  categories: Category[];
  totalItemCount: number;
  detailsTotalCount: number;
  query: string;
  setQuery: (value: string) => void;
  onSearch: (query: string, options?: InventorySearchOptions) => void;
  run: (action: () => Promise<unknown>, success: string, scope?: RefreshScope, options?: ActionOptions) => Promise<void>;
  busy: boolean;
  isSearchBusy: boolean;
  onOpen: (item: Item) => void;
  onBulkStart: () => void;
  onAdd: () => void;
  onQuickAdjust: (item: Item, delta: number) => Promise<void>;
  onAddShopping: (item: Item) => Promise<void>;
  onDeleteItem: (item: Item) => Promise<void>;
  includeZero: boolean;
  onIncludeZeroChange: (value: boolean) => void;
  initialFilter: InventoryFilter;
  initialCategoryId: number | null;
  initialTag: string;
  pendingItems: Set<string>;
}) {
  const initialPrefs = useMemo(loadInventoryPrefs, []);
  const [filter, setFilter] = useState<InventoryFilter>(initialFilter);
  const [groupBy, setGroupBy] = useState<InventoryGroup>(initialPrefs.groupBy);
  const [sortBy, setSortBy] = useState<InventorySort>(initialPrefs.sortBy);
  const [tagFilter, setTagFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [filterPicker, setFilterPicker] = useState<"category" | "tag" | "location" | null>(null);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [formula, setFormula] = useState<InventoryFormula>(emptyInventoryFormula);
  const [savedViews, setSavedViews] = useState<SavedInventoryView[]>(loadSavedInventoryViews);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelection, setBulkSelection] = useState<Set<string>>(() => new Set());
  const [bulkPicker, setBulkPicker] = useState<"category" | "location" | "remove-tag" | null>(null);
  const [renderLimit, setRenderLimit] = useState(INITIAL_RESULT_WINDOW);
  const deferredQuery = useDeferredValue(query);
  const lastBackgroundSearch = useRef(query.trim());
  useEffect(() => setFilter(initialFilter), [initialFilter]);
  useEffect(() => {
    if (initialCategoryId !== null) setCategoryFilter(String(initialCategoryId));
  }, [initialCategoryId]);
  useEffect(() => setTagFilter(initialTag), [initialTag]);
  useEffect(() => {
    if (categoryFilter && !categories.some((category) => String(category.id) === categoryFilter)) {
      setCategoryFilter("");
    }
  }, [categories, categoryFilter]);
  useEffect(() => {
    saveInventoryPrefs({ groupBy, sortBy });
  }, [groupBy, sortBy]);
  useEffect(() => {
    const trimmed = query.trim();
    const nextSearch = trimmed.length >= 2 ? trimmed : "";
    if (lastBackgroundSearch.current === nextSearch) return;
    const timeout = window.setTimeout(() => {
      lastBackgroundSearch.current = nextSearch;
      onSearch(nextSearch, { showBusy: false });
    }, nextSearch ? 420 : 260);
    return () => window.clearTimeout(timeout);
  }, [onSearch, query]);
  const indexedItems = useMemo(() => items.map((item) => ({
    item,
    expiration: expirationTime(item),
    expiring: expirationState(item) !== null,
    lowStock: isLowStock(item),
    needsDetails: itemNeedsDetails(item),
    quantity: Number(item.quantity),
    searchText: [
      item.name,
      item.description,
      item.notes,
      item.brand,
      item.model,
      item.serial_number,
      item.category_name,
      item.category_path,
      item.location_path,
      item.barcode,
      ...item.tags,
    ].filter(Boolean).join(" ").toLowerCase(),
    updated: new Date(item.updated_at).getTime(),
  })), [items]);
  const lowStockCount = useMemo(() => indexedItems.filter((entry) => entry.lowStock).length, [indexedItems]);
  const expiringCount = useMemo(() => indexedItems.filter((entry) => entry.expiring).length, [indexedItems]);
  const detailsCount = useMemo(() => indexedItems.filter((entry) => entry.needsDetails).length, [indexedItems]);
  const displayedDetailsCount = Math.max(detailsCount, detailsTotalCount);
  const allCount = Math.max(items.length, totalItemCount);
  const tags = useMemo(() => Array.from(new Set(indexedItems.flatMap(({ item }) => item.tags))).sort((a, b) => a.localeCompare(b)), [indexedItems]);
  const selectedCategory = useMemo(() => (
    categoryFilter ? categories.find((category) => String(category.id) === categoryFilter) || null : null
  ), [categories, categoryFilter]);
  const flatInventoryLocations = useMemo(() => flattenLocations(locations), [locations]);
  const selectedLocation = useMemo(() => (
    locationFilter ? flatInventoryLocations.find((location) => location.public_id === locationFilter) || null : null
  ), [flatInventoryLocations, locationFilter]);
  useEffect(() => {
    if (locationFilter && !selectedLocation) setLocationFilter("");
  }, [locationFilter, selectedLocation]);
  const selectedCategoryIds = useMemo(() => (
    categoryFilter ? categoryDescendantIds(categories, Number(categoryFilter)) : null
  ), [categories, categoryFilter]);
  const searchTerm = deferredQuery.trim().toLowerCase();
  const formulaValidation = useMemo(() => validateInventoryFormula(formula.source), [formula.source]);
  const hasScope = Boolean(
    searchTerm || filter !== "all" || tagFilter || categoryFilter || locationFilter || groupBy !== "none" || sortBy !== "updated" || formula.source.trim(),
  );
  useEffect(() => {
    setRenderLimit(INITIAL_RESULT_WINDOW);
  }, [categoryFilter, filter, formula, groupBy, items.length, locationFilter, searchTerm, sortBy, tagFilter]);
  const filteredEntries = useMemo(() => indexedItems.filter((entry) => {
    const { item } = entry;
    if (filter === "low" && !entry.lowStock) return false;
    if (filter === "expiring" && !entry.expiring) return false;
    if (filter === "details" && !entry.needsDetails) return false;
    if (tagFilter && !item.tags.includes(tagFilter)) return false;
    if (selectedLocation && item.location_public_id !== selectedLocation.public_id && !item.location_path.startsWith(`${selectedLocation.path} > `)) return false;
    if (selectedCategoryIds && (item.category_id === null || !selectedCategoryIds.has(item.category_id))) {
      return false;
    }
    if (searchTerm && !entry.searchText.includes(searchTerm)) return false;
    if (formula.source.trim() && (!formulaValidation.node || !inventoryFormulaMatches(item, formulaValidation.node))) return false;
    return true;
  }), [filter, formula.source, formulaValidation.node, indexedItems, searchTerm, selectedCategoryIds, selectedLocation, tagFilter]);
  const sortedEntries = useMemo(() => {
    const sorted = [...filteredEntries];
    sorted.sort((left, right) => {
      if (sortBy === "name") return left.item.name.localeCompare(right.item.name);
      if (sortBy === "location") return left.item.location_path.localeCompare(right.item.location_path) || left.item.name.localeCompare(right.item.name);
      if (sortBy === "quantity-asc") return left.quantity - right.quantity || left.item.name.localeCompare(right.item.name);
      if (sortBy === "quantity-desc") return right.quantity - left.quantity || left.item.name.localeCompare(right.item.name);
      if (sortBy === "expiration") return left.expiration - right.expiration || left.item.name.localeCompare(right.item.name);
      return right.updated - left.updated;
    });
    return sorted;
  }, [filteredEntries, sortBy]);
  const visibleItems = useMemo(() => sortedEntries.slice(0, renderLimit).map((entry) => entry.item), [renderLimit, sortedEntries]);
  const hiddenResultCount = Math.max(0, sortedEntries.length - visibleItems.length);
  const showingSearchPlaceholder = isSearchBusy && query.trim().length > 0;
  const groupedItems = useMemo(() => {
    const groups = new Map<string, Item[]>();
    for (const item of visibleItems) {
      const keys = groupBy === "tag" && item.tags.length > 0 ? item.tags : [groupLabel(item, groupBy)];
      for (const key of keys) {
        const label = key || "Other";
        groups.set(label, [...(groups.get(label) || []), item]);
      }
    }
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [groupBy, visibleItems]);
  function requestSearch(value: string, options: InventorySearchOptions = {}) {
    const nextSearch = value.trim();
    lastBackgroundSearch.current = nextSearch.length >= 2 ? nextSearch : "";
    onSearch(value, options);
  }
  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextQuery = String(formData.get("inventory-search") || "");
    setQuery(nextQuery);
    requestSearch(nextQuery, { showBusy: true });
  }
  function clearAllScope() {
    setFilter("all");
    setGroupBy("none");
    setSortBy("updated");
    setTagFilter("");
    setCategoryFilter("");
    setLocationFilter("");
    setFormula(emptyInventoryFormula());
    onIncludeZeroChange(false);
    setQuery("");
    requestSearch("", { showBusy: true });
  }
  function toggleBulkItem(publicId: string) {
    setBulkSelection((current) => {
      const next = new Set(current);
      if (next.has(publicId)) next.delete(publicId); else next.add(publicId);
      return next;
    });
  }
  function leaveBulkMode() {
    setBulkMode(false);
    setBulkSelection(new Set());
    setBulkPicker(null);
  }
  async function performBulk(
    label: string,
    action: (item: Item) => Promise<unknown>,
    undo?: (current: Item, original: Item) => Promise<unknown>,
  ) {
    const selected = items.filter((item) => bulkSelection.has(item.public_id));
    if (!selected.length) return;
    await run(async () => {
      for (const item of selected) await action(item);
    }, `${label}: ${selected.length} item${selected.length === 1 ? "" : "s"}`, "inventory", {
      progress: `${label} ${selected.length} item${selected.length === 1 ? "" : "s"}…`,
      undo: undo ? async () => {
        for (const original of selected) {
          const current = await api.item(original.public_id);
          await undo(current, original);
        }
      } : undefined,
    });
    leaveBulkMode();
  }
  function saveCurrentView(name: string, nextFormula: InventoryFormula) {
    if (!name.trim()) return;
    const next: SavedInventoryView = {
      id: uid("view"), name: name.trim(), formula: cloneFormula(nextFormula), query, filter, groupBy, sortBy,
      categoryFilter, locationFilter, tagFilter, includeZero,
    };
    setSavedViews((current) => {
      const updated = [...current, next];
      saveSavedInventoryViews(updated);
      return updated;
    });
  }
  function applySavedView(saved: SavedInventoryView) {
    setFormula(cloneFormula(saved.formula));
    setQuery(saved.query);
    setFilter(saved.filter);
    setGroupBy(saved.groupBy);
    setSortBy(saved.sortBy);
    setCategoryFilter(saved.categoryFilter);
    setLocationFilter(saved.locationFilter);
    setTagFilter(saved.tagFilter);
    onIncludeZeroChange(saved.includeZero);
    requestSearch(saved.query, { showBusy: true });
  }
  function deleteSavedView(id: string) {
    setSavedViews((current) => {
      const updated = current.filter((view) => view.id !== id);
      saveSavedInventoryViews(updated);
      return updated;
    });
  }
  function exportBulkSelection() {
    const selected = items.filter((item) => bulkSelection.has(item.public_id));
    const cell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["Name", "Brand", "Quantity", "Unit", "Category", "Location", "Tags", "Barcode", "Expiration"],
      ...selected.map((item) => [item.name, item.brand, item.quantity, item.unit, item.category_path || "", item.location_path, item.tags.join(", "), item.barcode, item.expiration_date || ""]),
    ];
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.map(cell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `findstuff-selection-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="inventory-page">
      <div className="search-hero">
        <form className="search search-large" onSubmit={submitSearch}>
          <Icon name="search" size={21} />
          <input
            type="search"
            name="inventory-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ESP32, pasta, drill…"
            aria-label="Search inventory"
          />
          {query && <button type="button" className="clear-search" onClick={() => { setQuery(""); requestSearch("", { showBusy: true }); }} aria-label="Clear search"><Icon name="close" size={17} /></button>}
          <button type="submit" className="primary search-submit" aria-busy={busy}>Find</button>
        </form>
      </div>
      <div className="inventory-command-row">
        <div className="saved-view-strip" aria-label="Saved inventory views">
          <span>Views</span>
          {savedViews.map((saved) => <div className="saved-view-chip" key={saved.id}><button type="button" onClick={() => applySavedView(saved)}>{saved.name}</button><button type="button" onClick={() => deleteSavedView(saved.id)} aria-label={`Delete ${saved.name}`}><Icon name="close" size={13} /></button></div>)}
          {savedViews.length === 0 && <small>Save a formula and its layout</small>}
        </div>
        <div className="inventory-mode-actions">
          <button type="button" className={formula.source.trim() ? "active" : ""} onClick={() => setFormulaOpen(true)}><Icon name="filter" size={16} />Formula</button>
          <button type="button" className="clear-inventory-filters" onClick={clearAllScope} disabled={!hasScope && !includeZero}><Icon name="close" size={16} />Clear all</button>
          <button type="button" className={bulkMode ? "active" : ""} onClick={() => { if (bulkMode) leaveBulkMode(); else { onBulkStart(); setBulkMode(true); } }}><Icon name={bulkMode ? "close" : "check"} size={16} />{bulkMode ? "Exit bulk" : "Bulk mode"}</button>
        </div>
      </div>
      {bulkMode && <div className="bulk-mode-banner" role="status"><span><Icon name="check" size={18} /><strong>Bulk action mode</strong><small>Items select instead of opening.</small></span><button type="button" onClick={() => setBulkSelection(new Set(visibleItems.map((item) => item.public_id)))}>Select visible</button><button type="button" onClick={() => setBulkSelection(new Set())}>Clear</button></div>}
      <div className="filter-row" role="group" aria-label="Filter inventory">
        <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All <span>{allCount}</span></button>
        <button className={filter === "low" ? "active" : ""} onClick={() => setFilter("low")}>Low stock <span>{lowStockCount}</span></button>
        <button className={filter === "expiring" ? "active" : ""} onClick={() => setFilter("expiring")}>Expiring <span>{expiringCount}</span></button>
        <button className={filter === "details" ? "active" : ""} onClick={() => setFilter("details")}>Needs details <span>{displayedDetailsCount}</span></button>
      </div>
      <div className="view-toolbar compact-inventory-toolbar">
        <label><span>Sort</span><select aria-label="Sort Items" value={sortBy} onChange={(event) => setSortBy(event.target.value as InventorySort)}><option value="updated">Recent</option><option value="name">Name</option><option value="location">Place</option><option value="quantity-asc">Qty ↑</option><option value="quantity-desc">Qty ↓</option><option value="expiration">Expires</option></select></label>
        <label><span>Group</span><select aria-label="Group Items" value={groupBy} onChange={(event) => setGroupBy(event.target.value as InventoryGroup)}><option value="none">None</option><option value="room">Room</option><option value="location">Place</option><option value="category">Category</option><option value="tag">Tag</option><option value="unit">Unit</option></select></label>
        <div className="filter-choice"><span>Category</span><button type="button" onClick={() => setFilterPicker("category")}><Icon name="tag" size={16} /><strong>{selectedCategory ? categoryOptionLabel(selectedCategory) : "Any category"}</strong><Icon name="chevron" size={15} /></button></div>
        <div className="filter-choice"><span>Place</span><button type="button" onClick={() => setFilterPicker("location")}><Icon name="pin" size={16} /><strong>{selectedLocation?.path || "Any Place"}</strong><Icon name="chevron" size={15} /></button></div>
        <div className="filter-choice"><span>Tag</span><button type="button" onClick={() => setFilterPicker("tag")}><Icon name="tag" size={16} /><strong>{tagFilter || "Any tag"}</strong><Icon name="chevron" size={15} /></button></div>
        <label className="toolbar-toggle"><span>Zero qty</span><input type="checkbox" checked={includeZero} onChange={(event) => onIncludeZeroChange(event.target.checked)} /></label>
      </div>
      {hasScope && <div className="active-filter-row" aria-label="Active inventory filters">
        <span><Icon name="filter" size={15} />Showing</span>
        {query.trim() && <button type="button" onClick={() => { setQuery(""); requestSearch("", { showBusy: true }); }}>Search: {query.trim()}</button>}
        {filter !== "all" && <button type="button" onClick={() => setFilter("all")}>{filter === "low" ? "Low stock" : filter === "expiring" ? "Expiring soon" : "Needs details"}</button>}
        {sortBy !== "updated" && <button type="button" onClick={() => setSortBy("updated")}>Sorted by {sortBy.replace("-", " ")}</button>}
        {selectedCategory && <button type="button" onClick={() => setCategoryFilter("")}>{categoryOptionLabel(selectedCategory)} + children</button>}
        {selectedLocation && <button type="button" onClick={() => setLocationFilter("")}>{selectedLocation.path} + inside</button>}
        {tagFilter && <button type="button" onClick={() => setTagFilter("")}>#{tagFilter}</button>}
        {formula.source.trim() && <button type="button" onClick={() => setFormulaOpen(true)}>Formula applied</button>}
        {groupBy !== "none" && <button type="button" onClick={() => setGroupBy("none")}>Grouped by {groupBy}</button>}
      </div>}
      <div className="section-heading">
        <h2>{query ? "Search results" : filter === "all" ? "Everything" : filter === "low" ? "Running low" : filter === "expiring" ? "Use soon" : "Needs details"}</h2>
        <span>{showingSearchPlaceholder ? "Searching..." : `${visibleItems.length === sortedEntries.length ? sortedEntries.length : `${visibleItems.length} of ${sortedEntries.length}`} ${sortedEntries.length === 1 ? "item" : "items"}`}</span>
      </div>
      <div className="item-list">
        {showingSearchPlaceholder ? <div className="empty-inline"><span>Searching Items…</span></div> : visibleItems.length === 0 && <EmptyState icon={hasScope ? "box" : "search"} title={hasScope ? query ? "No matches yet" : "Nothing needs attention" : "No Items yet"} text={hasScope ? query ? "Try a shorter name, a tag, or a Place." : "You’re all caught up." : "Add an Item and it will appear here."} action={items.length === 0 ? { label: "Add first Item", onClick: onAdd } : undefined} />}
        {!showingSearchPlaceholder && (groupBy === "none" ? [["", visibleItems] as [string, Item[]]] : groupedItems).map(([group, groupItems]) => <div className="inventory-group" key={group || "all"}>{group && <h3>{group}<span>{groupItems.length}</span></h3>}{groupItems.map((item) => (
          <article className={`item-card ${expirationState(item) === "expired" || isLowStock(item) ? "needs-attention" : ""} ${pendingItems.has(item.public_id) ? "syncing" : ""} ${bulkMode ? "bulk-selectable" : ""} ${bulkSelection.has(item.public_id) ? "selected" : ""}`} key={item.public_id}>
            <button className="item-main" onClick={() => bulkMode ? toggleBulkItem(item.public_id) : onOpen(item)} aria-pressed={bulkMode ? bulkSelection.has(item.public_id) : undefined}>
              {bulkMode && <span className="bulk-check" aria-hidden="true">{bulkSelection.has(item.public_id) ? <Icon name="check" size={17} /> : null}</span>}
              <div className={`item-icon ${item.primary_photo_url ? "item-photo" : ""}`} aria-hidden="true">{item.primary_photo_url ? <img src={item.primary_photo_url} alt="" loading="lazy" /> : <Icon name="box" size={21} />}</div>
              <div className="item-copy">
                <div className="item-name-line"><h3>{item.name}</h3>{isLowStock(item) && <span className="status-badge warning">Low</span>}{expirationState(item) && <span className={`status-badge ${expirationState(item)}`}>{expirationState(item) === "expired" ? "Expired" : expirationCopy(item)}</span>}{categoryLabel(item) && <span className="status-badge quiet">{categoryLabel(item)}</span>}</div>
                <p className="location-line"><Icon name="pin" size={13} />{item.location_path}</p>
                {(item.brand || item.model) && <p className="muted">{[item.brand, item.model].filter(Boolean).join(" · ")}</p>}
              </div>
              <span className="quantity"><strong>{item.quantity}</strong><small>{item.unit}</small></span>
              <Icon name="chevron" size={17} />
            </button>
            {!bulkMode && <div className={`quick-actions ${isLowStock(item) ? "has-shopping" : ""}`}>
              <button aria-label={`Remove one ${item.name}`} disabled={Number(item.quantity) <= 0} onClick={() => void onQuickAdjust(item, -1)}><Icon name="minus" size={16} /> <span>1</span></button>
              <button aria-label={`Add one ${item.name}`} onClick={() => void onQuickAdjust(item, 1)}><Icon name="plus" size={16} /> <span>1</span></button>
              <button className="move-action" disabled={busy} onClick={() => onOpen(item)}><Icon name="pin" size={15} />Move</button>
              <button className="delete-action" disabled={busy} onClick={() => void onDeleteItem(item)}><Icon name="close" size={15} />Delete</button>
              {isLowStock(item) && <button className="shopping-action" onClick={() => void onAddShopping(item)}><Icon name="plus" size={15} />List {restockQuantity(item)} {item.unit}</button>}
            </div>}
          </article>
        ))}</div>)}
        {!showingSearchPlaceholder && hiddenResultCount > 0 && <button type="button" className="load-more-results" onClick={() => setRenderLimit((current) => current + RESULT_WINDOW_STEP)}>Show {Math.min(RESULT_WINDOW_STEP, hiddenResultCount)} more</button>}
      </div>
      {filterPicker === "category" && <SearchableFilterPicker title="Filter by category" icon="tag" selectedId={categoryFilter} emptyLabel="Any category" options={categories.map((category) => ({ id: String(category.id), label: category.name, detail: `${category.path} · ${category.total_item_count} item${category.total_item_count === 1 ? "" : "s"}` }))} onChoose={setCategoryFilter} onClose={() => setFilterPicker(null)} />}
      {filterPicker === "location" && <SearchableFilterPicker title="Filter by Place" icon="pin" selectedId={locationFilter} emptyLabel="Any Place" options={flatInventoryLocations.map((location) => ({ id: location.public_id, label: location.name, detail: `${location.path} · ${location.total_item_count ?? location.item_count ?? 0} Items inside` }))} onChoose={setLocationFilter} onClose={() => setFilterPicker(null)} />}
      {filterPicker === "tag" && <SearchableFilterPicker title="Filter by tag" icon="tag" selectedId={tagFilter} emptyLabel="Any tag" options={tags.map((tag) => ({ id: tag, label: tag, detail: `${indexedItems.filter(({ item }) => item.tags.includes(tag)).length} matching items` }))} onChoose={setTagFilter} onClose={() => setFilterPicker(null)} />}
      {formulaOpen && <FormulaBuilder formula={formula} categories={categories} locations={flatInventoryLocations} tags={tags} units={Array.from(new Set(items.map((item) => item.unit))).sort()} onApply={(next) => { setFormula(next); setFormulaOpen(false); requestSearch(query, { showBusy: true }); }} onSave={(name, next) => { saveCurrentView(name, next); setFormula(next); setFormulaOpen(false); requestSearch(query, { showBusy: true }); }} onClose={() => setFormulaOpen(false)} />}
      {bulkMode && bulkSelection.size > 0 && <div className="bulk-action-dock" aria-label="Bulk actions"><strong>{bulkSelection.size}<small>selected</small></strong><button type="button" onClick={() => setBulkPicker("location")}><Icon name="pin" size={17} />Move</button><button type="button" onClick={() => setBulkPicker("category")}><Icon name="tag" size={17} />Category</button><button type="button" onClick={() => { const tag = window.prompt("Tag to add to the selected items"); if (tag?.trim()) void performBulk("Tagged", (item) => api.setTags(item, Array.from(new Set([...item.tags, tag.trim()]))), (current, original) => api.setTags(current, original.tags)); }}><Icon name="plus" size={17} />Add tag</button><button type="button" onClick={() => setBulkPicker("remove-tag")}><Icon name="minus" size={17} />Remove tag</button><button type="button" onClick={() => { const value = window.prompt("Quantity adjustment for every selected item (for example: 2 or -1)", "1"); const delta = Number(value?.replace(",", ".")); if (value && Number.isFinite(delta) && delta !== 0) void performBulk("Updated", (item) => api.adjust(item, delta), (current) => api.adjust(current, -delta)); }}><Icon name="plus" size={17} />Quantity</button><button type="button" onClick={exportBulkSelection}><Icon name="more" size={17} />Export</button><button type="button" className="danger" onClick={() => { if (window.confirm(`Archive ${bulkSelection.size} selected items?`)) void performBulk("Archived", api.archive, (_current, original) => api.restoreItem(original.public_id)); }}><Icon name="close" size={17} />Archive</button></div>}
      {bulkPicker === "location" && <SearchableFilterPicker title="Move selected Items" icon="pin" selectedId="" emptyLabel="Cancel" options={flatInventoryLocations.map((location) => ({ id: location.public_id, label: location.name, detail: location.path }))} onChoose={(id) => { if (id) void performBulk("Moved", (item) => api.move(item, id), (current, original) => api.move(current, original.location_public_id)); }} onClose={() => setBulkPicker(null)} />}
      {bulkPicker === "category" && <SearchableFilterPicker title="Change Category" icon="tag" selectedId="" emptyLabel="No Category" options={categories.map((category) => ({ id: String(category.id), label: category.name, detail: category.path }))} onChoose={(id) => { void performBulk("Category updated", (item) => api.updateItem(item, { category_id: id ? Number(id) : null }), (current, original) => api.updateItem(current, { category_id: original.category_id })); }} onClose={() => setBulkPicker(null)} />}
      {bulkPicker === "remove-tag" && <SearchableFilterPicker title="Remove a tag from selected Items" icon="tag" selectedId="" emptyLabel="Cancel" options={Array.from(new Set(items.filter((item) => bulkSelection.has(item.public_id)).flatMap((item) => item.tags))).sort().map((tag) => ({ id: tag, label: tag }))} onChoose={(tag) => { if (tag) void performBulk("Tag removed", (item) => api.setTags(item, item.tags.filter((entry) => entry !== tag)), (current, original) => api.setTags(current, original.tags)); }} onClose={() => setBulkPicker(null)} />}
    </section>
  );
}

type SearchableFilterOption = { id: string; label: string; detail?: string };

function SearchableFilterPicker({ title, icon, options, selectedId, emptyLabel, onChoose, onClose }: {
  title: string;
  icon: IconName;
  options: SearchableFilterOption[];
  selectedId: string;
  emptyLabel: string;
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const visibleOptions = useMemo(() => options.filter((option) => (
    !deferredQuery || `${option.label} ${option.detail || ""}`.toLocaleLowerCase().includes(deferredQuery)
  )).slice(0, deferredQuery ? 120 : 60), [deferredQuery, options]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  function choose(id: string) {
    onChoose(id);
    onClose();
  }
  return <div className="modal-backdrop picker-backdrop searchable-filter-backdrop" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><article className="picker-sheet searchable-filter-sheet"><header><button type="button" className="icon-button" onClick={onClose} aria-label="Close filter"><Icon name="close" size={17} /></button><div><p className="eyebrow">INVENTORY FILTER</p><h2>{title}</h2></div></header><label className="searchable-filter-input"><Icon name="search" size={19} /><input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${title.replace("Filter by ", "")}…`} aria-label={title} />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear filter search"><Icon name="close" size={15} /></button>}</label><div className="searchable-filter-results"><button type="button" className={!selectedId ? "selected" : ""} onClick={() => choose("")}><span className="searchable-filter-icon"><Icon name={icon} size={17} /></span><span><strong>{emptyLabel}</strong><small>Clear this filter</small></span>{!selectedId && <Icon name="check" size={17} />}</button>{visibleOptions.map((option) => <button type="button" className={selectedId === option.id ? "selected" : ""} key={option.id} onClick={() => choose(option.id)}><span className="searchable-filter-icon"><Icon name={icon} size={17} /></span><span><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</span>{selectedId === option.id && <Icon name="check" size={17} />}</button>)}{visibleOptions.length === 0 && <div className="empty-inline"><span>No matching options</span></div>}</div></article></div>;
}

function formulaGuideMarkdown(categories: Category[], locations: LocationNode[], tags: string[], units: string[]): string {
  const values = (entries: string[]) => entries.length ? entries.map((entry) => `- \`${entry.replaceAll("`", "\\`")}\``).join("\n") : "- No values currently exist.";
  return `# Findstuff inventory formula language

Use this language in **Inventory → Formula**. Keywords are case-insensitive. Text comparisons are also case-insensitive.

## Fields

| Field | Meaning | Value type |
|---|---|---|
| \`name\` | Item name | text |
| \`brand\` | Brand | text |
| \`model\` | Model | text |
| \`serial\` | Serial number | text |
| \`description\` | Description | text |
| \`notes\` | Notes | text |
| \`category\` | Full category path | text |
| \`location\` | Full location path | text |
| \`tag\` or \`tags\` | Any tag on the item | text/list |
| \`quantity\` or \`qty\` | Current quantity | number |
| \`unit\` | Quantity unit | text |
| \`value\` or \`price\` | Estimated price, falling back to purchase price | number |
| \`weight\` | Weight in grams | number |
| \`length\`, \`width\`, \`height\` | Dimensions in millimetres | number |
| \`expiration\` or \`expires\` | Expiration date | YYYY-MM-DD |
| \`barcode\` | Barcode text | text |
| \`updated\` | Last update date | YYYY-MM-DD |
| \`low_stock\` | Whether the item is low stock | true/false |
| \`has_photo\` | Whether the item has a photo | true/false |
| \`missing_location\` | Whether the item is unassigned | true/false |

## Operators

- Equality: \`=\`, \`==\`, \`!=\`
- Numeric comparisons: \`>\`, \`>=\`, \`<\`, \`<=\`
- Text matching: \`CONTAINS\`, \`NOT CONTAINS\`
- Multiple choices: \`IN ["choice 1", "choice 2"]\`, \`NOT IN [...]\`
- Dates: \`BEFORE YYYY-MM-DD\`, \`AFTER YYYY-MM-DD\`
- Missing values: \`IS EMPTY\`, \`IS NOT EMPTY\`
- Logic: \`AND\`, \`OR\`, \`NOT\`
- Use parentheses to control precedence. \`NOT\` runs first, then \`AND\`, then \`OR\`.

Quote text containing spaces, commas, or parentheses. Both single and double quotes are accepted.

## Examples

\`category IN ["Food & Groceries", "Electronics"]\`

\`quantity <= 2 AND unit = "pcs"\`

\`(tag = "urgent" OR tag = "restock") AND location CONTAINS "Garage"\`

\`expiration BEFORE 2026-12-31 AND expiration IS NOT EMPTY\`

\`value >= 50 AND brand NOT CONTAINS "generic"\`

\`NOT (category CONTAINS "Food" OR tag = "consumable")\`

## Current category paths

${values(categories.map((entry) => entry.path))}

## Current location paths

${values(locations.map((entry) => entry.path))}

## Current tags

${values(tags)}

## Current units

${values(units)}

## Instructions for an AI

Return only one Findstuff formula, without a Markdown code fence or explanation. Use only the fields and operators documented above. Quote text values and add parentheses whenever AND and OR are mixed.
`;
}

function FormulaBuilder({ formula, categories, locations, tags, units, onApply, onSave, onClose }: {
  formula: InventoryFormula;
  categories: Category[];
  locations: LocationNode[];
  tags: string[];
  units: string[];
  onApply: (formula: InventoryFormula) => void;
  onSave: (name: string, formula: InventoryFormula) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState(formula.source);
  const [viewName, setViewName] = useState("");
  const validation = useMemo(() => validateInventoryFormula(source), [source]);
  const valid = !validation.error;
  function exportGuide() {
    const url = URL.createObjectURL(new Blob([formulaGuideMarkdown(categories, locations, tags, units)], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "findstuff-formula-language.md";
    link.click();
    URL.revokeObjectURL(url);
  }
  return <div className="modal-backdrop picker-backdrop formula-backdrop" role="dialog" aria-modal="true" aria-label="Advanced inventory formula" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <article className="picker-sheet formula-sheet text-formula-sheet">
      <header><button type="button" className="icon-button" onClick={onClose} aria-label="Close formula"><Icon name="close" size={17} /></button><div><p className="eyebrow">ADVANCED FILTER</p><h2>Formula editor</h2><small>Type a formula directly. It is checked before it can be applied or saved.</small></div><button type="button" className="formula-guide-button" onClick={exportGuide}><Icon name="more" size={16} />Export guide (.md)</button></header>
      <label className="formula-text-label"><span>Formula</span><textarea autoFocus spellCheck={false} value={source} onChange={(event) => setSource(event.target.value)} placeholder={'(category IN ["Electronics", "Tools"] OR tag = "important") AND quantity > 0'} /></label>
      <div className={`formula-validation ${valid ? "valid" : "invalid"}`} role="status"><Icon name={valid ? "check" : "close"} size={17} /><span><strong>{valid ? source.trim() ? "Formula is valid" : "No formula — all items match" : "Formula needs attention"}</strong><small>{validation.error || "Keywords and text matching are case-insensitive."}</small></span></div>
      <div className="formula-language-hint"><code>AND · OR · NOT · = · != · &gt; · &gt;= · &lt; · &lt;= · CONTAINS · IN […] · BEFORE · AFTER · IS EMPTY</code><small>The exported guide includes the complete syntax and your current categories, locations, tags, and units.</small></div>
      <div className="formula-save-view"><label><span>Saved view name</span><input value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="Example: Workshop low stock" /></label><button type="button" disabled={!valid || !viewName.trim()} onClick={() => onSave(viewName, { source: source.trim() })}>Save named view</button></div>
      <footer><button type="button" onClick={() => setSource("")}>Clear formula</button><button type="button" className="primary" disabled={!valid} onClick={() => onApply({ source: source.trim() })}>Apply formula</button></footer>
    </article>
  </div>;
}

function AddView({ locations, categories, units, onCreate, onCreateLocation, onCreateCategory, onInventoryChanged, busy, initialLocation }: {
  locations: LocationNode[];
  categories: Category[];
  units: string[];
  onCreate: (body: Record<string, unknown>) => Promise<void>;
  onCreateLocation: (body: { name: string; kind: string; parent_public_id: string | null }) => Promise<LocationNode>;
  onCreateCategory: (name: string, parentId: number | null) => Promise<Category>;
  onInventoryChanged: () => Promise<void>;
  busy: boolean;
  initialLocation: string;
}) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("pcs");
  const [customUnit, setCustomUnit] = useState("");
  const [location, setLocation] = useState(initialLocation);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [expiration, setExpiration] = useState("");
  const [threshold, setThreshold] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [linksValue, setLinksValue] = useState("");
  const [suggestion, setSuggestion] = useState<{ public_id: string; name: string; reason: string } | null>(null);
  const [picker, setPicker] = useState<"location" | "category" | null>(null);
  const nameInput = useRef<HTMLInputElement | null>(null);
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const locationNodes = useMemo(() => locationPickerNodes(locations), [locations]);
  const categoryNodes = useMemo(() => categoryPickerNodes(categories), [categories]);
  const selectedLocation = flatLocations.find((entry) => entry.public_id === location);
  const selectedCategory = categories.find((entry) => String(entry.id) === category);
  const selectedCapabilities = capabilitiesForCategory(categories, category);
  const categoryShortcuts = useMemo(() => (
    [...categories]
      .sort((left, right) =>
        right.total_item_count - left.total_item_count ||
        categoryOptionLabel(left).localeCompare(categoryOptionLabel(right)),
      )
      .slice(0, 8)
  ), [categories]);
  useEffect(() => setLocation(initialLocation), [initialLocation]);
  useEffect(() => {
    if (name.trim().length < 3) { setSuggestion(null); return; }
    const categoryName = categories.find((entry) => String(entry.id) === category)?.path || "";
    const timeout = window.setTimeout(() => {
      api.suggestLocation(name, "", categoryName)
        .then((result) => setSuggestion(result.suggestion))
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [categories, category, name]);

  function bumpQuantity(delta: number) {
    const current = Number(quantity.replace(",", "."));
    const next = Math.max(0, Number.isFinite(current) ? current + delta : delta);
    setQuantity(Number.isInteger(next) ? String(next) : next.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""));
  }

  function chooseCategory(categoryId: string) {
    setCategory(categoryId);
    const chosen = categories.find((entry) => String(entry.id) === categoryId);
    if (chosen?.default_location) setLocation(chosen.default_location.public_id);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onCreate({
      name,
      quantity,
      unit,
      location_public_id: location,
      category_id: category ? Number(category) : null,
      description,
      expiration_date: selectedCapabilities.expiration ? expiration || null : null,
      low_stock_threshold: threshold || null,
      brand: selectedCapabilities.identity ? brand : "",
      model: selectedCapabilities.specs ? model : "",
      links: selectedCapabilities.links ? parseLinkText(linksValue) : [],
    });
    setName("");
    setQuantity("1");
    setDescription("");
    setExpiration("");
    setThreshold("");
    setBrand("");
    setModel("");
    setLinksValue("");
    nameInput.current?.focus();
  }

  return (
    <section className="add-page">
      <form className="form-card capture-card" onSubmit={submit}>
        <label>What is it?<input ref={nameInput} required maxLength={240} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. ESP32-C3 board" autoFocus /></label>
        <div className="form-row">
          <label>Quantity<div className="quantity-stepper"><button type="button" onClick={() => bumpQuantity(-1)} aria-label="Decrease quantity"><Icon name="minus" size={16} /></button><input required inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} /><button type="button" onClick={() => bumpQuantity(1)} aria-label="Increase quantity"><Icon name="plus" size={16} /></button></div></label>
          <label>Unit<select value={unit} onChange={(event) => setUnit(event.target.value)}>{units.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
        </div>
        <div className="unit-chips" aria-label="Common units">{units.slice(0, 8).map((entry) => <button type="button" className={unit === entry ? "active" : ""} key={entry} onClick={() => setUnit(entry)}>{entry}</button>)}</div>
        <div className="picker-field"><span>What type is it?</span><button type="button" onClick={() => setPicker("category")}><Icon name="tag" size={16} /><strong>{selectedCategory ? categoryOptionLabel(selectedCategory) : "No category yet"}</strong></button>{category && <button type="button" className="text-button" onClick={() => setCategory("")}>Clear</button>}</div>
        {categoryShortcuts.length > 0 && <div className="category-chips" aria-label="Quick category picks">{categoryShortcuts.map((entry) => <button type="button" className={category === String(entry.id) ? "active" : ""} key={entry.id} onClick={() => chooseCategory(String(entry.id))}><Icon name="tag" size={14} />{entry.name}</button>)}</div>}
        {selectedCategory && <div className="capture-hint category-hint"><Icon name="tag" size={16} /><span>{categoryOptionLabel(selectedCategory)}{selectedCategory.default_location ? ` · default ${selectedCategory.default_location.name}` : ` · ${selectedCapabilities.maintenance ? "maintenance enabled" : "no maintenance by default"}`}</span></div>}
        <div className="picker-field"><span>Where does it live?</span><button type="button" onClick={() => setPicker("location")}><Icon name="pin" size={16} /><strong>{selectedLocation?.path || "Choose location"}</strong></button></div>
        <div className="capture-hint"><Icon name="pin" size={16} /><span>{selectedLocation ? `Adding to ${selectedLocation.path}` : "Scan a location QR first to prefill this."}</span></div>
        {suggestion && suggestion.public_id !== location && <button type="button" className="suggestion-card" onClick={() => setLocation(suggestion.public_id)}><Icon name="spark" size={17} /><span><strong>Use default location</strong><small>{suggestion.name} · {suggestion.reason}</small></span></button>}
        <details className="optional-fields"><summary>Useful details <Icon name="chevron" size={16} /></summary><div><div className="inline-unit-form"><input value={customUnit} onChange={(event) => setCustomUnit(event.target.value)} placeholder="One-off unit, e.g. tray" maxLength={24} /><button type="button" className="secondary" disabled={!customUnit.trim()} onClick={() => { const next = customUnit.trim(); if (next) { setUnit(next); setCustomUnit(""); } }}>Use unit</button></div><div className="form-row">{selectedCapabilities.expiration && <label>Expiration date<input type="date" value={expiration} onChange={(event) => setExpiration(event.target.value)} /></label>}<label>Low stock at<input inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder="e.g. 2" /></label></div>{(selectedCapabilities.identity || selectedCapabilities.specs) && <div className="form-row">{selectedCapabilities.identity && <label>Brand<input value={brand} onChange={(event) => setBrand(event.target.value)} /></label>}{selectedCapabilities.specs && <label>Model<input value={model} onChange={(event) => setModel(event.target.value)} /></label>}</div>}{selectedCapabilities.links && <label>Links<textarea rows={3} value={linksValue} onChange={(event) => setLinksValue(event.target.value)} placeholder="Manual | https://example.com/manual.pdf" /></label>}<label>Description<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Notes, identifying details, condition…" /></label></div></details>
        <button className="primary wide button-with-icon" disabled={busy || !name.trim()} type="submit"><Icon name="plus" size={18} />Add to inventory</button>
      </form>
      {picker === "location" && <HierarchyPicker title="Choose location" nodes={locationNodes} selectedId={location} emptyLabel="No child locations here" createPlaceholder="New location name" onChoose={setLocation} onCreate={async (parentId, nextName) => (await onCreateLocation({ name: nextName, kind: "location", parent_public_id: parentId })).public_id} onClose={() => setPicker(null)} />}
      {picker === "category" && <HierarchyPicker title="Choose category" nodes={categoryNodes} selectedId={category} emptyLabel="No child categories here" createPlaceholder="New category name" onChoose={chooseCategory} onCreate={async (parentId, nextName) => String((await onCreateCategory(nextName, parentId ? Number(parentId) : null)).id)} onClose={() => setPicker(null)} />}
      <AICommandBox busy={busy} onApplied={onInventoryChanged} />
    </section>
  );
}

type SpeechResultEvent = { results: ArrayLike<{ 0: { transcript: string } }> };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
};

function AICommandBox({ busy, onApplied }: { busy: boolean; onApplied: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [command, setCommand] = useState<AICommand | null>(null);
  const [error, setError] = useState("");
  const [listening, setListening] = useState(false);

  async function parse(event: FormEvent) {
    event.preventDefault();
    setError("");
    try { setCommand(await api.parseCommand(text)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not parse command"); }
  }

  function dictate() {
    const root = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Constructor = root.SpeechRecognition || root.webkitSpeechRecognition;
    if (!Constructor) { setError("Browser dictation is unavailable; type the instruction instead."); return; }
    const recognition = new Constructor();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.onresult = (event) => setText(event.results[0][0].transcript);
    recognition.onerror = () => setError("Dictation failed. You can still type the instruction.");
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  }

  async function confirm() {
    if (!command) return;
    try {
      await api.confirmCommand(command.public_id);
      await onApplied();
      setCommand(null);
      setText("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not apply command"); }
  }

  async function reject() {
    if (command?.requires_confirmation) await api.rejectCommand(command.public_id);
    setCommand(null);
  }

  return (
    <section className="ai-box">
      <div className="ai-heading"><span><Icon name="spark" size={22} /></span><div><p className="eyebrow">AI ASSISTANT</p><h2>Or just say it</h2><p>Describe several details at once. Nothing changes until you confirm.</p></div></div>
      <form onSubmit={parse}><label className="sr-only" htmlFor="ai-command">Inventory instruction</label><textarea id="ai-command" value={text} onChange={(event) => setText(event.target.value)} placeholder="Add 3 ESP32-C3 boards in the studio drawer, bought for €8 each." rows={3} /><div className="ai-buttons"><button type="button" className="secondary button-with-icon" onClick={dictate}><Icon name="mic" size={17} />{listening ? "Listening…" : "Dictate"}</button><button className="primary" disabled={busy || !text.trim()}>Review command</button></div></form>
      {error && <div className="inline-alert" role="alert">{error}</div>}
      {command && <div className="proposal"><p className="eyebrow">READY FOR REVIEW</p><h3>{command.proposal.summary}</h3><dl>{Object.entries(command.proposal.action).filter(([key]) => !["type", "current", "item_public_id", "location_public_id", "destination_public_id", "expected_version"].includes(key)).map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{value === null ? "—" : String(value)}</dd></div>)}</dl>{command.proposal.warnings?.map((warning) => <p className="warning" key={warning}>{warning}</p>)}{command.search_results ? <div className="mini-results">{command.search_results.map((item) => <p key={item.public_id}><strong>{item.name}</strong><span>{item.location_path}</span></p>)}</div> : command.requires_confirmation && <div className="proposal-actions"><button onClick={() => void reject()}>Cancel</button><button className="primary button-with-icon" onClick={() => void confirm()}><Icon name="check" size={17} />Confirm change</button></div>}</div>}
    </section>
  );
}

function PlacesView({ section, onSectionChange, locations, categories, locationTypes, selectedLocationId, busy, onSelectLocation, onOpenItem, onCaptureHere, onCreateLocation, onUpdateLocation, onDeleteLocation, onDeleteLocationTree, onCreateType, onOpenCategory, onCreateCategory, onUpdateCategory, onDeleteCategory, onDeleteCategoryTree, onSaveCapabilities, onSetDefaultLocation, onDefaultsChanged }: {
  section: PlacesSection;
  onSectionChange: (section: PlacesSection) => void;
  locations: LocationNode[];
  categories: Category[];
  locationTypes: LocationType[];
  selectedLocationId: string | null;
  busy: boolean;
  onSelectLocation: (id: string | null) => void;
  onOpenItem: (item: Item) => void;
  onCaptureHere: (id: string, mode?: CaptureMode) => void;
  onCreateLocation: (body: { name: string; kind: string; parent_public_id: string | null }) => Promise<void>;
  onUpdateLocation: (id: string, body: { name: string; kind: string; parent_public_id: string | null }) => Promise<void>;
  onDeleteLocation: (id: string) => Promise<void>;
  onDeleteLocationTree: (id: string) => Promise<void>;
  onCreateType: (name: string) => Promise<void>;
  onOpenCategory: (id: number) => void;
  onCreateCategory: (name: string, parentId: number | null) => Promise<void>;
  onUpdateCategory: (id: number, body: { name: string; parent_id: number | null }) => Promise<void>;
  onDeleteCategory: (id: number) => Promise<void>;
  onDeleteCategoryTree: (id: number) => Promise<void>;
  onSaveCapabilities: (overrides: ApplicationSettings["category_data"]["overrides"]) => Promise<void>;
  onSetDefaultLocation: (id: number, locationId: string | null) => Promise<void>;
  onDefaultsChanged: () => Promise<void>;
}) {
  return <section className="places-page">
    <header className="places-heading compact-places-heading"><div className="places-tabs" role="tablist" aria-label="Browse Places"><button type="button" role="tab" aria-selected={section === "locations"} className={section === "locations" ? "active" : ""} onClick={() => onSectionChange("locations")}><Icon name="pin" size={17} />Places</button><button type="button" role="tab" aria-selected={section === "categories"} className={section === "categories" ? "active" : ""} onClick={() => onSectionChange("categories")}><Icon name="tag" size={17} />Categories</button></div></header>
    {section === "locations" ? <div className={`places-layout ${selectedLocationId ? "has-detail" : ""}`}><div className="places-tree-pane"><LocationsView locations={locations} locationTypes={locationTypes} busy={busy} onOpen={(id) => onSelectLocation(id)} onCreate={onCreateLocation} onUpdate={onUpdateLocation} onDelete={onDeleteLocation} onDeleteTree={onDeleteLocationTree} onCreateType={onCreateType} /></div>{selectedLocationId ? <div className="places-detail-pane"><LocationDetailView locationId={selectedLocationId} locations={locations} categories={categories} locationTypes={locationTypes} busy={busy} onOpenItem={onOpenItem} onOpenLocation={(id) => onSelectLocation(id)} onAddHere={(id) => onCaptureHere(id, "quick")} onCreateLocationHere={onCreateLocation} onDefaultsChanged={onDefaultsChanged} onBack={() => onSelectLocation(null)} /><div className="location-mode-actions"><button className="primary button-with-icon" onClick={() => onCaptureHere(selectedLocationId, "putaway")}><Icon name="scan" size={17} />Put away here</button></div></div> : <aside className="places-detail-empty"><span><Icon name="pin" size={25} /></span><h2>Select a Place</h2><p>Its Items, child Places, defaults, and actions will stay beside the tree on larger screens.</p></aside>}</div> : <CategoriesView categories={categories} locations={locations} busy={busy} onOpen={onOpenCategory} onCreate={onCreateCategory} onUpdate={onUpdateCategory} onDelete={onDeleteCategory} onDeleteTree={onDeleteCategoryTree} onSaveCapabilities={onSaveCapabilities} onSetDefaultLocation={onSetDefaultLocation} />}
  </section>;
}

function GlobalSearch({ items, locations, categories, onClose, onOpenItem, onOpenLocation, onOpenCategory, onNavigate, onCapture }: {
  items: Item[];
  locations: LocationNode[];
  categories: Category[];
  onClose: () => void;
  onOpenItem: (item: Item) => void;
  onOpenLocation: (id: string) => void;
  onOpenCategory: (id: number) => void;
  onNavigate: (view: View) => void;
  onCapture: (mode: CaptureMode) => void;
}) {
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  useEffect(() => { api.projects().then(setProjects).catch(() => undefined); }, []);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", close); };
  }, [onClose]);
  const term = query.trim().toLocaleLowerCase();
  const matches = (values: Array<string | null | undefined>) => !term || values.filter(Boolean).join(" ").toLocaleLowerCase().includes(term);
  const itemResults = items.filter((item) => matches([item.name, item.brand, item.model, item.barcode, item.location_path, categoryLabel(item), ...item.tags])).slice(0, 8);
  const locationResults = flatLocations.filter((location) => matches([location.name, location.path, location.kind])).slice(0, 6);
  const categoryResults = categories.filter((category) => matches([category.name, category.path])).slice(0, 6);
  const projectResults = projects.filter((project) => matches([project.name, project.description, project.status])).slice(0, 5);
  const allCommands: Array<{ label: string; detail: string; icon: IconName; run: () => void }> = [
    { label: "Capture an item", detail: "Type or take a photo", icon: "plus", run: () => onCapture("quick") },
    { label: "Scan a barcode", detail: "Open the camera", icon: "scan", run: () => onCapture("scan") },
    { label: "Put items away", detail: "Scan into one destination", icon: "pin", run: () => onCapture("putaway") },
    { label: "Consume an item", detail: "Reduce quantity by scanning", icon: "minus", run: () => onCapture("consume") },
    { label: "Open inventory", detail: "Search and filter all items", icon: "search", run: () => onNavigate("inventory") },
    { label: "Open settings", detail: "Manage Findstuff", icon: "settings", run: () => onNavigate("manage") },
  ];
  const commands = allCommands.filter((command) => matches([command.label, command.detail]));
  return <div className="global-search-backdrop" role="dialog" aria-modal="true" aria-label="Search Findstuff" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="global-search-sheet"><header><Icon name="search" size={22} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Items, locations, categories, projects, commands…" aria-label="Search all of Findstuff" /><kbd>Esc</kbd><button className="icon-button" onClick={onClose} aria-label="Close search"><Icon name="close" size={17} /></button></header><div className="global-search-results">{itemResults.length > 0 && <SearchGroup title="Items">{itemResults.map((item) => <button key={item.public_id} onClick={() => onOpenItem(item)}><Icon name="box" size={17} /><span><strong>{item.name}</strong><small>{item.location_path} · {item.quantity} {item.unit}</small></span></button>)}</SearchGroup>}{locationResults.length > 0 && <SearchGroup title="Locations">{locationResults.map((location) => <button key={location.public_id} onClick={() => onOpenLocation(location.public_id)}><Icon name="pin" size={17} /><span><strong>{location.name}</strong><small>{location.path} · {location.total_item_count} items</small></span></button>)}</SearchGroup>}{categoryResults.length > 0 && <SearchGroup title="Categories">{categoryResults.map((category) => <button key={category.id} onClick={() => onOpenCategory(category.id)}><Icon name="tag" size={17} /><span><strong>{category.name}</strong><small>{category.path} · {category.total_item_count} items</small></span></button>)}</SearchGroup>}{projectResults.length > 0 && <SearchGroup title="Projects">{projectResults.map((project) => <button key={project.public_id} onClick={() => onNavigate("manage")}><Icon name="spark" size={17} /><span><strong>{project.name}</strong><small>{project.status} · {project.reservations.length} reservations</small></span></button>)}</SearchGroup>}{commands.length > 0 && <SearchGroup title="Commands">{commands.map((command) => <button key={command.label} onClick={command.run}><Icon name={command.icon} size={17} /><span><strong>{command.label}</strong><small>{command.detail}</small></span></button>)}</SearchGroup>}{term && !itemResults.length && !locationResults.length && !categoryResults.length && !projectResults.length && !commands.length && <EmptyState icon="search" title="Nothing found" text="Try a shorter name, barcode, place, category, project, or command." />}</div></section></div>;
}

function SearchGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="global-search-group"><h2>{title}</h2><div>{children}</div></section>;
}

function LocationsView({ locations, locationTypes, onCreate, onUpdate, onDelete, onDeleteTree, onCreateType, onOpen, busy }: {
  locations: LocationNode[];
  locationTypes: LocationType[];
  onCreate: (body: { name: string; kind: string; parent_public_id: string | null }) => Promise<void>;
  onUpdate: (publicId: string, body: { name: string; kind: string; parent_public_id: string | null }) => Promise<void>;
  onDelete: (publicId: string) => Promise<void>;
  onDeleteTree: (publicId: string) => Promise<void>;
  onCreateType: (name: string) => Promise<void>;
  onOpen: (publicId: string) => void;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("location");
  const [parent, setParent] = useState("");
  const [newType, setNewType] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState("");
  const [editName, setEditName] = useState("");
  const [editKind, setEditKind] = useState("location");
  const [editParent, setEditParent] = useState("");
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const editingLocation = useMemo(() => flatLocations.find((entry) => entry.public_id === editingId) || null, [editingId, flatLocations]);
  const editParentOptions = useMemo(() => {
    if (!editingLocation) return flatLocations;
    const blocked = new Set(flattenLocations([editingLocation]).map((entry) => entry.public_id));
    return flatLocations.filter((entry) => !blocked.has(entry.public_id));
  }, [editingLocation, flatLocations]);
  function toggle(publicId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(publicId)) next.delete(publicId);
      else next.add(publicId);
      return next;
    });
  }
  function startEdit(location: LocationNode) {
    setEditingId(location.public_id);
    setEditName(location.name);
    setEditKind(location.kind);
    const parentPath = location.path.split(" > ").slice(0, -1).join(" > ");
    setEditParent(flatLocations.find((entry) => entry.path === parentPath)?.public_id || "");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    await onCreate({ name, kind, parent_public_id: parent || null });
    setName("");
  }
  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingLocation) return;
    await onUpdate(editingLocation.public_id, {
      name: editName,
      kind: editKind,
      parent_public_id: editParent || null,
    });
    setEditingId("");
  }
  async function remove(location: LocationNode) {
    if (!window.confirm(`Delete ${location.path}? Locations with items or child locations must be emptied first.`)) return;
    await onDelete(location.public_id);
  }
  async function removeTree(location: LocationNode) {
    const totalItems = location.total_item_count ?? location.item_count ?? 0;
    if (!window.confirm(`Delete ${location.path} and all child locations? ${totalItems} item${totalItems === 1 ? "" : "s"} inside will be archived.`)) return;
    await onDeleteTree(location.public_id);
  }
  async function submitType(event: FormEvent) {
    event.preventDefault();
    await onCreateType(newType);
    setKind(newType.trim().toLowerCase());
    setNewType("");
  }
  return (
    <section className="locations-page">
      <details className="create-panel"><summary><span className="summary-icon"><Icon name="plus" /></span><span><strong>Create a location</strong><small>Nest it inside any existing place</small></span><Icon name="chevron" /></summary><form className="form-card" onSubmit={submit}>
          <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Drawer A" /></label>
          <div className="form-row">
            <label>Inside<select value={parent} onChange={(event) => setParent(event.target.value)}><option value="">Top level</option>{flatLocations.map((entry) => <option key={entry.public_id} value={entry.public_id}>{entry.path}</option>)}</select></label>
            <label>Type<select value={kind} onChange={(event) => setKind(event.target.value)}>{locationTypes.map((entry) => <option value={entry.name} key={entry.name}>{entry.name}</option>)}</select></label>
          </div>
          <button className="primary wide button-with-icon" disabled={busy || !name.trim()}><Icon name="plus" size={17} />Create location</button>
        </form><form className="inline-create-type" onSubmit={submitType}><label>Add a custom type<input value={newType} onChange={(event) => setNewType(event.target.value)} placeholder="e.g. crate, suitcase, rack" /></label><button className="secondary" disabled={!newType.trim()}>Add type</button></form></details>
      <div className="location-tree">{locations.length ? locations.map((node) => <LocationBranch key={node.public_id} node={node} locationTypes={locationTypes} editParentOptions={editParentOptions} editingId={editingId} editName={editName} editKind={editKind} editParent={editParent} expanded={expanded} busy={busy} depth={0} onToggle={toggle} onOpen={onOpen} onEdit={startEdit} onDelete={remove} onDeleteTree={removeTree} onSaveEdit={saveEdit} onCancelEdit={() => setEditingId("")} onEditName={setEditName} onEditKind={setEditKind} onEditParent={setEditParent} />) : <EmptyState icon="pin" title="No locations yet" text="Create your first room, shelf, box, or drawer." />}</div>
    </section>
  );
}

function LocationBranch({ node, locationTypes, editParentOptions, editingId, editName, editKind, editParent, expanded, busy, depth = 0, onToggle, onOpen, onEdit, onDelete, onDeleteTree, onSaveEdit, onCancelEdit, onEditName, onEditKind, onEditParent }: {
  node: LocationNode;
  locationTypes: LocationType[];
  editParentOptions: LocationNode[];
  editingId: string;
  editName: string;
  editKind: string;
  editParent: string;
  expanded: Set<string>;
  busy: boolean;
  depth?: number;
  onToggle: (publicId: string) => void;
  onOpen: (publicId: string) => void;
  onEdit: (location: LocationNode) => void;
  onDelete: (location: LocationNode) => void;
  onDeleteTree: (location: LocationNode) => void;
  onSaveEdit: (event: FormEvent) => void;
  onCancelEdit: () => void;
  onEditName: (value: string) => void;
  onEditKind: (value: string) => void;
  onEditParent: (value: string) => void;
}) {
  const isOpen = expanded.has(node.public_id);
  const isEditing = editingId === node.public_id;
  const isSystem = node.public_id === "unassigned";
  const directItems = node.item_count ?? 0;
  const totalItems = node.total_item_count ?? directItems;
  const itemText = `${totalItems} item${totalItems === 1 ? "" : "s"}${directItems && directItems !== totalItems ? ` · ${directItems} here` : ""}`;
  const placeText = node.children.length ? `${node.children.length} place${node.children.length === 1 ? "" : "s"} inside` : "exact spot";
  return <div className="location-branch" style={{ "--depth": depth } as CSSProperties}><div className="location-node"><span className="hierarchy-rail" aria-hidden="true" />{node.children.length > 0 ? <button type="button" className={`tree-toggle ${isOpen ? "open" : ""}`} onClick={() => onToggle(node.public_id)} aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.name}`} aria-expanded={isOpen}><Icon name="chevron" size={16} /></button> : <span className="tree-toggle-spacer" />}<button type="button" className="location-open" onClick={() => onOpen(node.public_id)}><span className="location-kind"><Icon name={node.kind === "box" || node.kind === "container" ? "box" : "pin"} size={18} /></span><span><strong>{node.name}</strong><small>Level {depth + 1} · {node.kind} · {itemText} · {placeText}</small><em>{node.path}</em></span></button><div className="location-node-actions"><button type="button" disabled={isSystem || busy} onClick={() => onEdit(node)}><Icon name="settings" size={14} /><span>Edit</span></button><button type="button" disabled={isSystem || busy || node.children.length > 0} title={node.children.length > 0 ? "Move or delete child locations first" : "Delete location"} onClick={() => onDelete(node)}><Icon name="close" size={14} /><span>Delete</span></button><button type="button" className="danger-button" disabled={isSystem || busy} onClick={() => onDeleteTree(node)}><Icon name="close" size={14} /><span>Subtree</span></button><a className="qr-link" href={`/api/v1/labels/locations/${node.public_id}`} target="_blank" rel="noreferrer" aria-label={`QR label for ${node.name}`}><Icon name="qr" size={18} /><span>QR</span></a></div></div>{isEditing && <form className="location-edit-form" onSubmit={onSaveEdit}><label>Name<input required value={editName} onChange={(event) => onEditName(event.target.value)} /></label><label>Type<select value={editKind} onChange={(event) => onEditKind(event.target.value)}>{locationTypes.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}</select></label><label>Inside<select value={editParent} onChange={(event) => onEditParent(event.target.value)}><option value="">Top level</option>{editParentOptions.map((entry) => <option key={entry.public_id} value={entry.public_id}>{entry.path}</option>)}</select></label><div className="button-row"><button type="button" onClick={onCancelEdit}>Cancel</button><button className="secondary" disabled={!editName.trim() || busy}>Save location</button></div></form>}{isOpen && node.children.map((child) => <LocationBranch key={child.public_id} node={child} locationTypes={locationTypes} editParentOptions={editParentOptions} editingId={editingId} editName={editName} editKind={editKind} editParent={editParent} expanded={expanded} busy={busy} depth={depth + 1} onToggle={onToggle} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} onDeleteTree={onDeleteTree} onSaveEdit={onSaveEdit} onCancelEdit={onCancelEdit} onEditName={onEditName} onEditKind={onEditKind} onEditParent={onEditParent} />)}</div>;
}

function CategoriesView({ categories, locations, busy, onOpen, onCreate, onUpdate, onDelete, onDeleteTree, onSaveCapabilities, onSetDefaultLocation }: {
  categories: Category[];
  locations: LocationNode[];
  busy: boolean;
  onOpen: (categoryId: number) => void;
  onCreate: (name: string, parentId: number | null) => Promise<void>;
  onUpdate: (categoryId: number, body: { name: string; parent_id: number | null }) => Promise<void>;
  onDelete: (categoryId: number) => Promise<void>;
  onDeleteTree: (categoryId: number) => Promise<void>;
  onSaveCapabilities: (overrides: ApplicationSettings["category_data"]["overrides"]) => Promise<void>;
  onSetDefaultLocation: (categoryId: number, locationId: string | null) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editParent, setEditParent] = useState("");
  const [editDefaultLocation, setEditDefaultLocation] = useState("");
  const [capabilityOverrides, setCapabilityOverrides] = useState<ApplicationSettings["category_data"]["overrides"]>({});
  const tree = useMemo(() => buildCategoryTree(categories), [categories]);
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const editingCategory = categories.find((entry) => entry.id === editingId) || null;
  const editParentOptions = useMemo(() => {
    if (!editingCategory) return categories;
    const blocked = categoryDescendantIds(categories, editingCategory.id);
    return categories.filter((entry) => !blocked.has(entry.id));
  }, [categories, editingCategory]);
  useEffect(() => {
    const next: ApplicationSettings["category_data"]["overrides"] = {};
    for (const category of categories) {
      if (!category.capabilities.override) continue;
      next[String(category.id)] = Object.fromEntries(
        Object.keys(CATEGORY_DATA_FIELD_LABELS).map((field) => [field, Boolean(category.capabilities[field as keyof typeof CATEGORY_DATA_FIELD_LABELS])]),
      ) as Record<string, boolean>;
    }
    setCapabilityOverrides(next);
  }, [categories]);
  function toggle(categoryId: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    await onCreate(name, parent ? Number(parent) : null);
    setName("");
  }
  function startEdit(category: Category) {
    setEditingId(category.id);
    setEditName(category.name);
    setEditParent(category.parent_id === null ? "" : String(category.parent_id));
    setEditDefaultLocation(category.default_location?.public_id || "");
  }
  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingCategory) return;
    await onUpdate(editingCategory.id, { name: editName, parent_id: editParent ? Number(editParent) : null });
    await onSetDefaultLocation(editingCategory.id, editDefaultLocation || null);
    await onSaveCapabilities(capabilityOverrides);
    setEditingId(null);
  }
  async function remove(category: Category) {
    if (!window.confirm(`Delete ${category.path}? It must have no items or child categories.`)) return;
    await onDelete(category.id);
  }
  async function removeTree(category: Category) {
    if (!window.confirm(`Delete ${category.path} and all child categories? ${category.total_item_count} item${category.total_item_count === 1 ? "" : "s"} will become uncategorised.`)) return;
    await onDeleteTree(category.id);
  }
  function setCapability(category: Category, field: keyof typeof CATEGORY_DATA_FIELD_LABELS, enabled: boolean) {
    setCapabilityOverrides((current) => ({
      ...current,
      [String(category.id)]: {
        ...Object.fromEntries(Object.keys(CATEGORY_DATA_FIELD_LABELS).map((key) => [key, Boolean(category.capabilities[key as keyof typeof CATEGORY_DATA_FIELD_LABELS])])),
        ...(current[String(category.id)] || {}),
        [field]: enabled,
      },
    }));
  }
  function resetCapabilities(category: Category) {
    setCapabilityOverrides((current) => {
      const next = { ...current };
      delete next[String(category.id)];
      return next;
    });
  }
  return (
    <section className="locations-page">
      {editingCategory ? <CategoryEditPanel category={editingCategory} locations={flatLocations} editName={editName} editParent={editParent} editParentOptions={editParentOptions} editDefaultLocation={editDefaultLocation} overrides={capabilityOverrides} busy={busy} onEditName={setEditName} onEditParent={setEditParent} onEditDefaultLocation={setEditDefaultLocation} onCapability={setCapability} onResetCapabilities={resetCapabilities} onCancel={() => setEditingId(null)} onSubmit={saveEdit} /> : <details className="create-panel"><summary><span className="summary-icon"><Icon name="plus" /></span><span><strong>Create a category</strong><small>Nest it under any existing category</small></span><Icon name="chevron" /></summary><form className="form-card" onSubmit={submit}><label>Name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Resistors, batteries, printer parts" /></label><label>Inside<select value={parent} onChange={(event) => setParent(event.target.value)}><option value="">Top level</option>{categories.map((entry) => <option key={entry.id} value={entry.id}>{categoryOptionLabel(entry)}</option>)}</select></label><button className="primary wide button-with-icon" disabled={busy || !name.trim()}><Icon name="plus" size={17} />Create category</button></form></details>}
      <div className="category-tree">{tree.length ? tree.map((category) => <CategoryBranch key={category.id} category={category} expanded={expanded} busy={busy} onToggle={toggle} onOpen={onOpen} onEdit={startEdit} onDelete={remove} onDeleteTree={removeTree} />) : <EmptyState icon="tag" title="No categories yet" text="Create your first category." />}</div>
    </section>
  );
}

function CategoryEditPanel({ category, locations, editName, editParent, editParentOptions, editDefaultLocation, overrides, busy, onEditName, onEditParent, onEditDefaultLocation, onCapability, onResetCapabilities, onCancel, onSubmit }: {
  category: Category;
  locations: LocationNode[];
  editName: string;
  editParent: string;
  editParentOptions: Category[];
  editDefaultLocation: string;
  overrides: ApplicationSettings["category_data"]["overrides"];
  busy: boolean;
  onEditName: (value: string) => void;
  onEditParent: (value: string) => void;
  onEditDefaultLocation: (value: string) => void;
  onCapability: (category: Category, field: keyof typeof CATEGORY_DATA_FIELD_LABELS, enabled: boolean) => void;
  onResetCapabilities: (category: Category) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const override = overrides[String(category.id)];
  const capabilities = { ...category.capabilities, ...(override || {}) };
  const [pickingLocation, setPickingLocation] = useState(false);
  const locationRoots = locations.filter((entry) => !entry.path.includes(" > "));
  const locationNodes = locationPickerNodes(locationRoots);
  const selectedLocation = locations.find((entry) => entry.public_id === editDefaultLocation);
  return <>
    <form className="form-card compact-form category-edit-panel" onSubmit={onSubmit}>
      <div className="section-heading"><div><p className="eyebrow">EDIT CATEGORY</p><h2>{category.name}</h2><span>{category.path}</span></div></div>
      <div className="form-row"><label>Rename<input required value={editName} onChange={(event) => onEditName(event.target.value)} /></label><label>Move inside<select value={editParent} onChange={(event) => onEditParent(event.target.value)}><option value="">Top level</option>{editParentOptions.map((entry) => <option key={entry.id} value={entry.id}>{categoryOptionLabel(entry)}</option>)}</select></label></div>
      <div className="picker-field"><span>Default location</span><button type="button" onClick={() => setPickingLocation(true)}><Icon name="pin" size={16} /><strong>{selectedLocation?.path || "Inherit / none"}</strong></button>{editDefaultLocation && <button type="button" className="text-button" onClick={() => onEditDefaultLocation("")}>Clear</button>}</div>
      <div className="category-data-title"><div><strong>Required metadata</strong><small>{category.capabilities.override ? "customized here" : `inherits ${category.capabilities.inherited_label}`}</small></div><button type="button" onClick={() => onResetCapabilities(category)}>Reset</button></div>
      <div className="capability-grid">{(Object.keys(CATEGORY_DATA_FIELD_LABELS) as Array<keyof typeof CATEGORY_DATA_FIELD_LABELS>).map((field) => <label className="toggle compact-toggle" key={field}><input type="checkbox" checked={Boolean(capabilities[field])} onChange={(event) => onCapability(category, field, event.target.checked)} /><span><strong>{CATEGORY_DATA_FIELD_LABELS[field]}</strong></span></label>)}</div>
      <div className="button-row"><button type="button" onClick={onCancel}>Cancel</button><button className="secondary" disabled={!editName.trim() || busy}>Save category</button></div>
    </form>
    {pickingLocation && <HierarchyPicker title="Choose default location" nodes={locationNodes} selectedId={editDefaultLocation} emptyLabel="No child locations here" chooseLabel="Use location" currentChooseLabel="Use this location" onChoose={onEditDefaultLocation} onClose={() => setPickingLocation(false)} />}
  </>;
}

function CategoryBranch({ category, expanded, busy, depth = 0, onToggle, onOpen, onEdit, onDelete, onDeleteTree }: {
  category: CategoryNode;
  expanded: Set<number>;
  busy: boolean;
  depth?: number;
  onToggle: (categoryId: number) => void;
  onOpen: (categoryId: number) => void;
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
  onDeleteTree: (category: Category) => void;
}) {
  const isOpen = expanded.has(category.id);
  const canDelete = category.children.length === 0 && category.item_count === 0;
  return <div className="category-branch" style={{ "--depth": depth } as CSSProperties}><div className="category-node"><span className="hierarchy-rail" aria-hidden="true" />{category.children.length > 0 ? <button type="button" className={`tree-toggle ${isOpen ? "open" : ""}`} onClick={() => onToggle(category.id)} aria-label={`${isOpen ? "Collapse" : "Expand"} ${category.name}`} aria-expanded={isOpen}><Icon name="chevron" size={16} /></button> : <span className="tree-toggle-spacer" />}<button type="button" className="category-open" onClick={() => onOpen(category.id)}><span className="location-kind"><Icon name="tag" size={17} /></span><span><strong>{category.name}</strong><small>Level {depth + 1} · {category.total_item_count} item{category.total_item_count === 1 ? "" : "s"} · {category.children.length} child{category.children.length === 1 ? "" : "ren"}</small><em>{categoryOptionLabel(category)}</em></span></button><div className="category-actions"><button type="button" onClick={() => onEdit(category)}><Icon name="settings" size={14} /><span>Edit</span></button><button type="button" disabled={busy || !canDelete} title={canDelete ? "Delete category" : "Move children and items first"} onClick={() => onDelete(category)}><Icon name="close" size={14} /><span>Delete</span></button><button type="button" className="danger-button" disabled={busy} onClick={() => onDeleteTree(category)}><Icon name="close" size={14} /><span>Subtree</span></button></div></div>{isOpen && category.children.map((child) => <CategoryBranch key={child.id} category={child} expanded={expanded} busy={busy} depth={depth + 1} onToggle={onToggle} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} onDeleteTree={onDeleteTree} />)}</div>;
}

function CategoryDetailView({ categoryId, categories, busy, onOpenItem, onOpenCategory, onInventory, onCreateCategoryHere, onBack }: {
  categoryId: number;
  categories: Category[];
  busy: boolean;
  onOpenItem: (item: Item) => void;
  onOpenCategory: (categoryId: number) => void;
  onInventory: (categoryId: number) => void;
  onCreateCategoryHere: (name: string, parentId: number) => Promise<void>;
  onBack: () => void;
}) {
  const [contents, setContents] = useState<CategoryContents | null>(null);
  const [quickPhotos, setQuickPhotos] = useState(false);
  const [showCreateChild, setShowCreateChild] = useState(false);
  const [childName, setChildName] = useState("");
  const missingPhotoItems = useMemo(() => contents?.items.filter((item) => !item.primary_photo_url) || [], [contents]);
  const load = useCallback(async () => {
    setContents(await api.categoryContents(categoryId));
  }, [categoryId]);
  useEffect(() => {
    let active = true;
    setContents(null);
    load().catch(() => { if (active) setContents(null); });
    return () => { active = false; };
  }, [categories, load]);
  if (!contents) return <section className="locations-page"><button className="text-button" onClick={onBack}>Back to categories</button><EmptyState icon="tag" title={busy ? "Loading category" : "Category unavailable"} text="Open a category from the hierarchy." /></section>;
  async function createChildCategory(event: FormEvent) {
    event.preventDefault();
    if (!contents || !childName.trim()) return;
    await onCreateCategoryHere(childName.trim(), contents.category.id);
    setChildName("");
    setShowCreateChild(false);
    await load();
  }
  return (
    <section className="locations-page">
      <button className="text-button" onClick={onBack}>Back to categories</button>
      <div className="detail-hero"><div><p className="eyebrow">CATEGORY</p><h1>{contents.category.name}</h1><CategoryCrumbs category={contents.category} categories={categories} onOpen={onOpenCategory} /></div><div className="detail-hero-actions"><button className="primary button-with-icon" onClick={() => setShowCreateChild((value) => !value)}><Icon name="plus" size={16} />Add category here</button><button className="secondary" onClick={() => onInventory(contents.category.id)}>Show in inventory</button><button className="secondary button-with-icon" disabled={missingPhotoItems.length === 0} onClick={() => setQuickPhotos(true)}><Icon name="camera" size={16} />Photos {missingPhotoItems.length}</button></div></div>
      {showCreateChild && <form className="inline-detail-create" onSubmit={createChildCategory}><label>New child category<input required autoFocus value={childName} onChange={(event) => setChildName(event.target.value)} placeholder={`Inside ${contents.category.name}`} /></label><div className="button-row"><button type="button" onClick={() => { setShowCreateChild(false); setChildName(""); }}>Cancel</button><button className="secondary" disabled={busy || !childName.trim()}>Create category</button></div></form>}
      <div className="location-overview"><div><span>Direct items</span><strong>{contents.category.item_count}</strong></div><div><span>Including children</span><strong>{contents.category.total_item_count}</strong></div><div><span>Default location</span><strong>{contents.category.default_location?.name || "Inherited"}</strong></div></div>
      {contents.children.length > 0 && <section className="detail-section"><div className="section-heading"><div><h2>Child categories</h2><span>{contents.children.length} below this level</span></div></div><div className="child-location-grid">{contents.children.map((child) => <button key={child.id} onClick={() => onOpenCategory(child.id)}><Icon name="tag" size={18} /><strong>{child.name}</strong><small>{child.total_item_count} item{child.total_item_count === 1 ? "" : "s"}</small></button>)}</div></section>}
      <DetailItemsBrowser items={contents.items} groupMode="location" emptyText="Items assigned to this category or its children will appear here." onOpenItem={onOpenItem} busy={busy} />
      {quickPhotos && <QuickPhotoSession title={contents.category.name} items={missingPhotoItems} onDone={async () => { setQuickPhotos(false); await load(); }} onClose={() => setQuickPhotos(false)} />}
    </section>
  );
}

function LocationDetailView({ locationId, locations, categories, locationTypes, busy, onOpenItem, onOpenLocation, onAddHere, onCreateLocationHere, onDefaultsChanged, onBack }: {
  locationId: string;
  locations: LocationNode[];
  categories: Category[];
  locationTypes: LocationType[];
  busy: boolean;
  onOpenItem: (item: Item) => void;
  onOpenLocation: (publicId: string) => void;
  onAddHere: (publicId: string) => void;
  onCreateLocationHere: (body: { name: string; kind: string; parent_public_id: string | null }) => Promise<void>;
  onDefaultsChanged: () => Promise<void>;
  onBack: () => void;
}) {
  const [contents, setContents] = useState<LocationContents | null>(null);
  const [rules, setRules] = useState<LocationRule[]>([]);
  const [defaultType, setDefaultType] = useState<"category" | "name" | "barcode">("category");
  const [defaultCategoryId, setDefaultCategoryId] = useState("");
  const [defaultMatch, setDefaultMatch] = useState("");
  const [editingDefaultId, setEditingDefaultId] = useState("");
  const [editingDefaultType, setEditingDefaultType] = useState<"category" | "name" | "barcode">("category");
  const [editingDefaultCategoryId, setEditingDefaultCategoryId] = useState("");
  const [editingDefaultMatch, setEditingDefaultMatch] = useState("");
  const [error, setError] = useState("");
  const [quickPhotos, setQuickPhotos] = useState(false);
  const [aiScanOpen, setAiScanOpen] = useState(false);
  const [showCreateChild, setShowCreateChild] = useState(false);
  const [childName, setChildName] = useState("");
  const [childKind, setChildKind] = useState(locationTypes[0]?.name || "location");
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const missingPhotoItems = useMemo(() => contents?.items.filter((item) => !item.primary_photo_url) || [], [contents]);
  const load = useCallback(async () => {
    try {
      setError("");
      setContents(await api.locationContents(locationId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load location");
    }
  }, [locationId]);
  const loadDefaults = useCallback(async () => {
    setRules(await api.locationRules());
  }, []);
  useEffect(() => { void load(); void loadDefaults(); }, [load, loadDefaults]);
  useEffect(() => {
    if (!locationTypes.some((entry) => entry.name === childKind)) {
      setChildKind(locationTypes[0]?.name || "location");
    }
  }, [childKind, locationTypes]);
  if (error) return <section className="location-detail-page"><button className="text-button" onClick={onBack}>Back to Places</button><div className="inline-alert">{error}</div></section>;
  if (!contents) return <div className="dashboard-skeleton" aria-label="Loading Place"><span /><span /><span /></div>;
  const currentLocation = contents.location;
  const currentLocationChain = findLocationChain(currentLocation.path, flatLocations);
  const locationRules = rules.filter((rule) => rule.location_public_id === currentLocation.public_id);
  const categoryDefaults = locationRules.filter((rule) => rule.rule_type === "category");
  const itemDefaults = locationRules.filter((rule) => rule.rule_type !== "category");
  async function addDefault(event: FormEvent) {
    event.preventDefault();
    const category = categories.find((entry) => String(entry.id) === defaultCategoryId);
    const match = defaultType === "category" ? category && categoryOptionLabel(category) : defaultMatch.trim();
    if (!match) return;
    await api.createLocationRule({
      rule_type: defaultType,
      match_value: match,
      location_public_id: currentLocation.public_id,
      priority: defaultType === "barcode" ? 500 : 100,
    });
    setDefaultMatch("");
    setDefaultCategoryId("");
    await loadDefaults();
    await onDefaultsChanged();
  }
  function startEditDefault(rule: LocationRule) {
    setEditingDefaultId(rule.public_id);
    setEditingDefaultType(rule.rule_type);
    setEditingDefaultMatch(rule.match_value);
    setEditingDefaultCategoryId(
      rule.rule_type === "category"
        ? String(categories.find((entry) => categoryOptionLabel(entry) === rule.match_value)?.id || "")
        : "",
    );
  }
  async function saveDefault(event: FormEvent) {
    event.preventDefault();
    const category = categories.find((entry) => String(entry.id) === editingDefaultCategoryId);
    const match = editingDefaultType === "category" ? category && categoryOptionLabel(category) : editingDefaultMatch.trim();
    if (!editingDefaultId || !match) return;
    await api.updateLocationRule(editingDefaultId, {
      rule_type: editingDefaultType,
      match_value: match,
      location_public_id: currentLocation.public_id,
      priority: editingDefaultType === "barcode" ? 500 : 100,
    });
    setEditingDefaultId("");
    await loadDefaults();
    await onDefaultsChanged();
  }
  async function removeDefault(rule: LocationRule) {
    if (!window.confirm(`Delete this ${rule.rule_type} default?\n\n${rule.match_value} → ${rule.location_name}`)) return;
    await api.deleteLocationRule(rule.public_id);
    await loadDefaults();
    await onDefaultsChanged();
  }
  async function createChildLocation(event: FormEvent) {
    event.preventDefault();
    if (!childName.trim()) return;
    await onCreateLocationHere({
      name: childName.trim(),
      kind: childKind,
      parent_public_id: currentLocation.public_id,
    });
    setChildName("");
    setShowCreateChild(false);
    await load();
  }
  function defaultRuleRow(rule: LocationRule) {
    if (editingDefaultId === rule.public_id) {
      return <form className="default-chip editing" key={rule.public_id} onSubmit={saveDefault}><label>Type<select value={editingDefaultType} onChange={(event) => setEditingDefaultType(event.target.value as "category" | "name" | "barcode")}><option value="category">Category</option><option value="name">Item name contains</option><option value="barcode">Exact barcode</option></select></label>{editingDefaultType === "category" ? <label>Category<select required value={editingDefaultCategoryId} onChange={(event) => setEditingDefaultCategoryId(event.target.value)}><option value="">Choose category</option>{categories.map((category) => <option key={category.id} value={category.id}>{categoryOptionLabel(category)}</option>)}</select></label> : <label>Match<input required value={editingDefaultMatch} onChange={(event) => setEditingDefaultMatch(event.target.value)} /></label>}<div><button type="button" onClick={() => setEditingDefaultId("")}>Cancel</button><button className="secondary" disabled={editingDefaultType === "category" ? !editingDefaultCategoryId : !editingDefaultMatch.trim()}>Save</button></div></form>;
    }
    return <p className="default-chip" key={rule.public_id}><span>{rule.rule_type === "category" ? rule.match_value : `${rule.rule_type}: ${rule.match_value}`}</span><button type="button" onClick={() => startEditDefault(rule)} aria-label={`Edit ${rule.match_value} default`}><Icon name="settings" size={13} /></button><button type="button" onClick={() => void removeDefault(rule)} aria-label={`Remove ${rule.match_value} default`}><Icon name="close" size={13} /></button></p>;
  }
  return (
    <section className="location-detail-page">
      <div className="page-heading"><div><h1>{currentLocation.name}</h1><LocationCrumbs chain={currentLocationChain} fallback={currentLocation.path} onOpen={onOpenLocation} /><p>{contents.items.length} Item{contents.items.length === 1 ? "" : "s"} including nested Places.</p></div><button className="icon-button" onClick={onBack} aria-label="Back to Places"><Icon name="close" /></button></div>
      <div className="location-actions"><button className="primary button-with-icon" onClick={() => onAddHere(currentLocation.public_id)}><Icon name="plus" size={17} />Add Item</button><button className="ai-scan-action button-with-icon" onClick={() => setAiScanOpen(true)}><Icon name="spark" size={17} />AI Scan</button><button className="secondary button-with-icon" onClick={() => setShowCreateChild((value) => !value)}><Icon name="plus" size={17} />Add Place</button><button className="secondary button-with-icon" disabled={missingPhotoItems.length === 0} onClick={() => setQuickPhotos(true)}><Icon name="camera" size={17} />Photos {missingPhotoItems.length}</button><a className="secondary button-with-icon" href={`/api/v1/labels/locations/${currentLocation.public_id}`} target="_blank" rel="noreferrer"><Icon name="qr" size={17} />Print QR</a></div>
      {showCreateChild && <form className="inline-detail-create" onSubmit={createChildLocation}><label>New Place<input required autoFocus value={childName} onChange={(event) => setChildName(event.target.value)} placeholder={`Inside ${currentLocation.name}`} /></label><label>Type<select value={childKind} onChange={(event) => setChildKind(event.target.value)}>{locationTypes.map((entry) => <option value={entry.name} key={entry.name}>{entry.name}</option>)}</select></label><div className="button-row"><button type="button" onClick={() => { setShowCreateChild(false); setChildName(""); }}>Cancel</button><button className="secondary" disabled={busy || !childName.trim()}>Create Place</button></div></form>}
      <details className="detail-section defaults-section"><summary><span><Icon name="settings" size={16} />Defaults here</span><Icon name="chevron" size={16} /></summary><div className="defaults-section-body"><div className="defaults-grid"><div><strong>Categories</strong>{categoryDefaults.length ? categoryDefaults.map(defaultRuleRow) : <small>No category defaults</small>}</div><div><strong>Items and barcodes</strong>{itemDefaults.length ? itemDefaults.map(defaultRuleRow) : <small>No item defaults</small>}</div></div><form className="default-rule-form" onSubmit={addDefault}><label>Default type<select value={defaultType} onChange={(event) => setDefaultType(event.target.value as "category" | "name" | "barcode")}><option value="category">Category</option><option value="name">Item name contains</option><option value="barcode">Exact barcode</option></select></label>{defaultType === "category" ? <label>Category<select required value={defaultCategoryId} onChange={(event) => setDefaultCategoryId(event.target.value)}><option value="">Choose category</option>{categories.map((category) => <option key={category.id} value={category.id}>{categoryOptionLabel(category)}</option>)}</select></label> : <label>Match<input required inputMode={defaultType === "barcode" ? "numeric" : "text"} value={defaultMatch} onChange={(event) => setDefaultMatch(event.target.value)} placeholder={defaultType === "barcode" ? "8023263000534" : "SanBenedetto"} /></label>}<button className="secondary" disabled={defaultType === "category" ? !defaultCategoryId : !defaultMatch.trim()}>Add default</button></form></div></details>
      {contents.children.length > 0 && <section className="detail-section"><div className="section-heading"><div><h2>Inside this place</h2></div></div><div className="child-location-grid">{contents.children.map((child) => <button type="button" key={child.public_id} onClick={() => onOpenLocation(child.public_id)}><Icon name={child.kind === "box" || child.kind === "container" ? "box" : "pin"} /><strong>{child.name}</strong><small>{child.kind}</small></button>)}</div></section>}
      <DetailItemsBrowser items={contents.items} groupMode="category" emptyText="Scan this Place’s QR later to add Items directly here." onOpenItem={onOpenItem} busy={busy} />
      {quickPhotos && <QuickPhotoSession title={currentLocation.name} items={missingPhotoItems} onDone={async () => { setQuickPhotos(false); await load(); }} onClose={() => setQuickPhotos(false)} />}
      {aiScanOpen && <AIScanSession location={currentLocation} onClose={() => setAiScanOpen(false)} />}
    </section>
  );
}

type LocalAIScan = {
  id: string;
  preview: string;
  status: "uploading" | "queued" | "error";
  error?: string;
};

function AIScanSession({ location, onClose }: {
  location: LocationNode;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const pulseTimerRef = useRef<number | null>(null);
  const [scans, setScans] = useState<LocalAIScan[]>([]);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState("");
  const [pulse, setPulse] = useState(false);
  const uploading = scans.filter((entry) => entry.status === "uploading").length;
  const queued = scans.filter((entry) => entry.status === "queued").length;

  useEffect(() => {
    mountedRef.current = true;
    let stopped = false;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch {
        if (!stopped) setError("Live camera is unavailable. You can still use your phone’s camera below.");
      }
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Live camera is unavailable. You can still use your phone’s camera below.");
    } else {
      void startCamera();
    }
    return () => {
      stopped = true;
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewsRef.current.clear();
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    };
  }, []);

  function flash() {
    setPulse(true);
    if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setPulse(false);
      pulseTimerRef.current = null;
    }, 260);
  }

  function queue(blob: Blob, width?: number, height?: number) {
    const id = uid("ai-scan");
    const preview = URL.createObjectURL(blob);
    previewsRef.current.add(preview);
    setScans((current) => [{ id, preview, status: "uploading" as const }, ...current].slice(0, 12));
    flash();
    void api.createAiScan(location.public_id, blob, width, height).then(() => {
      if (!mountedRef.current) return;
      setScans((current) => current.map((entry) => entry.id === id ? { ...entry, status: "queued" } : entry));
    }).catch((reason) => {
      if (!mountedRef.current) return;
      setScans((current) => current.map((entry) => entry.id === id ? {
        ...entry,
        status: "error",
        error: reason instanceof Error ? reason.message : "Upload failed",
      } : entry));
    });
  }

  async function snap() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not capture photo")), "image/jpeg", 0.86),
    );
    queue(blob, width, height);
  }

  async function choosePhoto(file: File) {
    try {
      const resized = await resizePhoto(file);
      queue(resized.blob, resized.width, resized.height);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not prepare photo");
    }
  }

  return (
    <div className="quick-photo-backdrop ai-scan-backdrop" role="dialog" aria-modal="true" aria-label="AI scan mode">
      <section className="quick-photo-sheet ai-scan-sheet">
        <header><div><p className="eyebrow">AI SCAN</p><h2>{location.name}</h2><span>Photograph one item at a time. Keep snapping while AI works.</span></div><button className="icon-button" onClick={onClose} aria-label="Close AI scan mode"><Icon name="close" /></button></header>
        <div className={`quick-photo-camera ai-scan-camera ${pulse ? "pulsing" : ""}`}>
          <video ref={videoRef} playsInline muted />
          {!cameraReady && <div><Icon name="camera" size={38} /><strong>{error ? "Use phone camera below" : "Opening camera…"}</strong></div>}
          <div className="ai-scan-frame" aria-hidden="true"><span>One item</span></div>
        </div>
        {error && <div className="inline-alert">{error}</div>}
        <div className="ai-scan-status"><div><strong>{queued}</strong><span>sent to Inbox</span></div><div><strong>{uploading}</strong><span>{uploading === 1 ? "Uploading 1 photo" : `Uploading ${uploading} photos`}</span></div><small>{uploading ? "AI processing continues in the background." : "Review results in More → Inbox."}</small></div>
        {scans.length > 0 && <div className="ai-scan-strip">{scans.map((entry) => <div className={entry.status} key={entry.id}><img src={entry.preview} alt="AI scan capture" /><span>{entry.status === "uploading" ? "Sending" : entry.status === "queued" ? "Queued" : "Failed"}</span>{entry.error && <small>{entry.error}</small>}</div>)}</div>}
        <div className="ai-scan-controls"><label className="secondary button-with-icon"><Icon name="camera" size={18} />Phone camera<input type="file" accept="image/*" capture="environment" hidden onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void choosePhoto(file); }} /></label><button className="primary ai-shutter" disabled={!cameraReady} onClick={() => void snap()} aria-label="Photograph item"><Icon name="camera" size={24} />Snap item</button><button onClick={onClose}>Done</button></div>
      </section>
    </div>
  );
}

function QuickPhotoSession({ title, items, onDone, onClose }: {
  title: string;
  items: Item[];
  onDone: () => Promise<void> | void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const [index, setIndex] = useState(0);
  const [captured, setCaptured] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pulse, setPulse] = useState("");
  const remaining = items.filter((item) => !captured.has(item.public_id) && !skipped.has(item.public_id));
  const current = remaining[index] || remaining[0] || null;
  const upcoming = remaining.filter((item) => item.public_id !== current?.public_id).slice(0, 3);
  useEffect(() => {
    let stopped = false;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        if (!stopped) setError("Camera access is blocked or unavailable.");
      }
    }
    if (!navigator.mediaDevices?.getUserMedia) setError("Camera is not available in this browser.");
    else void startCamera();
    return () => {
      stopped = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    };
  }, []);
  async function finish() {
    await onDone();
  }
  function videoCropRect(video: HTMLVideoElement) {
    const frame = frameRef.current;
    if (!frame) {
      const side = Math.min(video.videoWidth, video.videoHeight);
      return { sx: (video.videoWidth - side) / 2, sy: (video.videoHeight - side) / 2, side };
    }
    const videoBox = video.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    const renderedScale = Math.max(videoBox.width / video.videoWidth, videoBox.height / video.videoHeight);
    const renderedWidth = video.videoWidth * renderedScale;
    const renderedHeight = video.videoHeight * renderedScale;
    const offsetX = videoBox.left + (videoBox.width - renderedWidth) / 2;
    const offsetY = videoBox.top + (videoBox.height - renderedHeight) / 2;
    const sx = (frameBox.left - offsetX) / renderedScale;
    const sy = (frameBox.top - offsetY) / renderedScale;
    const side = frameBox.width / renderedScale;
    const clampedSide = Math.max(1, Math.min(side, video.videoWidth, video.videoHeight));
    return {
      sx: Math.max(0, Math.min(video.videoWidth - clampedSide, sx)),
      sy: Math.max(0, Math.min(video.videoHeight - clampedSide, sy)),
      side: clampedSide,
    };
  }
  function showPulse(message: string) {
    setPulse(message);
    if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => {
      setPulse("");
      pulseTimerRef.current = null;
    }, 520);
  }
  async function skipCurrent() {
    if (!current || busy) return;
    showPulse("Skipped");
    setSkipped((currentSet) => new Set(currentSet).add(current.public_id));
    setIndex(0);
    if (remaining.length <= 1) await finish();
  }
  async function capture() {
    if (!current || !videoRef.current || busy) return;
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) return;
    setBusy(true);
    setError("");
    showPulse("Captured");
    try {
      const crop = videoCropRect(video);
      const scale = Math.min(1, 1200 / crop.side);
      const width = Math.max(1, Math.round(crop.side * scale));
      const height = width;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")?.drawImage(video, crop.sx, crop.sy, crop.side, crop.side, 0, 0, width, height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not capture photo")), "image/jpeg", 0.86),
      );
      await api.uploadPhoto(current, blob, width, height);
      showPulse("Uploaded");
      setCaptured((currentSet) => new Set(currentSet).add(current.public_id));
      setIndex(0);
      if (remaining.length <= 1) await finish();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Photo upload failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="quick-photo-backdrop" role="dialog" aria-modal="true" aria-label="Quick photo mode">
      <section className="quick-photo-sheet">
        <header><div><p className="eyebrow">QUICK PHOTOS</p><h2>{title}</h2><span>{current ? `${captured.size + skipped.size + 1} of ${items.length}` : "All photos done"}</span></div><button className="icon-button" onClick={onClose} aria-label="Close quick photo mode"><Icon name="close" /></button></header>
        <div className={`quick-photo-camera ${pulse ? "pulsing" : ""}`}><video ref={videoRef} playsInline muted />{current && <div ref={frameRef} className="thumbnail-frame" aria-hidden="true"><span>Thumbnail crop</span></div>}{pulse && <div className="quick-photo-pulse"><Icon name={pulse === "Skipped" ? "chevron" : "check"} size={24} /><span>{pulse}</span></div>}{!current && <div><Icon name="check" size={38} /><strong>All set</strong></div>}</div>
        {current ? <div className="quick-photo-item"><strong>{current.name}</strong><small>{categoryLabel(current) || "Uncategorised"} · {current.location_path}</small></div> : <button className="primary wide" onClick={() => void finish()}>Done</button>}
        {upcoming.length > 0 && <div className="quick-photo-queue"><strong>Next</strong>{upcoming.map((item) => <span key={item.public_id}>{item.name}</span>)}</div>}
        {error && <div className="inline-alert">{error}</div>}
        {current && <div className="quick-photo-controls"><button className="secondary" disabled={busy} onClick={() => void skipCurrent()}>Skip</button><button className="primary quick-shutter" disabled={busy || Boolean(error)} onClick={() => void capture()}><Icon name="camera" size={22} />{busy ? "Uploading..." : "Take photo"}</button></div>}
      </section>
    </div>
  );
}

async function resizePhoto(file: File): Promise<{ blob: Blob; width?: number; height?: number }> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not resize photo")), "image/jpeg", 0.84),
    );
    return { blob, width, height };
  } catch {
    return { blob: file };
  }
}

function findLocationChain(path: string, flatLocations: LocationNode[]): LocationNode[] {
  const parts = path.split(">").map((part) => part.trim()).filter(Boolean);
  const chain: LocationNode[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const partial = parts.slice(0, index + 1).join(" > ");
    const match = flatLocations.find((location) => location.path === partial);
    if (match) chain.push(match);
  }
  return chain;
}

function LocationCrumbs({ chain, fallback, onOpen, compact = false }: {
  chain: LocationNode[];
  fallback: string;
  onOpen: (publicId: string) => void;
  compact?: boolean;
}) {
  if (chain.length === 0) {
    return <span className="location-crumbs"><Icon name="pin" size={13} />{fallback || "Unassigned"}</span>;
  }
  return (
    <span className={`location-crumbs ${compact ? "compact" : ""}`}>
      <Icon name="pin" size={13} />
      {chain.map((location, index) => (
        <span key={location.public_id} className="crumb-part">
          {index > 0 && <span aria-hidden="true">/</span>}
          <button type="button" onClick={() => onOpen(location.public_id)}>{location.name}</button>
        </span>
      ))}
    </span>
  );
}

function CategoryCrumbs({ category, categories, onOpen }: {
  category: Category;
  categories: Category[];
  onOpen: (categoryId: number) => void;
}) {
  const chain: Category[] = [];
  let current: Category | undefined = category;
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parent_id === null ? undefined : categories.find((entry) => entry.id === current?.parent_id);
  }
  return (
    <span className="location-crumbs">
      <Icon name="tag" size={13} />
      {chain.map((entry, index) => (
        <span key={entry.id} className="crumb-part">
          {index > 0 && <span aria-hidden="true">/</span>}
          <button type="button" onClick={() => onOpen(entry.id)}>{entry.name}</button>
        </span>
      ))}
    </span>
  );
}

function DetailItemsBrowser({ items, groupMode, emptyText, onOpenItem, busy }: {
  items: Item[];
  groupMode: "category" | "location";
  emptyText: string;
  onOpenItem: (item: Item) => void;
  busy: boolean;
}) {
  const [sort, setSort] = useState<DetailItemSort>("name");
  const [view, setView] = useState<DetailItemView>("grid");
  const sortedItems = useMemo(() => {
    const next = [...items];
    next.sort((left, right) => {
      if (sort === "quantity-asc") return Number(left.quantity) - Number(right.quantity) || left.name.localeCompare(right.name);
      if (sort === "quantity-desc") return Number(right.quantity) - Number(left.quantity) || left.name.localeCompare(right.name);
      if (sort === "location") return left.location_path.localeCompare(right.location_path) || left.name.localeCompare(right.name);
      if (sort === "category") return categoryLabel(left).localeCompare(categoryLabel(right)) || left.name.localeCompare(right.name);
      return left.name.localeCompare(right.name);
    });
    return next;
  }, [items, sort]);
  const grouped = useMemo(() => {
    const groups = new Map<string, Item[]>();
    for (const item of sortedItems) {
      const label = groupMode === "category" ? categoryLabel(item) || "Uncategorised" : item.location_path || "Unassigned";
      groups.set(label, [...(groups.get(label) || []), item]);
    }
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [groupMode, sortedItems]);
  return (
    <section className="detail-section">
      <div className="section-heading detail-items-heading"><div><h2>Items here</h2><span>{items.length} item{items.length === 1 ? "" : "s"} including nested levels</span></div><div className="detail-item-controls"><select value={sort} onChange={(event) => setSort(event.target.value as DetailItemSort)} aria-label="Sort items"><option value="name">Name</option><option value="quantity-asc">Quantity low</option><option value="quantity-desc">Quantity high</option><option value="location">Location</option><option value="category">Category</option></select><div><button type="button" className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>Grid</button><button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")}>List</button></div></div></div>
      {items.length === 0 ? <EmptyState icon="box" title="No items here" text={emptyText} /> : grouped.map(([group, groupItems]) => <div className="detail-item-group" key={group}><h3>{group}<span>{groupItems.length}</span></h3><div className={view === "grid" ? "location-item-grid" : "location-item-list"}>{groupItems.map((item) => <button type="button" className={view === "grid" ? "location-item-card" : "location-item-row"} key={item.public_id} onClick={() => onOpenItem(item)} disabled={busy}>{item.primary_photo_url ? <img src={item.primary_photo_url} alt="" loading="lazy" /> : <span><Icon name="box" size={view === "grid" ? 24 : 18} /></span>}<strong>{item.name}</strong><small>{groupMode === "category" ? item.location_path : categoryLabel(item) || "Uncategorised"}</small><em>{item.quantity} {item.unit}</em></button>)}</div></div>)}
    </section>
  );
}

type PickerNode = {
  id: string;
  name: string;
  path: string;
  meta?: string;
  children: PickerNode[];
};

function locationPickerNodes(nodes: LocationNode[]): PickerNode[] {
  return nodes.map((node) => ({
    id: node.public_id,
    name: node.name,
    path: node.path,
    children: locationPickerNodes(node.children),
  }));
}

function categoryPickerNodes(categories: Category[]): PickerNode[] {
  const convert = (category: CategoryNode): PickerNode => ({
    id: String(category.id),
    name: category.name,
    path: categoryOptionLabel(category),
    meta: category.default_location ? `Default: ${category.default_location.name}` : undefined,
    children: category.children.map(convert),
  });
  return buildCategoryTree(categories).map(convert);
}

function findPickerNode(nodes: PickerNode[], id: string): PickerNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findPickerNode(node.children, id);
    if (child) return child;
  }
  return null;
}

function HierarchyPicker({ title, nodes, selectedId, emptyLabel, createPlaceholder, chooseLabel = "Choose", currentChooseLabel, onChoose, onCreate, onClose }: {
  title: string;
  nodes: PickerNode[];
  selectedId: string;
  emptyLabel: string;
  createPlaceholder?: string;
  chooseLabel?: string;
  currentChooseLabel?: string;
  onChoose: (id: string) => void;
  onCreate?: (parentId: string | null, name: string) => Promise<string>;
  onClose: () => void;
}) {
  const [path, setPath] = useState<string[]>([]);
  const [name, setName] = useState("");
  const current = path.length ? findPickerNode(nodes, path[path.length - 1]) : null;
  const children = current ? current.children : nodes;
  const selected = selectedId ? findPickerNode(nodes, selectedId) : null;
  async function createHere(event: FormEvent) {
    event.preventDefault();
    if (!onCreate) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = await onCreate(current?.id || null, trimmed);
    setName("");
    onChoose(id);
    onClose();
  }
  return (
    <div className="modal-backdrop picker-backdrop" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <article className="picker-sheet">
        <header><button className="icon-button" type="button" onClick={onClose} aria-label="Close picker"><Icon name="close" /></button><div><h2>{title}</h2><div className="picker-context"><span>{current ? current.path : "Top level"}</span>{selected && <span>Selected: {selected.path}</span>}</div></div></header>
        {path.length > 0 && <button className="text-button picker-back" type="button" onClick={() => setPath((currentPath) => currentPath.slice(0, -1))}>Back up</button>}
        {current && currentChooseLabel && <button className="primary picker-current-action" type="button" onClick={() => { onChoose(current.id); onClose(); }}>{currentChooseLabel}</button>}
        <div className="picker-list">
          {children.length === 0 && <div className="empty-inline"><span>{emptyLabel}</span></div>}
          {children.map((node) => <div className={`picker-row ${node.children.length === 0 ? "no-drill" : ""} ${selectedId === node.id ? "selected" : ""}`} key={node.id}><button type="button" onClick={() => { onChoose(node.id); onClose(); }}><strong>{node.name}</strong><small>{node.path}{node.meta ? ` · ${node.meta}` : ""}</small><em>{chooseLabel}</em></button>{node.children.length > 0 && <button type="button" aria-label={`Open ${node.name}`} onClick={() => setPath((currentPath) => [...currentPath, node.id])}><Icon name="chevron" size={16} /></button>}</div>)}
        </div>
        {onCreate && <form className="picker-create" onSubmit={createHere}><input value={name} onChange={(event) => setName(event.target.value)} placeholder={createPlaceholder} /><button className="secondary" disabled={!name.trim()}>Create here</button></form>}
      </article>
    </div>
  );
}

function offFieldLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function OffDataValue({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (value === null || value === undefined || value === "") return <span className="off-empty">—</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "string" || typeof value === "number") return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.every((entry) => ["string", "number", "boolean"].includes(typeof entry))) {
      return <div className="off-value-chips">{value.map((entry, index) => <span key={`${index}-${String(entry)}`}>{String(entry)}</span>)}</div>;
    }
    return <div className="off-nested-list">{value.map((entry, index) => <div key={index}><strong>#{index + 1}</strong><OffDataValue value={entry} depth={depth + 1} /></div>)}</div>;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (depth >= 3) return <pre>{JSON.stringify(value, null, 2)}</pre>;
    return <dl className="off-nested-data">{entries.map(([key, entry]) => <div key={key}><dt>{offFieldLabel(key)}</dt><dd><OffDataValue value={entry} depth={depth + 1} /></dd></div>)}</dl>;
  }
  return <span>{String(value)}</span>;
}

function ProductDataExplorer({ payload, onClose }: {
  payload: FullOffProduct;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const preferred = ["product_name", "brands", "quantity", "categories", "ingredients_text", "ingredients", "allergens", "traces", "nutriments", "nutriscore_grade", "nova_group", "environmental_score_grade"];
  const entries = Object.entries(payload.product).sort(([left], [right]) => {
    const leftRank = preferred.indexOf(left);
    const rightRank = preferred.indexOf(right);
    return (leftRank < 0 ? 999 : leftRank) - (rightRank < 0 ? 999 : rightRank) || left.localeCompare(right);
  });
  const term = query.trim().toLocaleLowerCase();
  const visible = entries.filter(([key, value]) => !term || `${key} ${JSON.stringify(value)}`.toLocaleLowerCase().includes(term));
  return <div className="modal-backdrop product-data-backdrop" role="dialog" aria-modal="true" aria-label="All Open Food Facts product data" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><article className="product-data-sheet"><header><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button><div><p className="eyebrow">{payload.source}</p><h2>All product data</h2><span>{entries.length} top-level fields</span></div>{payload.source_url && <a href={payload.source_url} target="_blank" rel="noreferrer">Open source</a>}</header><label className="search"><Icon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ingredients, allergens, nutrition, packaging…" /></label><div className="off-field-list">{visible.map(([key, value]) => <details key={key} open={preferred.includes(key)}><summary><strong>{offFieldLabel(key)}</strong><code>{key}</code></summary><div><OffDataValue value={value} /></div></details>)}</div></article></div>;
}

function ItemDetail({ item, allItems, locations, categories, units, busy, embedded = false, onClose, onChanged, onQuickAdjust, onQuickMove, onAddShopping, onMarkLost, onMarkFound, onForeverLost, onDeleteItem, onOpenLocation, onOpenTag, run }: {
  item: Item;
  allItems: Item[];
  locations: LocationNode[];
  categories: Category[];
  units: string[];
  busy: boolean;
  embedded?: boolean;
  onClose: () => void;
  onChanged: (item: Item) => Promise<void>;
  onQuickAdjust: (item: Item, delta: number) => Promise<void>;
  onQuickMove: (item: Item, destinationPublicId: string) => Promise<void>;
  onAddShopping: (item: Item) => Promise<void>;
  onMarkLost: (item: Item) => Promise<void>;
  onMarkFound: (item: Item) => Promise<void>;
  onForeverLost: (item: Item) => Promise<void>;
  onDeleteItem: (item: Item) => Promise<void>;
  onOpenLocation: (publicId: string) => void;
  onOpenTag: (tag: string) => void;
  run: (action: () => Promise<unknown>, success: string, scope?: RefreshScope, options?: ActionOptions) => Promise<void>;
}) {
  const photoRail = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [detailTab, setDetailTab] = useState<"overview" | "details" | "activity" | "more">("overview");
  const [picker, setPicker] = useState<"move" | "category" | "editCategory" | null>(null);
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description);
  const [notes, setNotes] = useState(item.notes);
  const [brand, setBrand] = useState(item.brand);
  const [model, setModel] = useState(item.model);
  const [serial, setSerial] = useState(item.serial_number);
  const [expiration, setExpiration] = useState(item.expiration_date || "");
  const [threshold, setThreshold] = useState(item.low_stock_threshold || "");
  const [unit, setUnit] = useState(item.unit);
  const [category, setCategory] = useState(item.category_id ? String(item.category_id) : "");
  const [tags, setTags] = useState(item.tags.join(", "));
  const [linksValue, setLinksValue] = useState(linkText(item.links || []));
  const [purchasePrice, setPurchasePrice] = useState(item.purchase_price_minor === null ? "" : String(item.purchase_price_minor / 100));
  const [estimatedPrice, setEstimatedPrice] = useState(item.estimated_price_minor === null ? "" : String(item.estimated_price_minor / 100));
  const [weight, setWeight] = useState(item.weight_g === null ? "" : String(item.weight_g));
  const [dimensions, setDimensions] = useState<string[]>(
    [item.length_mm, item.width_mm, item.height_mm].map((value) =>
      value === null ? "" : String(value),
    ),
  );
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [lots, setLots] = useState<ItemLot[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceTask[]>([]);
  const [lotQuantity, setLotQuantity] = useState("1");
  const [lotExpiration, setLotExpiration] = useState("");
  const [lotNote, setLotNote] = useState("");
  const [maintenanceTitle, setMaintenanceTitle] = useState("");
  const [maintenanceInterval, setMaintenanceInterval] = useState("30");
  const [maintenanceNotes, setMaintenanceNotes] = useState("");
  const [enrichment, setEnrichment] = useState<Enrichment>({ product: null, full_product_available: false, jobs: [], candidates: [] });
  const [showAllProductData, setShowAllProductData] = useState(false);
  const [fullProductData, setFullProductData] = useState<FullOffProduct | null>(null);
  const [related, setRelated] = useState<RelatedItem[]>([]);
  const [relatedGroupMode, setRelatedGroupMode] = useState<"category" | "location">("category");
  const [relatedQuery, setRelatedQuery] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [reservations, setReservations] = useState<ItemReservation[]>([]);
  const [defaultRules, setDefaultRules] = useState<LocationRule[]>([]);
  const [reservationProject, setReservationProject] = useState("");
  const [reservationQuantity, setReservationQuantity] = useState("1");
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const locationNodes = useMemo(() => locationPickerNodes(locations), [locations]);
  const categoryNodes = useMemo(() => categoryPickerNodes(categories), [categories]);
  const locationChain = useMemo(() => findLocationChain(item.location_path, flatLocations), [flatLocations, item.location_path]);
  const detailCapabilities = capabilitiesForCategory(categories, item.category_id);
  const editCapabilities = capabilitiesForCategory(categories, category);

  useEffect(() => {
    if (embedded && window.matchMedia("(min-width: 1100px)").matches) return;
    const scrollTop = window.scrollY;
    const previous = {
      bodyOverflow: document.body.style.overflow,
      bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top,
      bodyWidth: document.body.style.width,
    };
    document.documentElement.classList.add("item-detail-open");
    document.body.classList.add("item-detail-open");
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollTop}px`;
    document.body.style.width = "100%";
    return () => {
      document.documentElement.classList.remove("item-detail-open");
      document.body.classList.remove("item-detail-open");
      document.body.style.overflow = previous.bodyOverflow;
      document.body.style.position = previous.bodyPosition;
      document.body.style.top = previous.bodyTop;
      document.body.style.width = previous.bodyWidth;
      window.scrollTo(0, scrollTop);
    };
  }, [embedded]);

  useEffect(() => {
    if (photos.length) photoRail.current?.scrollTo({ left: 0 });
  }, [photos.length]);
  const editingCategory = category ? categories.find((entry) => String(entry.id) === category) || null : null;
  const activeProjects = useMemo(() => projects.filter((project) => project.status === "active"), [projects]);
  const showBatchData = detailCapabilities.batches;
  const showMaintenanceData = detailCapabilities.maintenance || maintenance.length > 0;
  const showReservationData = reservations.length > 0;
  const itemLinks = item.links || [];
  const showLinksData = detailCapabilities.links || itemLinks.length > 0;
  const showEnrichmentData = detailCapabilities.enrichment;
  const itemDefaultRule = defaultRules.find((rule) => (
    rule.rule_type === (item.barcode ? "barcode" : "name") &&
    rule.match_value.toLocaleLowerCase() === (item.barcode || item.name).toLocaleLowerCase()
  )) || null;
  const relatedIds = useMemo(() => new Set(related.map((entry) => entry.public_id)), [related]);
  const relatedCandidates = useMemo(() => {
    const query = relatedQuery.trim().toLocaleLowerCase();
    return allItems
      .filter((entry) => entry.public_id !== item.public_id && !relatedIds.has(entry.public_id))
      .filter((entry) => {
        if (!query) return true;
        return [
          entry.name,
          entry.location_path,
          categoryLabel(entry),
          entry.brand,
          entry.model,
          ...entry.tags,
        ].join(" ").toLocaleLowerCase().includes(query);
      })
      .slice(0, 8);
  }, [allItems, item.public_id, relatedIds, relatedQuery]);
  const relatedGroups = useMemo(() => {
    const groups = new Map<string, RelatedItem[]>();
    for (const entry of related) {
      const label = relatedGroupMode === "category"
        ? categoryLabel(entry) || "Uncategorised"
        : entry.location_path || "Unassigned";
      groups.set(label, [...(groups.get(label) || []), entry]);
    }
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [related, relatedGroupMode]);

  const loadExtras = useCallback(async () => {
    try {
      const [detail, nextProjects, nextRules] = await Promise.all([api.itemDetail(item.public_id), api.projects(), api.locationRules()]);
      setHistory(detail.history);
      setPhotos(detail.photos);
      setEnrichment(detail.enrichment);
      setLots(detail.lots);
      setMaintenance(detail.maintenance);
      setReservations(detail.reservations);
      setRelated(detail.related);
      setProjects(nextProjects);
      setDefaultRules(nextRules);
      setReservationProject((current) => (
        current && nextProjects.some((project) => project.public_id === current && project.status === "active")
          ? current
          : nextProjects.find((project) => project.status === "active")?.public_id || ""
      ));
    } catch {
      // The core item is already visible; keep the sheet usable if optional data fails.
    }
  }, [item.public_id]);
  useEffect(() => { void loadExtras(); }, [loadExtras]);
  useEffect(() => {
    if (embedded && window.matchMedia("(min-width: 1100px)").matches) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [embedded, onClose]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const updated = await api.updateItem(item, {
      name,
      description,
      notes,
      brand: editCapabilities.identity ? brand : "",
      model: editCapabilities.specs ? model : "",
      unit,
      serial_number: editCapabilities.identity ? serial : "",
      expiration_date: editCapabilities.expiration ? expiration || null : null,
      low_stock_threshold: threshold || null,
      category_id: category ? Number(category) : null,
      purchase_price_minor: editCapabilities.price && purchasePrice ? Math.round(Number(purchasePrice) * 100) : null,
      purchase_currency: editCapabilities.price && purchasePrice ? "EUR" : null,
      estimated_price_minor: editCapabilities.price && estimatedPrice ? Math.round(Number(estimatedPrice) * 100) : null,
      estimated_price_currency: editCapabilities.price && estimatedPrice ? "EUR" : null,
      weight_g: editCapabilities.specs && weight ? Number(weight) : null,
      length_mm: editCapabilities.specs && dimensions[0] !== "" ? Number(dimensions[0]) : null,
      width_mm: editCapabilities.specs && dimensions[1] !== "" ? Number(dimensions[1]) : null,
      height_mm: editCapabilities.specs && dimensions[2] !== "" ? Number(dimensions[2]) : null,
      links: editCapabilities.links ? parseLinkText(linksValue) : [],
    });
    const tagged = await api.setTags(updated, tags.split(",").map((tag) => tag.trim()).filter(Boolean));
    await onChanged(tagged);
    setEditing(false);
  }

  async function upload(file: File) {
    const resized = await resizePhoto(file);
    await api.uploadPhoto(item, resized.blob, resized.width, resized.height);
    await loadExtras();
  }

  async function addLot(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.createLot(item, {
        quantity: lotQuantity,
        expiration_date: lotExpiration || null,
        note: lotNote,
      });
      const refreshed = await api.item(item.public_id);
      await onChanged(refreshed);
      await loadExtras();
    }, "Batch added");
    setLotQuantity("1");
    setLotExpiration("");
    setLotNote("");
  }

  async function addMaintenance(event: FormEvent) {
    event.preventDefault();
    const interval = Math.max(1, Number(maintenanceInterval) || 30);
    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + interval);
    await run(async () => {
      await api.createMaintenance(item, {
        title: maintenanceTitle,
        notes: maintenanceNotes,
        interval_days: interval,
        last_completed_at: null,
        next_due_at: nextDue.toISOString().slice(0, 10),
      });
      await loadExtras();
    }, "Maintenance task added");
    setMaintenanceTitle("");
    setMaintenanceInterval("30");
    setMaintenanceNotes("");
  }

  async function addReservation(event: FormEvent) {
    event.preventDefault();
    const project = activeProjects.find((entry) => entry.public_id === reservationProject);
    if (!project) return;
    await run(async () => {
      await api.reserveItem(project, item, reservationQuantity);
      await loadExtras();
    }, "Reservation saved");
  }

  async function removeReservation(reservation: ItemReservation) {
    const project = projects.find((entry) => entry.public_id === reservation.project_public_id);
    if (!project) return;
    await run(async () => {
      await api.removeReservation(project, item.public_id);
      await loadExtras();
    }, "Reservation removed");
  }

  async function addRelatedItem(relatedItem: Item) {
    await run(async () => {
      await api.relateItem(item, relatedItem.public_id);
      setRelatedQuery("");
      await loadExtras();
    }, "Related item linked", "inventory");
  }

  async function removeRelatedItem(relatedItem: RelatedItem) {
    await run(async () => {
      await api.deleteRelationship(item, relatedItem.relationship_public_id);
      await loadExtras();
    }, "Related item removed", "inventory");
  }

  async function setItemDefault() {
    await run(async () => {
      await api.setDefaultLocation(item, item.location_public_id);
      setDefaultRules(await api.locationRules());
    }, "Default location saved for future adds");
  }

  async function removeItemDefault(rule: LocationRule) {
    if (!window.confirm(`Delete this ${rule.rule_type} default?\n\n${rule.match_value} → ${rule.location_name}`)) return;
    await run(async () => {
      await api.deleteLocationRule(rule.public_id);
      setDefaultRules(await api.locationRules());
    }, "Default location removed");
  }

  async function openAllProductData() {
    try {
      setFullProductData(await api.fullEnrichment(item));
      setShowAllProductData(true);
    } catch {
      run(async () => {
        await api.queueEnrichment(item);
        await api.runEnrichment();
        await loadExtras();
        setFullProductData(await api.fullEnrichment(item));
        setShowAllProductData(true);
      }, "Full Open Food Facts data downloaded");
    }
  }

  const lost = hasLostTag(item);
  const brandPrefix = item.brand.trim() && !item.name.trim().toLocaleLowerCase().startsWith(item.brand.trim().toLocaleLowerCase())
    ? item.brand.trim()
    : "";

  async function moveToLocation(locationPublicId: string) {
    if (locationPublicId === item.location_public_id) return;
    await onQuickMove(item, locationPublicId);
  }

  async function changeCategory(categoryId: string) {
    const nextCategoryId = categoryId ? Number(categoryId) : null;
    if ((item.category_id ?? null) === nextCategoryId) return;
    await run(async () => {
      const updated = await api.updateItem(item, { category_id: nextCategoryId });
      await onChanged(updated);
    }, "Category updated", "inventory");
  }

  const desktopEmbedded = embedded && window.matchMedia("(min-width: 1100px)").matches;
  return (
    <div className={embedded ? "embedded-item-detail item-detail-backdrop" : "modal-backdrop item-detail-backdrop"} role="dialog" aria-modal={desktopEmbedded ? undefined : "true"} aria-label={item.name} onMouseDown={(event) => { if (!desktopEmbedded && event.target === event.currentTarget) onClose(); }}>
      <article className="detail-sheet">
        <div className="sheet-handle" aria-hidden="true" />
        <header className="detail-header"><button className="icon-button" onClick={onClose} aria-label="Close item"><Icon name="close" /></button><div><small>{categoryLabel(item) || "Uncategorised"}</small><h1>{brandPrefix && <span className="item-brand-prefix">{brandPrefix} </span>}{item.name}</h1><LocationCrumbs chain={locationChain} fallback={item.location_path} onOpen={onOpenLocation} /></div><button className="text-button" onClick={() => setEditing(!editing)}>{editing ? "Cancel" : "Edit"}</button></header>
        {(detailCapabilities.photos || photos.length > 0) && <section className="detail-photo-hero" aria-label="Item photos">
          <div className="detail-photo-rail" ref={photoRail}>
            {photos.map((photo, index) => <figure key={photo.public_id}><img src={photo.url} alt={`${item.name} photo ${index + 1}`} /><button aria-label={`Delete photo ${index + 1}`} onClick={() => run(() => api.deletePhoto(photo).then(loadExtras), "Photo removed")}><Icon name="close" size={15} /></button></figure>)}
            {detailCapabilities.photos && <label className="photo-add-tile"><Icon name="camera" size={28} /><span>{photos.length ? "Add photo" : "Add a photo"}</span><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} /></label>}
          </div>
        </section>}
        {editing ? (
          <form className="form-card" onSubmit={save}>
            <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
            <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
            {(editCapabilities.identity || editCapabilities.specs) && <div className="form-row">{editCapabilities.identity && <label>Brand<input value={brand} onChange={(event) => setBrand(event.target.value)} /></label>}{editCapabilities.specs && <label>Model<input value={model} onChange={(event) => setModel(event.target.value)} /></label>}</div>}
            {editCapabilities.identity && <label>Serial number<input value={serial} onChange={(event) => setSerial(event.target.value)} /></label>}
            <div className="form-row">{editCapabilities.expiration && <label>Expiration<input type="date" value={expiration} onChange={(event) => setExpiration(event.target.value)} /></label>}<label>Low stock at<input inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label></div>
            <label>Unit<select value={unit} onChange={(event) => setUnit(event.target.value)}>{units.includes(unit) ? null : <option value={unit}>{unit}</option>}{units.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
            <div className="picker-field"><span>Category</span><button type="button" onClick={() => setPicker("editCategory")}><Icon name="tag" size={16} /><strong>{editingCategory ? categoryOptionLabel(editingCategory) : "No category"}</strong></button>{category && <button type="button" className="text-button" onClick={() => setCategory("")}>Clear category</button>}</div>
            <label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="electronics, project, spare" /></label>
            {editCapabilities.links && <label>Links<textarea rows={3} value={linksValue} onChange={(event) => setLinksValue(event.target.value)} placeholder="Manual | https://example.com/manual.pdf" /></label>}
            {editCapabilities.price && <div className="form-row"><label>Purchase price (€)<input inputMode="decimal" value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} /></label><label>Current estimate (€)<input inputMode="decimal" value={estimatedPrice} onChange={(event) => setEstimatedPrice(event.target.value)} /></label></div>}
            {editCapabilities.specs && <><label>Weight (g)<input inputMode="numeric" value={weight} onChange={(event) => setWeight(event.target.value)} /></label><div className="form-row dimensions"><label>Length mm<input inputMode="numeric" value={dimensions[0]} onChange={(event) => setDimensions([event.target.value, dimensions[1], dimensions[2]])} /></label><label>Width mm<input inputMode="numeric" value={dimensions[1]} onChange={(event) => setDimensions([dimensions[0], event.target.value, dimensions[2]])} /></label><label>Height mm<input inputMode="numeric" value={dimensions[2]} onChange={(event) => setDimensions([dimensions[0], dimensions[1], event.target.value])} /></label></div></>}
            <button className="primary wide" disabled={busy}>Save changes</button>
          </form>
        ) : (
          <>
            <nav className="detail-tabs" role="tablist" aria-label="Item sections">{(["overview", "details", "activity", "more"] as const).map((tab) => <button type="button" role="tab" aria-selected={detailTab === tab} className={detailTab === tab ? "active" : ""} key={tab} onClick={() => setDetailTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}{tab === "activity" && history.length > 0 ? <span>{history.length}</span> : null}</button>)}</nav>
            <div className="detail-tab-panel" hidden={detailTab !== "overview"}>
            {(item.expiration_date || item.barcode) && <div className="detail-facts compact-facts">{item.expiration_date && <div><span>Next expiry</span><strong>{item.expiration_date}</strong>{expirationState(item) && <small className="fact-warning">{expirationState(item) === "expired" ? "Expired" : "Use within 7 days"}</small>}</div>}{item.barcode && <div className="barcode-fact"><span>Barcode</span><BarcodeGraphic value={item.barcode} /></div>}</div>}
            {item.tags.length > 0 && <section className="detail-section tag-section"><div className="section-heading"><div><h2>Tags</h2></div></div><div className="tag-list">{item.tags.map((tag) => <button type="button" key={tag} onClick={() => onOpenTag(tag)}><Icon name="tag" size={13} /><span>{tag}</span></button>)}</div></section>}
            {(item.description || item.notes || item.model) && <div className="prose">{item.model && <p className="product-identity">{item.model}</p>}{item.description && <p>{item.description}</p>}{item.notes && <p><strong>Notes</strong><br />{item.notes}</p>}</div>}
            {(!photos.length || item.location_public_id === "unassigned" || item.low_stock_threshold === null) && <section className="detail-prompts"><strong>Complete this item</strong><div>{!photos.length && detailCapabilities.photos && <label><Icon name="camera" size={15} />Add photo<input type="file" accept="image/*" capture="environment" hidden onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} /></label>}{item.location_public_id === "unassigned" && <button onClick={() => setPicker("move")}><Icon name="pin" size={15} />Choose location</button>}{item.low_stock_threshold === null && <button onClick={() => { setThreshold("1"); setEditing(true); }}><Icon name="minus" size={15} />Set low stock</button>}</div></section>}
            </div>
            <div className="detail-tab-panel" hidden={detailTab !== "details"}>
            {showLinksData && <section className="detail-section"><div className="section-heading"><div><h2>Links</h2><span>{itemLinks.length ? `${itemLinks.length} saved` : "Manuals, datasheets, and references"}</span></div>{detailCapabilities.links && <button type="button" className="text-button" onClick={() => setEditing(true)}>{itemLinks.length ? "Edit" : "Add link"}</button>}</div>{itemLinks.length ? <div className="link-list">{itemLinks.map((link, index) => <a key={`${index}-${link.url}`} href={link.url} target="_blank" rel="noreferrer"><Icon name="spark" size={14} /><span>{link.label}</span></a>)}</div> : <div className="empty-inline"><span>No links yet</span></div>}</section>}
            {showReservationData && <section className="detail-section"><div className="section-heading"><div><h2>Reservations</h2><span>{reservations.length ? `${reservations.length} project hold${reservations.length === 1 ? "" : "s"}` : "No project holds yet"}</span></div></div><div className="reservation-list">{reservations.length === 0 && <div className="empty-inline"><span>Nothing reserved</span></div>}{reservations.map((reservation) => <div className="reservation" key={reservation.project_public_id}><span>{reservation.project_name}</span><small>{reservation.quantity} {reservation.unit} · {reservation.project_status}</small><button aria-label={`Remove ${reservation.project_name} reservation`} onClick={() => void removeReservation(reservation)}><Icon name="close" size={15} /></button></div>)}</div>{detailCapabilities.reservation && activeProjects.length > 0 && <form className="inline-lot-form" onSubmit={addReservation}><select value={reservationProject} onChange={(event) => setReservationProject(event.target.value)} aria-label="Project">{activeProjects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}</select><input inputMode="decimal" value={reservationQuantity} onChange={(event) => setReservationQuantity(event.target.value)} aria-label="Reservation quantity" /><button className="secondary" disabled={!reservationProject || !reservationQuantity.trim()}>Reserve</button></form>}{detailCapabilities.reservation && activeProjects.length === 0 && <div className="empty-inline"><span>Create an active project to reserve this item</span></div>}</section>}
            {showBatchData && <section className="detail-section"><div className="section-heading"><div><h2>Expiration batches</h2><span>{lots.length ? `${lots.length} batch${lots.length === 1 ? "" : "es"}` : "Track multiple dates for one item"}</span></div></div><div className="lot-list">{lots.length === 0 && <div className="empty-inline"><span>No batches recorded</span></div>}{lots.map((lot) => <div className="lot-row" key={lot.public_id}><div><strong>{lot.quantity} {item.unit}</strong><small>{lot.expiration_date ? `Expires ${lot.expiration_date}` : "No expiration date"}</small>{lot.note && <em>{lot.note}</em>}</div><button aria-label="Remove batch" onClick={() => run(async () => { await api.deleteLot(item, lot); const refreshed = await api.item(item.public_id); await onChanged(refreshed); await loadExtras(); }, "Batch removed")}><Icon name="close" size={14} /></button></div>)}</div>{detailCapabilities.batches && <form className="inline-lot-form" onSubmit={addLot}><input inputMode="decimal" value={lotQuantity} onChange={(event) => setLotQuantity(event.target.value)} aria-label="Batch quantity" /><input type="date" value={lotExpiration} onChange={(event) => setLotExpiration(event.target.value)} aria-label="Batch expiration date" /><input value={lotNote} onChange={(event) => setLotNote(event.target.value)} placeholder="batch note" aria-label="Batch note" /><button className="secondary" disabled={!lotQuantity}>Add batch</button></form>}</section>}
            {showMaintenanceData && <section className="detail-section"><div className="section-heading"><div><h2>Maintenance</h2><span>{maintenance.length ? `${maintenance.length} recurring task${maintenance.length === 1 ? "" : "s"}` : "Optional schedules for tools and equipment"}</span></div></div><div className="maintenance-list">{maintenance.length === 0 && <div className="empty-inline"><span>No maintenance tasks</span></div>}{maintenance.map((task) => <article className={`maintenance-row ${new Date(`${task.next_due_at}T23:59:59`).getTime() < Date.now() ? "overdue" : ""}`} key={task.public_id}><div><strong>{task.title}</strong><small>Every {task.interval_days} days · next {task.next_due_at}</small>{task.notes && <p>{task.notes}</p>}</div><button className="secondary" onClick={() => run(async () => { await api.completeMaintenance(item, task); await loadExtras(); }, "Maintenance completed")}>Done</button></article>)}</div>{detailCapabilities.maintenance && <form className="maintenance-form" onSubmit={addMaintenance}><input required value={maintenanceTitle} onChange={(event) => setMaintenanceTitle(event.target.value)} placeholder="Lube rails" aria-label="Maintenance title" /><input inputMode="numeric" value={maintenanceInterval} onChange={(event) => setMaintenanceInterval(event.target.value)} aria-label="Interval days" /><input value={maintenanceNotes} onChange={(event) => setMaintenanceNotes(event.target.value)} placeholder="notes" aria-label="Maintenance notes" /><button className="secondary" disabled={!maintenanceTitle.trim()}>Add task</button></form>}</section>}
            <details className="detail-section related-section"><summary><span><h2>Open related</h2><small>{related.length ? `${related.length} linked item${related.length === 1 ? "" : "s"}` : "Link tools, parts, accessories, and consumables"}</small></span><Icon name="chevron" size={16} /></summary><div className="related-controls"><div><button className={relatedGroupMode === "category" ? "active" : ""} onClick={() => setRelatedGroupMode("category")}>By category</button><button className={relatedGroupMode === "location" ? "active" : ""} onClick={() => setRelatedGroupMode("location")}>By location</button></div><input value={relatedQuery} onChange={(event) => setRelatedQuery(event.target.value)} placeholder="Find item to relate" aria-label="Find related item" /></div>{relatedQuery.trim() && <div className="related-candidates">{relatedCandidates.length === 0 && <div className="empty-inline"><span>No matching items</span></div>}{relatedCandidates.map((candidate) => <button key={candidate.public_id} onClick={() => void addRelatedItem(candidate)}><Icon name="plus" size={15} /><span><strong>{candidate.name}</strong><small>{categoryLabel(candidate) || "Uncategorised"} · {candidate.location_path}</small></span></button>)}</div>}{relatedGroups.length === 0 ? <div className="empty-inline"><span>No related items yet</span></div> : <div className="related-groups">{relatedGroups.map(([group, entries]) => <div className="related-group" key={group}><h3>{group}<span>{entries.length}</span></h3>{entries.map((entry) => <article className="related-item-row" key={entry.relationship_public_id}>{entry.primary_photo_url ? <img src={entry.primary_photo_url} alt="" /> : <span><Icon name="box" size={18} /></span>}<div><strong>{entry.name}</strong><small>{relatedGroupMode === "category" ? entry.location_path : categoryLabel(entry) || "Uncategorised"} · {entry.quantity} {entry.unit}</small></div><button aria-label={`Remove ${entry.name} relation`} onClick={() => void removeRelatedItem(entry)}><Icon name="close" size={14} /></button></article>)}</div>)}</div>}</details>
            </div>
            <div className="detail-tab-panel" hidden={detailTab !== "more"}>
            <section className="detail-section qr-section"><div><h2>QR label</h2><p>Print or scan to open this item.</p></div><a href={`/api/v1/labels/items/${item.public_id}`} target="_blank" rel="noreferrer"><img src={`/api/v1/qr/items/${item.public_id}.svg`} alt={`QR code for ${item.name}`} /></a></section>
            </div>
            <div className="detail-tab-panel" hidden={detailTab !== "details"}>
            {showEnrichmentData && <details className="detail-section enrichment-section">
              <summary>
                <span><h2>Open Food Facts</h2><small>{enrichment.product ? "Ingredients, nutrition, and source data" : "Optional external product lookup"}</small></span>
                <Icon name="chevron" size={16} />
              </summary>
              <div className="enrichment-content">
                {detailCapabilities.enrichment && <div className="enrichment-toolbar"><button className="text-button" onClick={() => run(async () => { await api.queueEnrichment(item); await api.runEnrichment(); await loadExtras(); }, "Product lookup completed")}>Look up data</button></div>}
                {enrichment.product && <div className="enrichment-product">
                  <strong>{enrichment.product.name || item.name}</strong>
                  <small>{[enrichment.product.brand, enrichment.product.package_quantity].filter(Boolean).join(" · ") || "Product details saved"}</small>
                  <div className="off-source-actions">
                    {enrichment.product.source_url && <a href={enrichment.product.source_url} target="_blank" rel="noreferrer">View source</a>}
                    <button type="button" className="off-data-button" onClick={() => void openAllProductData()}>{enrichment.full_product_available ? "Show all Open Food Facts data" : "Download all Open Food Facts data"}</button>
                  </div>
                  {[enrichment.product.nutriscore_grade && `Nutri-Score ${enrichment.product.nutriscore_grade.toUpperCase()}`, enrichment.product.nova_group && `NOVA ${enrichment.product.nova_group}`, enrichment.product.ecoscore_grade && `Eco ${enrichment.product.ecoscore_grade.toUpperCase()}`].filter(Boolean).length > 0 && <div className="nutrition-badges">{[enrichment.product.nutriscore_grade && `Nutri-Score ${enrichment.product.nutriscore_grade.toUpperCase()}`, enrichment.product.nova_group && `NOVA ${enrichment.product.nova_group}`, enrichment.product.ecoscore_grade && `Eco ${enrichment.product.ecoscore_grade.toUpperCase()}`].filter(Boolean).map((label) => <span key={String(label)}>{label}</span>)}</div>}
                  {enrichment.product.ingredients_text && <p className="ingredients-text"><strong>Ingredients</strong>{enrichment.product.ingredients_text}</p>}
                  {Object.keys(enrichment.product.nutrition || {}).length > 0 && <><p className="nutrition-heading">Nutrition per 100 g/ml</p><dl className="nutrition-grid">{Object.entries(enrichment.product.nutrition).map(([key, value]) => <div key={key}><dt>{nutritionLabel(key)}</dt><dd>{nutritionValueLabel(key, value)}</dd></div>)}</dl></>}
                </div>}
                {enrichment.candidates.filter((candidate) => candidate.status === "proposed" && Object.keys(candidate.proposed).length > 0).map((candidate) => <div className="candidate" key={candidate.public_id}><div><strong>{candidate.source_label}</strong><dl>{Object.entries(candidate.proposed).map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{String(value)}</dd></div>)}</dl>{candidate.source_url && <a href={candidate.source_url} target="_blank" rel="noreferrer">View source</a>}</div><button className="primary" onClick={() => run(() => api.applyEnrichment(candidate.public_id).then(onChanged).then(loadExtras), "Enrichment applied")}>Apply</button></div>)}
              </div>
            </details>}
            </div>
            <div className="detail-tab-panel" hidden={detailTab !== "activity"}>
            <details className="detail-section history-section"><summary><span><h2>History</h2><small>Permanent activity log</small></span><Icon name="chevron" size={16} /></summary><div className="event-list">{history.length ? history.map((event) => <div className="event" key={event.public_id}><span>{activityLabel(event.action)}</span><strong>{event.quantity_delta ? `${Number(event.quantity_delta) > 0 ? "+" : ""}${event.quantity_delta}` : event.to_location || "Changed"}</strong><time>{new Date(`${event.created_at}Z`).toLocaleString()}</time></div>) : <div className="empty-inline"><span>No changes recorded yet</span></div>}</div></details>
            </div>
            <div className="detail-tab-panel" hidden={detailTab !== "more"}>
            <div className={`lost-controls ${lost ? "active" : ""}`}><div><strong>{lost ? "Marked lost" : "Item actions"}</strong><small>{lost ? "Keep it here until it turns up, or let it go forever." : "Move, categorise, shop, and manage this item."}</small></div><div><button className="secondary" disabled={busy} onClick={() => setPicker("move")}><Icon name="pin" size={15} />Move</button><button className="secondary" disabled={busy} onClick={() => setPicker("category")}><Icon name="tag" size={15} />Category</button>{itemDefaultRule ? <button className="secondary" disabled={busy} onClick={() => void removeItemDefault(itemDefaultRule)}><Icon name="close" size={15} />Delete default ({itemDefaultRule.rule_type}: {itemDefaultRule.match_value})</button> : <button className="secondary" disabled={busy} onClick={() => void setItemDefault()}><Icon name="pin" size={15} />Set default</button>}{detailCapabilities.shopping_list && <button className="secondary" disabled={busy} onClick={() => void onAddShopping(item)}><Icon name="plus" size={15} />Add to shopping list</button>}{item.low_stock_threshold === null && <button className="secondary" disabled={busy} onClick={() => { setThreshold("1"); setEditing(true); }}><Icon name="minus" size={15} />Set low stock</button>}{lost ? <><button className="secondary" disabled={busy} onClick={() => void onMarkFound(item)}><Icon name="check" size={15} />Found</button><button disabled={busy} onClick={() => void onForeverLost(item)}><Icon name="close" size={15} />Forever lost</button></> : <button disabled={busy} onClick={() => void onMarkLost(item)}><Icon name="search" size={15} />Mark lost</button>}</div></div>
            <section className="danger-zone"><div><strong>Remove item</strong><small>Archive keeps history. Delete removes this item permanently.</small></div><div className="danger-actions"><button disabled={busy} onClick={() => { if (window.confirm(`Archive ${item.name}? It will disappear from regular search but remain in history and exports.`)) void run(() => api.archive(item).then(onClose), `${item.name} archived`); }}>Archive</button><button disabled={busy} onClick={() => void onDeleteItem(item)}>Delete</button></div></section>
            </div>
            <div className="detail-primary-actions" aria-label="Primary item actions"><button disabled={Number(item.quantity) <= 0} onClick={() => void onQuickAdjust(item, -1)} aria-label="Remove one"><Icon name="minus" size={17} /></button><strong>{item.quantity} {item.unit}</strong><button onClick={() => void onQuickAdjust(item, 1)} aria-label="Add one"><Icon name="plus" size={17} /></button><button onClick={() => setPicker("move")}><Icon name="pin" size={16} /><span>Move</span></button><button onClick={() => setEditing(true)}><Icon name="settings" size={16} /><span>Edit</span></button><button onClick={() => setDetailTab("more")}><Icon name="more" size={16} /><span>More</span></button></div>
          </>
        )}
        {picker === "move" && <HierarchyPicker title="Move item" nodes={locationNodes} selectedId={item.location_public_id} emptyLabel="No child locations here" chooseLabel="Move here" currentChooseLabel="Move here" onChoose={(id) => { void moveToLocation(id); }} onClose={() => setPicker(null)} />}
        {picker === "category" && <HierarchyPicker title="Change category" nodes={categoryNodes} selectedId={item.category_id ? String(item.category_id) : ""} emptyLabel="No child categories here" chooseLabel="Use category" currentChooseLabel="Use this category" onChoose={(id) => { void changeCategory(id); }} onClose={() => setPicker(null)} />}
        {picker === "editCategory" && <HierarchyPicker title="Choose category" nodes={categoryNodes} selectedId={category} emptyLabel="No child categories here" chooseLabel="Use category" currentChooseLabel="Use this category" onChoose={(id) => setCategory(id)} onClose={() => setPicker(null)} />}
      </article>
      {showAllProductData && fullProductData && <ProductDataExplorer payload={fullProductData} onClose={() => setShowAllProductData(false)} />}
    </div>
  );
}

type ScannedEntry = {
  id: string;
  code: string;
  status: "looking_up" | "ready" | "error";
  error: string;
  result: BarcodeResult | null;
  name: string;
  brand: string;
  model: string;
  description: string;
  links_value: string;
  low_stock_threshold: string;
  quantity: string;
  unit: string;
  location_public_id: string;
  category_id: string;
  expiration_date: string;
  image_url: string | null;
  save_image: boolean;
  photo_file: File | null;
  photo_preview: string | null;
};

type CaptureSessionDefaults = { location_public_id: string; category_id: string; unit: string };
type CaptureTemplate = CaptureSessionDefaults & { id: string; name: string; quantity: string };

const CAPTURE_DEFAULTS_KEY = "findstuff.capture.defaults.v1";
const CAPTURE_RECENTS_KEY = "findstuff.capture.recentLocations.v1";
const CAPTURE_TEMPLATES_KEY = "findstuff.capture.templates.v1";

function readLocalJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
  catch { return fallback; }
}

function defaultCaptureSession(initialLocation = "unassigned"): CaptureSessionDefaults {
  const saved = readLocalJson<Partial<CaptureSessionDefaults>>(CAPTURE_DEFAULTS_KEY, {});
  return {
    location_public_id: initialLocation !== "unassigned" ? initialLocation : saved.location_public_id || initialLocation,
    category_id: saved.category_id || "",
    unit: saved.unit || "pcs",
  };
}

function newScanId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `scan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultBarcodeName(code: string) {
  return `Product ${code}`;
}

function suggestScannedCategory(categories: Category[], product: BarcodeResult["product"]): string {
  if (!product) return "";
  const sourceLabels = product.categories.map((label) => label.replace(/^[a-z]{2}:/i, "").replaceAll("-", " ").toLocaleLowerCase());
  const sourceText = [product.name, ...sourceLabels].join(" ").toLocaleLowerCase();
  const ranked = categories.map((category) => {
    const categoryName = category.name.toLocaleLowerCase();
    const exact = sourceLabels.some((label) => label === categoryName || label.endsWith(` ${categoryName}`));
    const contained = sourceText.includes(categoryName);
    return { category, score: (exact ? 100 : contained ? 40 : 0) + category.depth };
  }).filter((entry) => entry.score > entry.category.depth).sort((left, right) => right.score - left.score);
  if (ranked[0]) return String(ranked[0].category.id);
  if (sourceText.match(/food|grocery|beverage|drink|nut|ingredient/)) {
    const grocery = categories.find((category) => /grocer|food/i.test(`${category.slug} ${category.name}`));
    if (grocery) return String(grocery.id);
  }
  return "";
}

function ScanView({ items, locations, categories, units, busy, initialMode, initialLocation, onOpenItem, onUseLocation, onCreateLocation, onCreateCategory, onCreate, onAdjust, onInventoryChanged }: {
  items: Item[];
  locations: LocationNode[];
  categories: Category[];
  units: string[];
  busy: boolean;
  initialMode: CaptureMode;
  initialLocation: string;
  onOpenItem: (id: string) => Promise<unknown>;
  onUseLocation: (id: string) => void;
  onCreateLocation: (body: { name: string; kind: string; parent_public_id: string | null }) => Promise<LocationNode>;
  onCreateCategory: (name: string, parentId: number | null) => Promise<Category>;
  onCreate: (body: Record<string, unknown>, imageUrl?: string, photoFile?: File) => Promise<Item>;
  onAdjust: (item: Item, delta: number) => Promise<void>;
  onInventoryChanged: () => Promise<void>;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const scannedRef = useRef<ScannedEntry[]>([]);
  const lookupInFlight = useRef<Set<string>>(new Set());
  const [code, setCode] = useState("");
  const [scanned, setScanned] = useState<ScannedEntry[]>([]);
  const [message, setMessage] = useState("");
  const [photoScanning, setPhotoScanning] = useState(false);
  const [savingCodes, setSavingCodes] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<{ id: string; type: "location" | "category" } | null>(null);
  const [mode, setMode] = useState<CaptureMode>(initialMode);
  const [sessionDefaults, setSessionDefaults] = useState<CaptureSessionDefaults>(() => defaultCaptureSession(initialLocation));
  const [recentLocationIds, setRecentLocationIds] = useState<string[]>(() => readLocalJson<string[]>(CAPTURE_RECENTS_KEY, []));
  const [templates, setTemplates] = useState<CaptureTemplate[]>(() => readLocalJson<CaptureTemplate[]>(CAPTURE_TEMPLATES_KEY, []));
  const [templateName, setTemplateName] = useState("");
  const [putawayPickerOpen, setPutawayPickerOpen] = useState(false);
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const locationNodes = useMemo(() => locationPickerNodes(locations), [locations]);
  const categoryNodes = useMemo(() => categoryPickerNodes(categories), [categories]);
  const secureCameraContext = window.isSecureContext;
  const lookingUp = scanned.some((entry) => entry.status === "looking_up");
  const pickerEntry = picker ? scanned.find((entry) => entry.id === picker.id) || null : null;
  const recentLocations = recentLocationIds.map((id) => flatLocations.find((entry) => entry.public_id === id)).filter((entry): entry is LocationNode => Boolean(entry)).slice(0, 5);

  useEffect(() => setMode(initialMode), [initialMode]);
  useEffect(() => {
    if (initialLocation && initialLocation !== "unassigned") {
      setSessionDefaults((current) => ({ ...current, location_public_id: initialLocation }));
    }
  }, [initialLocation]);

  useEffect(() => {
    scannedRef.current = scanned;
  }, [scanned]);

  function setScannedEntries(updater: (entries: ScannedEntry[]) => ScannedEntry[]) {
    setScanned((current) => {
      const next = updater(current);
      scannedRef.current = next;
      return next;
    });
  }

  function updateScannedEntry(codeValue: string, updater: (entry: ScannedEntry) => ScannedEntry) {
    setScannedEntries((entries) => entries.map((entry) => entry.code === codeValue ? updater(entry) : entry));
  }

  function makeEntry(changes: Partial<ScannedEntry> = {}, defaults: CaptureSessionDefaults = sessionDefaults): ScannedEntry {
    return {
      id: newScanId(),
      code: "",
      status: "ready",
      error: "",
      result: null,
      name: "",
      brand: "",
      model: "",
      description: "",
      links_value: "",
      low_stock_threshold: "",
      quantity: "1",
      unit: defaults.unit,
      location_public_id: defaults.location_public_id,
      category_id: defaults.category_id,
      expiration_date: "",
      image_url: null,
      save_image: false,
      photo_file: null,
      photo_preview: null,
      ...changes,
    };
  }

  function addBlankEntry(template?: CaptureTemplate, switchToQuick = true, defaults: CaptureSessionDefaults = sessionDefaults) {
    const entry = makeEntry(template ? {
      unit: template.unit,
      quantity: template.quantity,
      location_public_id: template.location_public_id,
      category_id: template.category_id,
    } : {}, defaults);
    setScannedEntries((entries) => [entry, ...entries]);
    if (switchToQuick) setMode("quick");
  }

  function rememberLocation(locationId: string) {
    if (!locationId || locationId === "unassigned") return;
    setRecentLocationIds((current) => {
      const next = [locationId, ...current.filter((id) => id !== locationId)].slice(0, 8);
      localStorage.setItem(CAPTURE_RECENTS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function setPutawayLocation(locationId: string) {
    setSessionDefaults((current) => ({ ...current, location_public_id: locationId }));
    rememberLocation(locationId);
    setScannedEntries((entries) => entries.map((entry) => ({ ...entry, location_public_id: locationId })));
    setPutawayPickerOpen(false);
    setMessage(`Put-away destination: ${flatLocations.find((entry) => entry.public_id === locationId)?.path || "selected location"}.`);
  }

  function queueBarcode(value: string) {
    const normalized = value.trim();
    const existing = scannedRef.current.find((entry) => entry.code === normalized);
    if (existing) {
      return false;
    }
    setScannedEntries((entries) => [makeEntry({
      code: normalized,
      status: "looking_up",
      name: defaultBarcodeName(normalized),
      location_public_id: mode === "putaway" ? sessionDefaults.location_public_id : sessionDefaults.location_public_id,
    }), ...entries]);
    return true;
  }

  async function lookupBarcode(value: string) {
    const normalized = value.trim();
    if (lookupInFlight.current.has(normalized)) return;
    lookupInFlight.current.add(normalized);
    try {
      const result = await api.barcode(normalized);
      if (mode === "consume") {
        if (result.existing_item && Number(result.existing_item.quantity) > 0) {
          await onAdjust(result.existing_item, -1);
          setScannedEntries((entries) => entries.filter((entry) => entry.code !== normalized));
          setMessage(`${result.existing_item.name}: consumed 1 ${result.existing_item.unit}.`);
        } else {
          updateScannedEntry(normalized, (entry) => ({ ...entry, status: "error", result, error: result.existing_item ? "Quantity is already zero." : "This product is not in your inventory." }));
        }
        return;
      }
      updateScannedEntry(normalized, (entry) => {
        const product = result.product;
        const shouldUseProductName = !entry.name.trim() || entry.name === defaultBarcodeName(normalized);
        const categoryId = entry.category_id || String(result.mapped_category?.id || "") || suggestScannedCategory(categories, product);
        const categoryDefault = categories.find((category) => String(category.id) === categoryId)?.default_location;
        return {
          ...entry,
          status: "ready",
          error: "",
          result,
          name: shouldUseProductName ? product?.name || entry.name : entry.name,
          brand: entry.brand || product?.brand || "",
          model: entry.model,
          description: entry.description,
          links_value: entry.links_value,
          low_stock_threshold: entry.low_stock_threshold,
          location_public_id: mode === "putaway" ? sessionDefaults.location_public_id : result.suggested_location?.public_id
            || result.mapped_category?.default_location?.public_id
            || (entry.location_public_id === "unassigned" ? categoryDefault?.public_id : undefined)
            || entry.location_public_id,
          category_id: categoryId,
          image_url: product?.image_url || entry.image_url,
          save_image: Boolean(product?.image_url),
          photo_file: entry.photo_file,
          photo_preview: entry.photo_preview,
        };
      });
      setMessage(result.existing_item ? "Already saved. Adjust the quantity below." : result.found ? "Product recognized. Keep scanning or review below." : "Code added. Add details in the review list.");
    } catch (error) {
      updateScannedEntry(normalized, (entry) => ({ ...entry, status: "error", error: error instanceof Error ? error.message : "Lookup failed" }));
      setMessage(error instanceof Error ? error.message : "Lookup failed");
    } finally {
      lookupInFlight.current.delete(normalized);
    }
  }

  async function consume(value: string): Promise<boolean> {
    if (!value.trim()) return true;
    const normalized = value.trim();
    setCode(normalized);
    try {
      const parsed = new URL(normalized, window.location.href);
      if (parsed.origin !== window.location.origin || parsed.pathname !== "/") {
        throw new Error("Not a Findstuff QR code");
      }
      const itemId = parsed.searchParams.get("item");
      const locationId = parsed.searchParams.get("location");
      if (itemId) {
        if (mode === "consume") {
          const item = items.find((entry) => entry.public_id === itemId);
          if (item && Number(item.quantity) > 0) {
            await onAdjust(item, -1);
            setMessage(`${item.name}: consumed 1 ${item.unit}.`);
            return true;
          }
          setMessage(item ? `${item.name} is already at zero.` : "That item is not loaded in this inventory view.");
          return true;
        }
        await onOpenItem(itemId);
        return false;
      }
      if (locationId) {
        if (mode === "putaway") { setPutawayLocation(locationId); return true; }
        onUseLocation(locationId);
        return false;
      }
    } catch { /* Retail barcodes are not URLs. */ }
    const added = queueBarcode(normalized);
    setMessage(added ? "Scanned. Keep going." : "Already in review. Duplicate ignored.");
    if (added) void lookupBarcode(normalized);
    return true;
  }

  function changeScannedEntry(id: string, changes: Partial<ScannedEntry>) {
    setScannedEntries((entries) => entries.map((entry) => entry.id === id ? { ...entry, ...changes } : entry));
  }

  function removeScannedEntry(id: string) {
    const removed = scannedRef.current.find((entry) => entry.id === id);
    if (removed?.photo_preview) URL.revokeObjectURL(removed.photo_preview);
    setScannedEntries((entries) => entries.filter((entry) => entry.id !== id));
  }

  function chooseEntryCategory(entryId: string, categoryId: string) {
    const chosen = categories.find((entry) => String(entry.id) === categoryId);
    changeScannedEntry(entryId, {
      category_id: categoryId,
      ...(mode !== "putaway" && chosen?.default_location ? { location_public_id: chosen.default_location.public_id } : {}),
    });
  }

  async function saveScannedEntry(entry: ScannedEntry, inbox = false, addAnother = false) {
    if (entry.result?.existing_item) {
      changeScannedEntry(entry.id, { status: "error", error: "This barcode is already saved. Adjust its quantity instead." });
      return false;
    }
    if (!entry.name.trim() && !inbox) {
      changeScannedEntry(entry.id, { status: "error", error: "Add a name before saving." });
      return false;
    }
    if (!entry.quantity.trim()) {
      changeScannedEntry(entry.id, { status: "error", error: "Add the quantity before saving." });
      return false;
    }
    setSavingCodes((current) => new Set(current).add(entry.id));
    try {
      const entryCapabilities = capabilitiesForCategory(categories, entry.category_id);
      await onCreate({
        name: entry.name.trim() || `Inbox capture ${new Date().toLocaleDateString()}`,
        brand: entryCapabilities.identity ? entry.brand.trim() : "",
        model: entryCapabilities.specs ? entry.model.trim() : "",
        description: entry.description.trim(),
        links: entryCapabilities.links ? parseLinkText(entry.links_value) : [],
        barcode: entry.code,
        quantity: entry.quantity.trim(),
        unit: entry.unit.trim() || "pcs",
        location_public_id: inbox ? "unassigned" : entry.location_public_id || "unassigned",
        category_id: inbox ? null : entry.category_id ? Number(entry.category_id) : null,
        low_stock_threshold: entry.low_stock_threshold || null,
        expiration_date: entryCapabilities.expiration ? entry.expiration_date || null : null,
        tags: inbox ? ["inbox"] : [],
      }, entry.save_image && entry.image_url ? entry.image_url : undefined, entry.photo_file || undefined);
      const nextDefaults = {
        location_public_id: entry.location_public_id || "unassigned",
        category_id: entry.category_id,
        unit: entry.unit.trim() || "pcs",
      };
      setSessionDefaults(nextDefaults);
      localStorage.setItem(CAPTURE_DEFAULTS_KEY, JSON.stringify(nextDefaults));
      rememberLocation(entry.location_public_id);
      removeScannedEntry(entry.id);
      setMessage(inbox ? "Saved to Inbox for later completion." : `${entry.name.trim()} saved.`);
      if (addAnother) addBlankEntry(undefined, mode !== "putaway", nextDefaults);
      return true;
    } catch (error) {
      changeScannedEntry(entry.id, { status: "error", error: error instanceof Error ? error.message : "Could not save item" });
      return false;
    } finally {
      setSavingCodes((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
    }
  }

  function saveTemplate(entry: ScannedEntry) {
    const label = templateName.trim();
    if (!label) return;
    const template: CaptureTemplate = {
      id: newScanId(),
      name: label,
      quantity: entry.quantity || "1",
      unit: entry.unit || "pcs",
      location_public_id: entry.location_public_id || "unassigned",
      category_id: entry.category_id,
    };
    setTemplates((current) => {
      const next = [template, ...current].slice(0, 12);
      localStorage.setItem(CAPTURE_TEMPLATES_KEY, JSON.stringify(next));
      return next;
    });
    setTemplateName("");
    setMessage(`${label} template saved.`);
  }

  function deleteTemplate(templateId: string) {
    setTemplates((current) => {
      const next = current.filter((entry) => entry.id !== templateId);
      localStorage.setItem(CAPTURE_TEMPLATES_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function saveAllScanned() {
    const entries = scannedRef.current.filter((entry) => !entry.result?.existing_item);
    if (entries.length === 0) {
      setMessage("All scanned barcodes are already saved. Use the quantity controls below.");
      return;
    }
    let saved = 0;
    for (const entry of entries) {
      const ok = await saveScannedEntry(entry);
      if (ok) saved += 1;
    }
    setMessage(saved === entries.length ? "Scan session saved." : `${saved} saved. Check the remaining rows.`);
  }

  async function addManualCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await consume(code);
  }

  async function scanPhoto(file: File) {
    setPhotoScanning(true);
    setMessage("Reading code from photo...");
    try {
      const decoded = await api.decodeBarcodeImage(file);
      await consume(decoded.code);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read a code from that photo");
    } finally {
      setPhotoScanning(false);
    }
  }

  return (
    <section className="scan-page">
      <div className="capture-modes" role="tablist" aria-label="Capture mode">{([
        ["scan", "Scan", "scan"],
        ["quick", "Quick add", "plus"],
        ["putaway", "Put away", "pin"],
        ["consume", "Consume", "minus"],
        ["assistant", "Voice / AI", "mic"],
      ] as Array<[CaptureMode, string, IconName]>).map(([id, label, icon]) => <button type="button" role="tab" aria-selected={mode === id} className={mode === id ? "active" : ""} key={id} onClick={() => { setMode(id); if (id === "quick" && scannedRef.current.length === 0) addBlankEntry(); }}><Icon name={icon} size={18} /><span>{label}</span></button>)}</div>
      {mode === "assistant" ? <AICommandBox busy={busy} onApplied={onInventoryChanged} /> : <>
        {mode === "putaway" && <section className="putaway-destination"><div><span><Icon name="pin" size={17} /></span><div><small>EVERY ITEM GOES TO</small><strong>{flatLocations.find((entry) => entry.public_id === sessionDefaults.location_public_id)?.path || "Choose or scan a location"}</strong></div></div><button className="secondary" type="button" onClick={() => setPutawayPickerOpen(true)}>Choose</button>{recentLocations.length > 0 && <div className="recent-location-row"><small>Recent</small>{recentLocations.map((entry) => <button type="button" key={entry.public_id} onClick={() => setPutawayLocation(entry.public_id)}>{entry.name}</button>)}</div>}</section>}
        {(mode === "scan" || mode === "putaway" || mode === "consume") && <>
          {!secureCameraContext && <div className="camera-note"><Icon name="camera" size={18} /><span>Live camera needs trusted HTTPS. Snap code uses your phone camera through photo capture and works here.</span></div>}
          <CameraScanner videoRef={video} onCode={consume} />
          <div className="capture-camera-actions"><label className={`snap-code-button secondary button-with-icon ${photoScanning ? "busy" : ""}`}><Icon name="camera" size={17} />{photoScanning ? "Reading photo..." : "Snap a code"}<input type="file" accept="image/*" capture="environment" hidden disabled={busy || photoScanning} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void scanPhoto(file); }} /></label><button type="button" className="secondary button-with-icon" onClick={() => addBlankEntry(undefined, mode !== "putaway")}><Icon name="plus" size={17} />Type instead</button></div>
          <div className="scan-tips"><span><Icon name="qr" size={16} />Findstuff QR opens items or selects a destination</span><span><Icon name="box" size={16} />Retail barcodes become review cards</span></div>
          <div className="or-divider"><span>or enter a code</span></div>
          <form className="search scan-manual" onSubmit={(event) => void addManualCode(event)}><input inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Barcode or QR text" aria-label="Barcode or QR text" /><button className="primary" disabled={busy || !code.trim()}>Use code</button></form>
        </>}
        {mode === "quick" && <section className="quick-capture-launch"><button type="button" className="primary button-with-icon" onClick={() => addBlankEntry()}><Icon name="plus" size={18} />New blank item</button>{templates.length > 0 && <div className="template-launcher"><span>Start from a template</span><div>{templates.map((template) => <span key={template.id}><button type="button" onClick={() => addBlankEntry(template)}><Icon name="spark" size={14} />{template.name}</button><button type="button" aria-label={`Delete ${template.name} template`} onClick={() => deleteTemplate(template.id)}><Icon name="close" size={12} /></button></span>)}</div></div>}</section>}
      </>}
      {message && <div className={`inline-alert ${!lookingUp && scanned.length > 0 ? "success" : ""}`} role="status">{message}</div>}
      {scanned.length > 0 && <section className="scan-review-panel">
        <div className="scan-review-heading">
          <div><p className="eyebrow">REVIEW</p><h2>{scanned.length} unique {scanned.length === 1 ? "item" : "items"}</h2><span>{lookingUp ? "Looking up product data..." : "Ready to save"}</span></div>
          <button className="primary button-with-icon" disabled={busy || savingCodes.size > 0 || scanned.length === 0} onClick={() => void saveAllScanned()}><Icon name="plus" size={17} />Save all</button>
        </div>
        <div className="scan-batch-list">
          {scanned.map((entry) => {
            const product = entry.result?.product;
            const saving = savingCodes.has(entry.id);
            const entryCapabilities = capabilitiesForCategory(categories, entry.category_id);
            const entryCategory = categories.find((categoryEntry) => String(categoryEntry.id) === entry.category_id);
            const entryLocation = flatLocations.find((locationEntry) => locationEntry.public_id === entry.location_public_id);
            const existingItem = entry.result?.existing_item || null;
            const normalizedName = entry.name.trim().toLocaleLowerCase();
            const duplicateMatches = items.filter((item) => (
              entry.code && item.barcode === entry.code
            ) || (
              normalizedName.length >= 3 && (item.name.toLocaleLowerCase() === normalizedName || item.name.toLocaleLowerCase().includes(normalizedName))
            )).slice(0, 3);
            const reviewFields = <div className="scan-entry-fields">
              <label className="capture-photo-field"><span>Photo</span><span className="capture-photo-control">{entry.photo_preview ? <img src={entry.photo_preview} alt="New item preview" /> : <Icon name="camera" size={23} />}<strong>{entry.photo_file ? "Change photo" : "Take or choose photo"}</strong><input type="file" accept="image/*" capture="environment" onChange={(event) => { const file = event.target.files?.[0] || null; if (entry.photo_preview) URL.revokeObjectURL(entry.photo_preview); changeScannedEntry(entry.id, { photo_file: file, photo_preview: file ? URL.createObjectURL(file) : null }); }} /></span></label>
              <label>Name<input value={entry.name} onChange={(event) => changeScannedEntry(entry.id, { name: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveScannedEntry(entry, false, true); } }} placeholder="Item name" autoFocus={!entry.code} /></label>
              {entryCapabilities.identity && <label>Brand<input value={entry.brand} onChange={(event) => changeScannedEntry(entry.id, { brand: event.target.value })} placeholder="Optional" /></label>}
              {entryCapabilities.specs && <label>Model<input value={entry.model} onChange={(event) => changeScannedEntry(entry.id, { model: event.target.value })} placeholder="Optional" /></label>}
              <label>Quantity<input inputMode="decimal" value={entry.quantity} onChange={(event) => changeScannedEntry(entry.id, { quantity: event.target.value })} /></label>
              <label>Unit<select value={entry.unit} onChange={(event) => changeScannedEntry(entry.id, { unit: event.target.value })}>{Array.from(new Set([entry.unit, sessionDefaults.unit, ...units, "pcs", "box", "pack", "bag", "g", "kg", "ml", "l"])).filter(Boolean).map((unit) => <option value={unit} key={unit}>{unit}</option>)}</select></label>
              <div className="picker-field"><span>Category</span><button type="button" onClick={() => setPicker({ id: entry.id, type: "category" })}><Icon name="tag" size={15} /><strong>{entryCategory ? categoryOptionLabel(entryCategory) : "No category"}</strong></button></div>
              <div className="picker-field"><span>Put it in</span><button type="button" onClick={() => setPicker({ id: entry.id, type: "location" })}><Icon name="pin" size={15} /><strong>{entryLocation?.path || "Choose location"}</strong></button></div>
              {recentLocations.length > 0 && mode !== "putaway" && <div className="recent-location-row capture-recents"><small>Recent locations</small>{recentLocations.map((location) => <button type="button" key={location.public_id} onClick={() => changeScannedEntry(entry.id, { location_public_id: location.public_id })}>{location.name}</button>)}</div>}
              {entryCapabilities.expiration && <label>Expiration <small>(optional)</small><input type="date" value={entry.expiration_date} onChange={(event) => changeScannedEntry(entry.id, { expiration_date: event.target.value })} /></label>}
              <label>Low stock at<input inputMode="decimal" value={entry.low_stock_threshold} onChange={(event) => changeScannedEntry(entry.id, { low_stock_threshold: event.target.value })} placeholder="Optional" /></label>
              <label className="capture-description">Description<textarea rows={2} value={entry.description} onChange={(event) => changeScannedEntry(entry.id, { description: event.target.value })} placeholder="Notes, identifying details, condition…" /></label>
              {entryCapabilities.links && <label className="capture-description">Links<textarea rows={2} value={entry.links_value} onChange={(event) => changeScannedEntry(entry.id, { links_value: event.target.value })} placeholder="Manual | https://example.com/manual.pdf" /></label>}
            </div>;
            return <article className={`scan-entry ${entry.status}`} key={entry.id}>
              <div className="scan-entry-visual">{entry.photo_preview ? <img src={entry.photo_preview} alt={entry.name || "New item"} /> : entry.image_url ? <img src={entry.image_url} alt={entry.name || "Scanned product"} referrerPolicy="no-referrer" /> : <span><Icon name="box" size={28} /></span>}</div>
              <div className="scan-entry-main">
                <div className="scan-entry-top"><div><strong>{entry.name || "New item"}</strong><small>{entry.code || "Manual capture"}</small></div><button type="button" aria-label="Remove captured item" onClick={() => removeScannedEntry(entry.id)}><Icon name="close" size={16} /></button></div>
                <p className={`scan-entry-status ${entry.status === "error" ? "error" : ""}`}>{entry.status === "looking_up" ? "Looking up..." : entry.error || (entry.result?.found ? `${product?.brand || "Product"} recognized` : "Needs details")}</p>
                {existingItem ? <div className="scan-existing-item"><strong>Already in inventory</strong><span>{existingItem.quantity} {existingItem.unit} · {existingItem.location_path}</span><div><button type="button" className="secondary" disabled={busy || Number(existingItem.quantity) <= 0} onClick={() => void onAdjust(existingItem, -1)}><Icon name="minus" size={15} />1</button><button type="button" className="primary" disabled={busy} onClick={() => void onAdjust(existingItem, 1)}><Icon name="plus" size={15} />1</button><button type="button" onClick={() => void onOpenItem(existingItem.public_id)}>Open item</button></div></div> : reviewFields}
                {!existingItem && duplicateMatches.length > 0 && <div className="duplicate-suggestions"><strong>Possible duplicate{duplicateMatches.length === 1 ? "" : "s"}</strong>{duplicateMatches.map((item) => <button type="button" key={item.public_id} onClick={() => void onOpenItem(item.public_id)}><span>{item.name}</span><small>{item.quantity} {item.unit} · {item.location_path}</small></button>)}</div>}
                {product?.package_quantity && <small className="scan-product-note">Package: {product.package_quantity}</small>}
                {entry.image_url && <label className="scan-image-choice"><input type="checkbox" checked={entry.save_image} onChange={(event) => changeScannedEntry(entry.id, { save_image: event.target.checked })} />Save product image</label>}
                {!existingItem && <div className="capture-template-save"><input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Template name" aria-label="Template name" /><button type="button" disabled={!templateName.trim()} onClick={() => saveTemplate(entry)}>Save template</button></div>}
                <div className="scan-entry-actions"><button type="button" className="secondary" onClick={() => removeScannedEntry(entry.id)}>Remove</button>{!existingItem && <><button type="button" className="outline-button" disabled={busy || saving} onClick={() => void saveScannedEntry(entry, true)}>Inbox</button><button type="button" className="secondary" disabled={busy || saving || !entry.name.trim()} onClick={() => void saveScannedEntry(entry, false, true)}>Save + another</button><button type="button" className="primary" disabled={busy || saving || !entry.name.trim()} onClick={() => void saveScannedEntry(entry)}>{saving ? "Saving..." : "Save item"}</button></>}</div>
              </div>
            </article>;
          })}
        </div>
      </section>}
      {picker?.type === "location" && pickerEntry && <HierarchyPicker title="Choose location" nodes={locationNodes} selectedId={pickerEntry.location_public_id} emptyLabel="No child locations here" createPlaceholder="New location name" onChoose={(id) => changeScannedEntry(pickerEntry.id, { location_public_id: id })} onCreate={async (parentId, nextName) => (await onCreateLocation({ name: nextName, kind: "location", parent_public_id: parentId })).public_id} onClose={() => setPicker(null)} />}
      {picker?.type === "category" && pickerEntry && <HierarchyPicker title="Choose category" nodes={categoryNodes} selectedId={pickerEntry.category_id} emptyLabel="No child categories here" createPlaceholder="New category name" onChoose={(id) => chooseEntryCategory(pickerEntry.id, id)} onCreate={async (parentId, nextName) => String((await onCreateCategory(nextName, parentId ? Number(parentId) : null)).id)} onClose={() => setPicker(null)} />}
      {putawayPickerOpen && <HierarchyPicker title="Put everything here" nodes={locationNodes} selectedId={sessionDefaults.location_public_id} emptyLabel="No child locations here" chooseLabel="Use destination" currentChooseLabel="Use this destination" onChoose={setPutawayLocation} onClose={() => setPutawayPickerOpen(false)} />}
    </section>
  );
}

function CameraScanner({ videoRef, onCode }: { videoRef: MutableRefObject<HTMLVideoElement | null>; onCode: (code: string) => Promise<boolean | void> }) {
  const recentCodes = useRef<Map<string, number>>(new Map());
  const flashTimer = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const [available, setAvailable] = useState(true);
  const [flashCode, setFlashCode] = useState("");
  useEffect(() => {
    if (!active) return;
    if (!videoRef.current || !navigator.mediaDevices?.getUserMedia) {
      setAvailable(false);
      setActive(false);
      return;
    }
    let stopped = false;
    let controls: { stop: () => void } | null = null;
    void (async () => {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
      if (stopped || !videoRef.current) return;
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 250, delayBetweenScanSuccess: 400 });
      controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, videoRef.current, (result, _error, nextControls) => {
        const text = result?.getText().trim();
        if (!text || stopped) return;
        const now = Date.now();
        if (now - (recentCodes.current.get(text) || 0) < 1400) return;
        recentCodes.current.set(text, now);
        setFlashCode(text);
        if (flashTimer.current) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setFlashCode(""), 650);
        void onCode(text).then((shouldContinue) => {
          if (shouldContinue === false && !stopped) {
            stopped = true;
            nextControls.stop();
            setActive(false);
          }
        });
      });
      setAvailable(true);
    })().catch(() => {
      if (!stopped) {
        setAvailable(false);
        setActive(false);
      }
    });
    return () => {
      stopped = true;
      controls?.stop();
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    };
  }, [active]);
  return <div className={`camera-box ${active ? "active" : ""} ${flashCode ? "recognized" : ""}`}><video ref={videoRef} playsInline muted />{!active && <div className="camera-idle"><span><Icon name="scan" size={38} /></span><strong>Ready to scan</strong><small>Keep the code inside the frame</small></div>}{flashCode && <div className="scan-success"><Icon name="check" size={24} /><span>Added</span></div>}<div className="scan-frame" aria-hidden="true" /><button className={active ? "camera-stop" : "secondary button-with-icon"} onClick={() => { setAvailable(true); setActive(!active); }}>{active ? <><Icon name="close" size={17} />End session</> : <><Icon name="camera" size={17} />Open camera</>}</button>{!available && <small className="camera-warning">Camera access is blocked or unavailable. Try Snap code, or allow camera access in Safari.</small>}</div>;
}

function OffCategoryMappingsView({ categories, busy, onBack, onOpenItem, onNotice }: {
  categories: Category[];
  busy: boolean;
  onBack: () => void;
  onOpenItem: (item: Item) => void;
  onNotice: (message: string) => void;
}) {
  const [mappings, setMappings] = useState<OffCategoryMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "explicit" | "automatic" | "unmapped">("all");
  const [pickerTag, setPickerTag] = useState("");
  const [itemsTag, setItemsTag] = useState("");
  const [mappingItems, setMappingItems] = useState<Item[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [importPayload, setImportPayload] = useState<unknown>(null);
  const [importResult, setImportResult] = useState<OffCategoryMappingImportResult | null>(null);
  const categoryNodes = useMemo(() => categoryPickerNodes(categories), [categories]);
  const activeMapping = mappings.find((mapping) => mapping.off_tag === pickerTag) || null;
  const load = useCallback(async () => {
    try {
      const result = await api.offCategoryMappings();
      setMappings(result.mappings);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not load category mappings");
    } finally {
      setLoading(false);
    }
  }, [onNotice]);
  useEffect(() => { void load(); }, [load]);
  const visibleMappings = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return mappings.filter((mapping) => {
      if (scope !== "all" && mapping.mapping_source !== scope) return false;
      if (!term) return true;
      return [mapping.off_tag, mapping.label, mapping.effective_category?.path || ""]
        .join(" ").toLocaleLowerCase().includes(term);
    });
  }, [mappings, query, scope]);
  async function assign(offTag: string, categoryId: string) {
    try {
      await api.setOffCategoryMapping(offTag, Number(categoryId));
      setPickerTag("");
      await load();
      onNotice("Open Food Facts category assigned");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not save category mapping");
    }
  }
  async function clearAssignment(mapping: OffCategoryMapping) {
    try {
      await api.setOffCategoryMapping(mapping.off_tag, null);
      await load();
      onNotice("Explicit assignment removed; automatic mapping will be used");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not clear category mapping");
    }
  }
  async function showItems(mapping: OffCategoryMapping) {
    setItemsTag(mapping.off_tag);
    setItemsLoading(true);
    try {
      setMappingItems(await api.offCategoryMappingItems(mapping.off_tag));
    } catch (error) {
      setMappingItems([]);
      onNotice(error instanceof Error ? error.message : "Could not load matching items");
    } finally {
      setItemsLoading(false);
    }
  }
  async function downloadExport() {
    try {
      const payload = await api.exportOffCategoryMappings();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "findstuff-off-category-mappings.json";
      anchor.click();
      URL.revokeObjectURL(url);
      onNotice("Category mapping JSON exported");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not export mappings");
    }
  }
  async function readImport(file: File) {
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const result = await api.importOffCategoryMappings(payload);
      setImportPayload(payload);
      setImportResult(result);
    } catch (error) {
      setImportPayload(null);
      setImportResult(null);
      onNotice(error instanceof Error ? error.message : "Invalid category mapping JSON");
    }
  }
  async function applyImport() {
    if (!importPayload || !importResult || importResult.errors) return;
    try {
      const result = await api.importOffCategoryMappings(importPayload, true);
      setImportResult(result);
      setImportPayload(null);
      await load();
      onNotice(`${result.applied} category mappings imported`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not import mappings");
    }
  }
  return <section className="off-mapping-page">
    <div className="subpage-header"><button type="button" className="text-button" onClick={onBack}>Back to Settings</button><div><p className="eyebrow">OPEN FOOD FACTS</p><h1>Category mapping</h1><p>Every category observed during barcode scans appears here. Automatic matches can be overridden with your own category hierarchy.</p></div></div>
    <div className="mapping-actions"><button type="button" className="secondary button-with-icon" onClick={() => void downloadExport()}><Icon name="qr" size={16} />Export JSON</button><label className="upload-import compact-upload"><strong>Import mapping JSON</strong><input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void readImport(file); }} /></label></div>
    {importResult && <section className={`mapping-import-preview ${importResult.errors ? "has-errors" : ""}`}><div><strong>{importResult.errors ? "Import needs corrections" : "Import ready"}</strong><span>{importResult.ready} assignments · {importResult.errors} errors</span></div><div className="import-detail-list">{importResult.details.slice(0, 20).map((detail) => <article className={`import-detail ${detail.status}`} key={`${detail.index}-${detail.off_tag || "row"}`}><b>{detail.status}</b><div><strong>{detail.off_tag || `Row ${detail.index + 1}`}</strong><small>{detail.message}</small></div></article>)}</div><div className="button-row"><button type="button" onClick={() => { setImportPayload(null); setImportResult(null); }}>Cancel</button><button type="button" className="primary" disabled={Boolean(importResult.errors) || !importPayload} onClick={() => void applyImport()}>Apply import</button></div></section>}
    <div className="mapping-toolbar"><label className="search"><Icon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search OFF or Findstuff categories" /></label><div className="filter-row"><button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>All <span>{mappings.length}</span></button><button className={scope === "explicit" ? "active" : ""} onClick={() => setScope("explicit")}>Assigned <span>{mappings.filter((entry) => entry.mapping_source === "explicit").length}</span></button><button className={scope === "automatic" ? "active" : ""} onClick={() => setScope("automatic")}>Automatic <span>{mappings.filter((entry) => entry.mapping_source === "automatic").length}</span></button><button className={scope === "unmapped" ? "active" : ""} onClick={() => setScope("unmapped")}>Unmapped <span>{mappings.filter((entry) => entry.mapping_source === "unmapped").length}</span></button></div></div>
    <div className="mapping-list">
      {loading && <div className="empty-inline"><span>Loading observed categories…</span></div>}
      {!loading && visibleMappings.length === 0 && <EmptyState icon="tag" title={mappings.length ? "No mappings in this view" : "No Open Food Facts categories scanned yet"} text={mappings.length ? "Change the filter or search term." : "Scan a food barcode and its deepest category will appear here."} />}
      {visibleMappings.map((mapping) => <article className="mapping-card compact" key={mapping.off_tag}>
        <div className="mapping-source"><strong>{mapping.label}</strong><code>{mapping.off_tag}</code></div>
        <button type="button" className="mapping-target" disabled={busy} onClick={() => setPickerTag(mapping.off_tag)}><span>Our category</span><strong>{mapping.effective_category?.path || "Click to assign"}</strong></button>
        <span className={`status-badge ${mapping.mapping_source === "unmapped" ? "warning" : mapping.mapping_source === "explicit" ? "active" : "quiet"}`}>{mapping.mapping_source === "explicit" ? "manual" : mapping.mapping_source}</span>
        <button type="button" className="mapping-see-items" onClick={() => void showItems(mapping)}>See items</button>
        {mapping.explicit_category && <button type="button" className="mapping-auto-reset" disabled={busy} onClick={() => void clearAssignment(mapping)} title="Remove the manual override">Use automatic</button>}
      </article>)}
    </div>
    {activeMapping && <HierarchyPicker title={`Map ${activeMapping.label}`} nodes={categoryNodes} selectedId={String(activeMapping.effective_category?.id || "")} emptyLabel="No child categories here" chooseLabel="Assign" currentChooseLabel="Assign this category" onChoose={(id) => void assign(activeMapping.off_tag, id)} onClose={() => setPickerTag("")} />}
    {itemsTag && <div className="modal-backdrop picker-backdrop" role="dialog" aria-modal="true" aria-label="Items in Open Food Facts category" onMouseDown={(event) => { if (event.target === event.currentTarget) setItemsTag(""); }}><article className="picker-sheet mapping-items-sheet"><header><button className="icon-button" type="button" onClick={() => setItemsTag("")} aria-label="Close"><Icon name="close" /></button><div><h2>Items tagged {mappings.find((entry) => entry.off_tag === itemsTag)?.label || itemsTag}</h2><small>{mappingItems.length} matching item{mappingItems.length === 1 ? "" : "s"}</small></div></header><div className="picker-list">{itemsLoading && <div className="empty-inline"><span>Loading items…</span></div>}{!itemsLoading && mappingItems.length === 0 && <div className="empty-inline"><span>No saved items currently use this barcode category.</span></div>}{mappingItems.map((item) => <button type="button" className="mapping-item-row" key={item.public_id} onClick={() => { setItemsTag(""); onOpenItem(item); }}><span><strong>{item.name}</strong><small>{categoryLabel(item) || "Uncategorised"} · {item.location_path}</small></span><Icon name="chevron" size={16} /></button>)}</div></article></div>}
  </section>;
}

function AIScanProposalCard({ scan, categories, locations, units, busy, selected, onSelect, onSave, onApprove, onReject, onRetry }: {
  scan: AIScanProposal;
  categories: Category[];
  locations: LocationNode[];
  units: string[];
  busy: boolean;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onSave: (changes: Record<string, unknown>) => Promise<void>;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onRetry: () => Promise<void>;
}) {
  const item = scan.proposal?.item;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item?.name || "");
  const [description, setDescription] = useState(item?.description || "");
  const [brand, setBrand] = useState(item?.brand || "");
  const [model, setModel] = useState(item?.model || "");
  const [barcode, setBarcode] = useState(item?.barcode || "");
  const [quantity, setQuantity] = useState(item?.quantity || "1");
  const [unit, setUnit] = useState(item?.unit || "pcs");
  const [categoryId, setCategoryId] = useState(item?.category_id ? String(item.category_id) : "");
  const [locationId, setLocationId] = useState(scan.location_public_id);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (editing || !item) return;
    setName(item.name);
    setDescription(item.description);
    setBrand(item.brand);
    setModel(item.model);
    setBarcode(item.barcode);
    setQuantity(item.quantity);
    setUnit(item.unit);
    setCategoryId(item.category_id ? String(item.category_id) : "");
    setLocationId(scan.location_public_id);
  }, [editing, item, scan.location_public_id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    await onSave({
      name,
      description,
      brand,
      model,
      barcode,
      quantity,
      unit,
      category_id: categoryId ? Number(categoryId) : null,
      location_public_id: locationId,
    });
    setEditing(false);
  }

  function finishSwipe() {
    const action = swipeOffset > 84 ? onApprove : swipeOffset < -84 ? onReject : null;
    setSwipeOffset(0);
    swipeStart.current = null;
    if (action && scan.status === "pending" && !busy && !editing) void action();
  }

  return <article
    className={`ai-proposal-card ${scan.status} ${selected ? "selected" : ""} ${swipeOffset > 0 ? "swiping-right" : swipeOffset < 0 ? "swiping-left" : ""}`}
    style={{ "--swipe-offset": `${swipeOffset}px`, "--swipe-opacity": Math.min(1, Math.abs(swipeOffset) / 70) } as CSSProperties}
    onTouchStart={(event) => {
      if (editing || scan.status !== "pending") return;
      swipeStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }}
    onTouchMove={(event) => {
      const start = swipeStart.current;
      if (!start || editing || scan.status !== "pending") return;
      const x = event.touches[0].clientX - start.x;
      const y = event.touches[0].clientY - start.y;
      if (Math.abs(x) > Math.abs(y) + 8) setSwipeOffset(Math.max(-125, Math.min(125, x)));
    }}
    onTouchEnd={finishSwipe}
    onTouchCancel={() => { setSwipeOffset(0); swipeStart.current = null; }}
  >
    {scan.status === "pending" && <label className="ai-proposal-select"><input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} /><span>Select</span></label>}
    <div className="ai-swipe-cue reject" aria-hidden="true">Reject</div><div className="ai-swipe-cue approve" aria-hidden="true">Approve</div>
    <div className="ai-proposal-photo"><img src={scan.photo_url} alt={item?.name || "AI Inbox photo"} /><span>{scan.status === "processing" ? "AI processing" : scan.status === "failed" ? "Needs attention" : `${Math.round((scan.proposal?.confidence || 0) * 100)}% confidence`}</span></div>
    <div className="ai-proposal-main">
      {scan.status === "processing" && <div className="ai-proposal-wait"><strong>Analyzing photo…</strong><small>{scan.location_path} · You can leave Settings while this runs.</small></div>}
      {scan.status === "failed" && <div className="ai-proposal-wait error"><strong>Scan could not be analyzed</strong><small>{scan.error || "The AI provider did not return a result."}</small><div><button className="primary" disabled={busy} onClick={() => void onRetry()}>Retry</button><button disabled={busy} onClick={() => void onReject()}>Reject</button></div></div>}
      {scan.status === "pending" && item && <>
        {!editing ? <>
          <div className="ai-proposal-heading"><div><strong>{item.name}</strong><small>{scan.location_path}{item.category_id ? ` · ${categories.find((entry) => entry.id === item.category_id)?.path || "Category"}` : ""}</small></div><button className="secondary" onClick={() => setEditing(true)}><Icon name="settings" size={14} />Edit inline</button></div>
          {item.description && <p>{item.description}</p>}
          <div className="ai-proposal-facts"><span><small>Quantity</small><strong>{item.quantity} {item.unit}</strong></span>{item.brand && <span><small>Brand</small><strong>{item.brand}</strong></span>}{item.model && <span><small>Model</small><strong>{item.model}</strong></span>}{item.barcode && <span><small>Barcode</small><strong>{item.barcode}</strong></span>}</div>
          {scan.proposal?.research?.url && <a href={scan.proposal.research.url} target="_blank" rel="noreferrer">{scan.proposal.research.label}</a>}
          {scan.proposal?.warnings.map((warning) => <em key={warning}>{warning}</em>)}
        </> : <form className="ai-proposal-form" onSubmit={save}>
          <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
          <div className="form-row"><label>Brand<input value={brand} onChange={(event) => setBrand(event.target.value)} /></label><label>Model<input value={model} onChange={(event) => setModel(event.target.value)} /></label></div>
          <div className="form-row"><label>Quantity<input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label>Unit<select value={unit} onChange={(event) => setUnit(event.target.value)}>{Array.from(new Set([unit, ...units, "pcs"])).map((entry) => <option value={entry} key={entry}>{entry}</option>)}</select></label></div>
          <label>Category<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">No category</option>{categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.path}</option>)}</select></label>
          <label>Place<select value={locationId} onChange={(event) => setLocationId(event.target.value)}>{locations.map((entry) => <option key={entry.public_id} value={entry.public_id}>{entry.path}</option>)}</select></label>
          <label>Barcode<input inputMode="numeric" value={barcode} onChange={(event) => setBarcode(event.target.value)} /></label>
          <label>Description<textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <div className="button-row"><button type="button" onClick={() => setEditing(false)}>Cancel</button><button className="secondary" disabled={busy || !name.trim()}>Save changes</button></div>
        </form>}
        {!editing && <><small className="ai-swipe-help">Swipe right to approve · left to reject</small><div className="ai-proposal-actions"><button disabled={busy} onClick={() => void onReject()}>Reject</button><button className="secondary" disabled={busy} onClick={() => setEditing(true)}>Edit</button><button className="primary" disabled={busy} onClick={() => void onApprove()}><Icon name="check" size={15} />Approve Item</button></div></>}
      </>}
    </div>
  </article>;
}

function ManageView({ items, dashboard, locations, categories, locationTypes, units, busy, theme, setNotice, notify, onThemeChange, onInventoryChanged, onLocations, onCategories, onOffCategoryMappings, onOpenItem, onMarkFound, onForeverLost, onUnitsChanged, onCreateType }: {
  items: Item[];
  dashboard: Dashboard | null;
  locations: LocationNode[];
  categories: Category[];
  locationTypes: LocationType[];
  units: string[];
  busy: boolean;
  theme: ThemePreference;
  setNotice: (message: string) => void;
  notify: (message: string, action?: Omit<RetryNotice, "message">) => void;
  onThemeChange: (theme: ThemePreference) => void;
  onInventoryChanged: () => Promise<void>;
  onLocations: () => void;
  onCategories: () => void;
  onOffCategoryMappings: () => void;
  onOpenItem: (item: Item) => void;
  onMarkFound: (item: Item) => Promise<void>;
  onForeverLost: (item: Item) => Promise<void>;
  onUnitsChanged: (units: string[]) => void;
  onCreateType: (name: string) => Promise<void>;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [settings, setSettings] = useState<ApplicationSettings | null>(null);
  const [rules, setRules] = useState<LocationRule[]>([]);
  const [suggestions, setSuggestions] = useState<EnrichmentSuggestion[]>([]);
  const [aiScans, setAiScans] = useState<AIScanProposal[]>([]);
  const [aiScansOpen, setAiScansOpen] = useState(false);
  const [selectedAiScans, setSelectedAiScans] = useState<Set<string>>(() => new Set());
  const [aiReviewBusy, setAiReviewBusy] = useState("");
  const sawAiScansRef = useRef(false);
  const [softwareUpdate, setSoftwareUpdate] = useState<SoftwareUpdateStatus | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [reserveProject, setReserveProject] = useState("");
  const [reserveItem, setReserveItem] = useState("");
  const [reserveQuantity, setReserveQuantity] = useState("1");
  const [loanItem, setLoanItem] = useState("");
  const [loanPerson, setLoanPerson] = useState("");
  const [loanDirection, setLoanDirection] = useState<"lent" | "borrowed">("lent");
  const [loanDue, setLoanDue] = useState("");
  const [notificationUrl, setNotificationUrl] = useState("");
  const [notificationToken, setNotificationToken] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [expirationDays, setExpirationDays] = useState("7");
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiEndpoint, setAiEndpoint] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiDiagnostic, setAiDiagnostic] = useState<AIConnectionDiagnostic | null>(null);
  const [mqttEnabled, setMqttEnabled] = useState(false);
  const [mqttHost, setMqttHost] = useState("");
  const [mqttPort, setMqttPort] = useState("1883");
  const [mqttUsername, setMqttUsername] = useState("");
  const [mqttPassword, setMqttPassword] = useState("");
  const [mqttBaseTopic, setMqttBaseTopic] = useState("findstuff");
  const [mqttDiscoveryPrefix, setMqttDiscoveryPrefix] = useState("homeassistant");
  const [mqttClientId, setMqttClientId] = useState("findstuff");
  const [mqttPublishInterval, setMqttPublishInterval] = useState("60");
  const [currentAdminPassword, setCurrentAdminPassword] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [confirmAdminPassword, setConfirmAdminPassword] = useState("");
  const [importPayload, setImportPayload] = useState<unknown>(null);
  const [importSummary, setImportSummary] = useState<Record<string, number> | null>(null);
  const [importDetails, setImportDetails] = useState<ImportPreviewDetail[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([]);
  const [dataActivity, setDataActivity] = useState("");
  const [manageActivity, setManageActivity] = useState("");
  const [enrichmentFile, setEnrichmentFile] = useState<unknown>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [ruleType, setRuleType] = useState<"name" | "barcode" | "category">("name");
  const [ruleMatch, setRuleMatch] = useState("");
  const [ruleLocation, setRuleLocation] = useState("unassigned");
  const [customType, setCustomType] = useState("");
  const [customUnit, setCustomUnit] = useState("");
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const reservableItems = useMemo(
    () => items.filter((item) => capabilitiesForCategory(categories, item.category_id).reservation),
    [categories, items],
  );
  const lostItems = useMemo(() => items.filter(hasLostTag), [items]);

  const load = useCallback(async () => {
    try {
      const [nextProjects, nextLoans, nextSettings, nextRules, nextSuggestions, nextAiScans, nextUpdate, nextImports] = await Promise.all([
        api.projects(),
        api.loans(),
        api.settings(),
        api.locationRules(),
        api.enrichmentSuggestions("pending"),
        api.aiScans(),
        api.softwareUpdateStatus(),
        api.importBatches(),
      ]);
      setProjects(nextProjects);
      setLoans(nextLoans);
      setSettings(nextSettings);
      setSoftwareUpdate(nextUpdate);
      onUnitsChanged(nextSettings.units);
      setRules(nextRules);
      setSuggestions(nextSuggestions);
      setAiScans(nextAiScans);
      setImportBatches(nextImports);
      setNotificationsEnabled(nextSettings.notifications.enabled);
      setNotificationUrl(nextSettings.notifications.ntfy_url);
      setExpirationDays(String(nextSettings.notifications.expiration_days));
      setAiEnabled(nextSettings.integrations.ai.enabled);
      setAiEndpoint(nextSettings.integrations.ai.endpoint);
      setAiModel(nextSettings.integrations.ai.model);
      setMqttEnabled(nextSettings.integrations.mqtt.enabled);
      setMqttHost(nextSettings.integrations.mqtt.host);
      setMqttPort(String(nextSettings.integrations.mqtt.port));
      setMqttUsername(nextSettings.integrations.mqtt.username);
      setMqttBaseTopic(nextSettings.integrations.mqtt.base_topic);
      setMqttDiscoveryPrefix(nextSettings.integrations.mqtt.discovery_prefix);
      setMqttClientId(nextSettings.integrations.mqtt.client_id);
      setMqttPublishInterval(String(nextSettings.integrations.mqtt.publish_interval_seconds));
      if (!reserveProject && nextProjects[0]) setReserveProject(nextProjects[0].public_id);
      if (!reserveItem && reservableItems[0]) setReserveItem(reservableItems[0].public_id);
      if (!loanItem && items[0]) setLoanItem(items[0].public_id);
      if (!ruleLocation && flatLocations[0]) setRuleLocation(flatLocations[0].public_id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load management data");
    }
  }, [flatLocations, items, loanItem, reservableItems, reserveItem, reserveProject, ruleLocation, setNotice]);
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (aiScans.length > 0 && !sawAiScansRef.current) {
      sawAiScansRef.current = true;
      setAiScansOpen(true);
    }
  }, [aiScans.length]);
  const aiScansProcessing = aiScans.some((scan) => scan.status === "processing");
  useEffect(() => {
    if (!aiScansProcessing) return;
    const timer = window.setInterval(() => {
      void api.aiScans().then(setAiScans).catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [aiScansProcessing]);
  useEffect(() => {
    const available = new Set(aiScans.filter((scan) => scan.status === "pending").map((scan) => scan.public_id));
    setSelectedAiScans((current) => new Set(Array.from(current).filter((publicId) => available.has(publicId))));
  }, [aiScans]);

  async function perform(action: () => Promise<unknown>, success: string) {
    setManageActivity("Saving changes…");
    try {
      await action();
      setNotice(success);
      void load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The action could not be completed");
    } finally {
      setManageActivity("");
    }
  }

  async function performAIScan(
    action: () => Promise<unknown>,
    success: string,
    inventoryChanged = false,
  ) {
    setAiReviewBusy("Updating Inbox…");
    try {
      await action();
      setNotice(success);
      await load();
      if (inventoryChanged) await onInventoryChanged();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The AI scan action could not be completed");
    } finally {
      setAiReviewBusy("");
    }
  }

  async function approveAIScans(scans: AIScanProposal[]) {
    const pending = scans.filter((scan) => scan.status === "pending");
    if (!pending.length || aiReviewBusy) return;
    setAiReviewBusy(`Approving ${pending.length} Item${pending.length === 1 ? "" : "s"}…`);
    try {
      const created: Item[] = [];
      for (const scan of pending) created.push(await api.approveAiScan(scan.public_id));
      setSelectedAiScans(new Set());
      await load();
      await onInventoryChanged();
      notify(`${created.length} Item${created.length === 1 ? "" : "s"} approved`, {
        label: "Undo",
        action: async () => {
          for (const item of created) {
            const current = await api.item(item.public_id);
            await api.archive(current);
          }
          await load();
          await onInventoryChanged();
          notify(`${created.length} approval${created.length === 1 ? "" : "s"} undone`);
        },
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Items could not be approved");
      await load();
      await onInventoryChanged();
    } finally {
      setAiReviewBusy("");
    }
  }

  async function rejectAIScans(scans: AIScanProposal[]) {
    const pending = scans.filter((scan) => scan.status === "pending");
    if (!pending.length || aiReviewBusy) return;
    setAiReviewBusy(`Rejecting ${pending.length} proposal${pending.length === 1 ? "" : "s"}…`);
    try {
      for (const scan of pending) await api.rejectAiScan(scan.public_id);
      setSelectedAiScans(new Set());
      await load();
      notify(`${pending.length} proposal${pending.length === 1 ? "" : "s"} rejected`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The proposals could not be rejected");
      await load();
    } finally {
      setAiReviewBusy("");
    }
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    await perform(() => api.createProject(projectName, projectDescription), "Project created");
    setProjectName(""); setProjectDescription("");
  }

  async function requestUpdate() {
    if (!window.confirm("Update Findstuff from the latest GitHub commit? The app will restart when the update finishes.")) return;
    await perform(async () => {
      const status = await api.requestSoftwareUpdate();
      setSoftwareUpdate(status);
    }, "Software update queued");
  }

  async function restoreFullBackup(file: File) {
    if (!window.confirm(
      "Restore this full backup? Every current item, location, category, history record, setting, and saved photo will be replaced. Findstuff will create a safety backup first and then restart.",
    )) return;
    setDataActivity(`Uploading ${file.name}…`);
    try {
      const result = await api.restoreBackup(file);
      const summary = result.counts
        ? `${result.counts.items} items, ${result.counts.locations} locations, ${result.counts.photos} photos`
        : "backup contents";
      setNotice(`Backup validated (${summary}). Findstuff is restarting…`);
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        try {
          const status = await api.restoreStatus();
          if (status.status === "complete") {
            window.location.reload();
            return;
          }
          if (status.status === "failed") {
            setNotice(`Restore failed safely: ${status.message}`);
            return;
          }
        } catch {
          // The temporary connection failure is expected while Docker restarts.
        }
      }
      setNotice("Restore was queued. Reload Findstuff after its container finishes restarting.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not restore this backup");
    } finally {
      setDataActivity("");
    }
  }

  async function downloadData(path: string, filename: string, kind: "Backup" | "Export") {
    setDataActivity(kind === "Backup" ? "Preparing your Backup…" : "Preparing your export…");
    try {
      const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(payload?.detail || `${kind} could not be prepared`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice(kind === "Backup" ? "Backup completed" : "Export downloaded");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${kind} failed`);
    } finally {
      setDataActivity("");
    }
  }

  async function removeProject(project: Project) {
    if (!window.confirm(`Permanently delete ${project.name}? Reservations for it will be removed too.`)) return;
    await perform(() => api.deleteProject(project), "Project deleted");
  }

  async function reserve(event: FormEvent) {
    event.preventDefault();
    const project = projects.find((entry) => entry.public_id === reserveProject);
    const item = reservableItems.find((entry) => entry.public_id === reserveItem);
    if (!project || !item) return;
    await perform(() => api.reserveItem(project, item, reserveQuantity), `${item.name} reserved`);
  }

  async function createLoan(event: FormEvent) {
    event.preventDefault();
    await perform(() => api.createLoan({
      item_public_id: loanItem,
      direction: loanDirection,
      person: loanPerson,
      quantity: "1",
      due_date: loanDue || null,
      notes: "",
    }), "Loan recorded");
    setLoanPerson(""); setLoanDue("");
  }

  async function saveNotifications(event: FormEvent) {
    event.preventDefault();
    await perform(() => api.saveNotifications({
      enabled: notificationsEnabled,
      ntfy_url: notificationUrl,
      ntfy_token: notificationToken,
      expiration_days: Number(expirationDays),
      notify_low_stock: true,
      notify_expiration: true,
    }), "Notification settings saved");
    setNotificationToken("");
  }

  async function changeAdminPassword(event: FormEvent) {
    event.preventDefault();
    if (newAdminPassword !== confirmAdminPassword) {
      setNotice("The new passwords do not match");
      return;
    }
    if (newAdminPassword.length < 10) {
      setNotice("The new password must be at least 10 characters");
      return;
    }
    try {
      await api.changeAdminPassword(currentAdminPassword, newAdminPassword);
      setCurrentAdminPassword("");
      setNewAdminPassword("");
      setConfirmAdminPassword("");
      setNotice("Password changed. Sign in again with the new password.");
      window.setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not change the password");
    }
  }

  async function saveAiSettings(event: FormEvent) {
    event.preventDefault();
    await perform(() => api.saveAiSettings({
      enabled: aiEnabled,
      endpoint: aiEndpoint,
      model: aiModel,
      api_key: aiApiKey,
      clear_api_key: false,
    }), "AI settings saved");
    setAiApiKey("");
  }

  async function clearAiKey() {
    await perform(() => api.saveAiSettings({
      enabled: aiEnabled,
      endpoint: aiEndpoint,
      model: aiModel,
      api_key: "",
      clear_api_key: true,
    }), "Saved AI key removed");
    setAiApiKey("");
  }

  function showAiDiagnostic(diagnostic: AIConnectionDiagnostic) {
    setAiDiagnostic(diagnostic);
    window.setTimeout(() => {
      document.getElementById("ai-test-diagnostic")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 50);
  }

  async function testAiConnection() {
    setManageActivity("Testing the AI connection…");
    setAiDiagnostic(null);
    try {
      const diagnostic = await api.testAiSettings();
      notify("AI connection successful", {
        label: "Details",
        action: async () => {
          showAiDiagnostic(diagnostic);
          notify("Provider details opened");
        },
      });
    } catch (error) {
      const diagnostic = error instanceof HttpRequestError ? error.diagnostic : null;
      const message = error instanceof Error ? error.message : "AI connection test failed";
      if (diagnostic) {
        notify(message, {
          label: "Details",
          action: async () => {
            showAiDiagnostic(diagnostic);
            notify("Provider response opened");
          },
        });
      } else {
        notify(message);
      }
    } finally {
      setManageActivity("");
    }
  }

  async function saveMqttSettings(event: FormEvent) {
    event.preventDefault();
    await perform(() => api.saveMqttSettings({
      enabled: mqttEnabled,
      host: mqttHost,
      port: Number(mqttPort),
      username: mqttUsername,
      password: mqttPassword,
      clear_password: false,
      base_topic: mqttBaseTopic,
      discovery_prefix: mqttDiscoveryPrefix,
      client_id: mqttClientId,
      publish_interval_seconds: Number(mqttPublishInterval),
    }), "MQTT settings saved and publisher reloaded");
    setMqttPassword("");
  }

  async function clearMqttPassword() {
    await perform(() => api.saveMqttSettings({
      enabled: mqttEnabled,
      host: mqttHost,
      port: Number(mqttPort),
      username: mqttUsername,
      password: "",
      clear_password: true,
      base_topic: mqttBaseTopic,
      discovery_prefix: mqttDiscoveryPrefix,
      client_id: mqttClientId,
      publish_interval_seconds: Number(mqttPublishInterval),
    }), "Saved MQTT password removed");
    setMqttPassword("");
  }

  async function createRule(event: FormEvent) {
    event.preventDefault();
    await perform(() => api.createLocationRule({
      rule_type: ruleType,
      match_value: ruleMatch,
      location_public_id: ruleLocation,
      priority: ruleType === "barcode" ? 500 : 100,
    }), "Default location rule saved");
    setRuleMatch("");
  }

  async function createType(event: FormEvent) {
    event.preventDefault();
    await onCreateType(customType);
    setCustomType("");
  }

  async function addUnit(event: FormEvent) {
    event.preventDefault();
    const next = customUnit.trim();
    if (!next) return;
    await perform(async () => {
      const result = await api.saveUnits([...units, next]);
      onUnitsChanged(result.units);
    }, "Unit added");
    setCustomUnit("");
  }

  async function removeUnit(unit: string) {
    await perform(async () => {
      const result = await api.saveUnits(units.filter((entry) => entry !== unit));
      onUnitsChanged(result.units);
    }, "Unit removed");
  }

  async function readImport(file: File) {
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const preview = await api.importPreview(payload);
      setImportPayload(payload);
      setImportSummary(preview.counts);
      setImportDetails(preview.details || []);
      setImportErrors(preview.errors || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid import file";
      setImportPayload(null); setImportSummary({}); setImportDetails([]); setImportErrors([message]);
      setNotice(message);
    }
  }

  async function mergeImport() {
    if (!importPayload) return;
    try {
      const result = await api.importMerge(importPayload);
      setImportSummary(result.created);
      setImportErrors(result.errors || []);
      await onInventoryChanged();
      if (result.errors?.length) {
        setNotice(`Import finished with ${result.errors.length} issue(s)`);
      } else {
        setImportPayload(null);
        setImportSummary(null);
        setImportDetails([]);
        setImportErrors([]);
        await load();
        setNotice(result.import_public_id ? "Import merged successfully; undo is available below" : "Import merged successfully");
      }
    } catch (error) {
      setImportErrors([error instanceof Error ? error.message : "Import failed"]);
      setNotice("Import needs fixes");
    }
  }

  function downloadJsonTemplate(filename: string, payload: unknown) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadImportTemplate(kind: "items" | "quantity" | "move" | "structure") {
    const availableCategories = categories.map((category) => ({
      id: category.id,
      path: categoryOptionLabel(category),
      default_location: category.default_location?.name || null,
      metadata_enabled: Object.fromEntries(
        Object.keys(CATEGORY_DATA_FIELD_LABELS).map((field) => [
          field,
          Boolean(category.capabilities[field as keyof typeof CATEGORY_DATA_FIELD_LABELS]),
        ]),
      ),
    }));
    const compactCategories = availableCategories.map((category) => ({
      id: category.id,
      path: category.path,
    }));
    const availableLocations = flatLocations.map((location) => ({
      public_id: location.public_id,
      path: location.path,
      kind: location.kind,
    }));
    const categoryReferences = kind === "items" || kind === "quantity" || kind === "move" ? compactCategories : availableCategories;
    const templateHelp = {
      file_format: {
        format: "The root object must keep format exactly equal to findstuff-ops-v1. This tells Findstuff this is an operations import, not a full database export.",
        operations: "The root operations field must be an array. Each array entry is one change to preview and then apply in order.",
        comments: "JSON does not support comments. Put guidance only in the instructions object, then keep operations valid JSON.",
        unknown_fields: "Do not invent field names. Use only the fields documented here unless the user explicitly asks for custom notes text.",
      },
      how_to_use: [
        "Fill operations with the changes requested by the user.",
        "Delete example operations that are not needed.",
        "Use category path strings from _available_categories.path and location path strings from _available_locations.path whenever possible.",
        "For add item operations, do not create an item if the same name already exists in the same category. Use modify with add_quantity or remove_quantity to change stock.",
        "For modify/delete operations, include match. Prefer public_id/id when known; otherwise use a unique path, name, or barcode.",
        "All booleans must be real JSON booleans true or false, not strings like \"true\".",
        "Preview the file in Findstuff before merging. If preview reports errors, fix the JSON and import again.",
      ],
      operation_shape: {
        op: ["add", "modify", "delete"],
        type: ["item", "category", "location"],
        match: "Required for modify/delete. Not used for add. The match object identifies the existing record.",
        data: "Required for add/modify. Contains fields to create or change. Delete operations normally only need match.",
        examples: [
          { op: "add", type: "item", data: { name: "USB-C cable", category: "Electronics > Cables", location: "Studio > Drawer", quantity: "2", unit: "pcs" } },
          { op: "modify", type: "item", match: { name: "USB-C cable" }, data: { add_quantity: "3" } },
          { op: "delete", type: "location", match: { path: "Garage > Old box" } },
        ],
      },
      item_match_fields: ["public_id", "name", "barcode"],
      category_match_fields: ["id", "path", "name"],
      location_match_fields: ["public_id", "path", "name"],
      item_data_fields: {
        name: "required when adding an item",
        quantity: "absolute quantity, string or number, for add or modify",
        add_quantity: "positive quantity delta for modify, for example 3",
        remove_quantity: "positive quantity to subtract for modify, for example 1",
        unit: units.length ? units : ["pcs", "g", "kg", "ml", "l", "m", "cm"],
        category: "category path from _available_categories, or empty/null for no category",
        location: "location path from _available_locations. If omitted on add, Findstuff uses category default or Unassigned.",
        description: "free text",
        notes: "free text",
        tags: ["array", "of", "short labels"],
        barcode: "retail or custom barcode text",
        low_stock_threshold: "number or null",
        brand: "identity metadata",
        model: "spec metadata",
        serial_number: "identity metadata",
        expiration_date: "YYYY-MM-DD or null",
        purchase_price_minor: "integer cents, for example 1299 for EUR 12.99",
        purchase_currency: "3-letter currency code, for example EUR",
        estimated_value_minor: "integer cents",
        links: [{ label: "Manual", url: "https://example.com/manual.pdf" }],
      },
      item_rules: [
        "name is required for add item.",
        "category may be a category path, category id, or empty/null for no category.",
        "location may be a location path or public_id. If omitted during add, Findstuff uses the category default location when available, otherwise Unassigned.",
        "quantity replaces the current quantity. add_quantity and remove_quantity adjust the current quantity and should be used for stock changes.",
        "links must be an array of objects. Each link object needs label and url.",
        "expiration_date must be YYYY-MM-DD or null.",
        "purchase_price_minor and estimated_value_minor are integer minor currency units, for example cents.",
      ],
      category_data_fields: {
        name: "required when adding a category",
        parent: "category path, empty/null for top level",
        default_location: "location path, public_id, or null to clear",
        metadata_enabled: Object.fromEntries(
          Object.keys(CATEGORY_DATA_FIELD_LABELS).map((field) => [field, "true or false"]),
        ),
      },
      category_rules: [
        "Use op add/type category to create a category. Use op modify/type category to rename, move, set default_location, or set metadata_enabled.",
        "parent is a category path. Use empty string or null for a top-level category.",
        "default_location is a location path or public_id. Use null to clear it.",
        "metadata_enabled is optional. When provided, it must be an object whose keys are metadata field names and whose values are true or false.",
        "metadata_enabled on a parent category becomes the inherited behavior for children unless a child has its own metadata_enabled override.",
        "Use metadata_enabled: {} or metadata_enabled: null to clear a category-specific override and return to inherited/default behavior.",
      ],
      location_data_fields: {
        name: "required when adding a location",
        kind: locationTypes.map((entry) => entry.name),
        parent: "location path, empty/null for top level",
        description: "free text",
      },
      location_rules: [
        "Use op add/type location to create a place or container.",
        "kind must be one of _available_location_kinds when possible.",
        "parent is a location path. Use empty string or null for a top-level location.",
        "Use op modify/type location to rename, move by changing parent, change kind, or update description.",
      ],
      metadata_meaning: CATEGORY_DATA_FIELD_LABELS,
    };
    const base = {
      format: "findstuff-ops-v1",
      instructions: templateHelp,
      _available_units: units,
      _available_location_kinds: locationTypes.map((entry) => entry.name),
      _available_categories: categoryReferences,
      _available_locations: availableLocations,
    };
    if (kind === "items") {
      downloadJsonTemplate("findstuff-template-add-items.json", {
        ...base,
        operations: [
          {
            op: "add",
            type: "item",
            data: {
              name: "Example item name",
              category: availableCategories[0]?.path || "",
              location: availableLocations[0]?.path || "",
              quantity: "1",
              unit: "pcs",
              notes: "",
              tags: ["example"],
              barcode: "",
            },
          },
        ],
      });
    } else if (kind === "quantity") {
      downloadJsonTemplate("findstuff-template-adjust-quantity.json", {
        ...base,
        operations: [
          {
            op: "modify",
            type: "item",
            match: { name: "Existing item name" },
            data: { add_quantity: "3" },
          },
          {
            op: "modify",
            type: "item",
            match: { barcode: "1234567890123" },
            data: { remove_quantity: "1" },
          },
        ],
      });
    } else if (kind === "move") {
      downloadJsonTemplate("findstuff-template-move-update-items.json", {
        ...base,
        operations: [
          {
            op: "modify",
            type: "item",
            match: { name: "Existing item name" },
            data: {
              location: availableLocations[0]?.path || "",
              category: availableCategories[0]?.path || "",
              notes: "Updated note",
            },
          },
        ],
      });
    } else {
      downloadJsonTemplate("findstuff-template-categories-locations.json", {
        ...base,
        operations: [
          {
            op: "add",
            type: "category",
            data: {
              name: "New subcategory",
              parent: availableCategories[0]?.path || "",
              default_location: availableLocations[0]?.path || null,
              metadata_enabled: {
                expiration: false,
                batches: false,
                maintenance: false,
                reservation: true,
                enrichment: false,
                photos: true,
                identity: true,
                specs: true,
                price: true,
                links: true,
              },
            },
          },
          {
            op: "add",
            type: "location",
            data: {
              name: "New box or shelf",
              kind: "box",
              parent: availableLocations[0]?.path || "",
              description: "",
            },
          },
        ],
      });
    }
    setNotice("Import template downloaded");
  }

  async function undoImport(batch: ImportBatch) {
    if (batch.undone_at) return;
    if (!window.confirm("Undo this JSON import? This only reverses records that were tracked for this import.")) return;
    await perform(async () => {
      await api.undoImport(batch.public_id);
      await onInventoryChanged();
      await load();
    }, "Import undone");
  }

  async function downloadEnrichmentExport() {
    const payload = await api.createEnrichmentExport();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `findstuff-enrichment-${payload.export_id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice(`Exported ${payload.items.length} item(s) for enrichment`);
  }

  async function readEnrichmentResponse(file: File) {
    try {
      setEnrichmentFile(JSON.parse(await file.text()) as unknown);
    } catch (error) {
      setEnrichmentFile(null);
      setNotice(error instanceof Error ? error.message : "Invalid enrichment response JSON");
    }
  }

  function importBatchSummary(batch: ImportBatch) {
    return Object.entries(batch.summary)
      .filter(([, count]) => count > 0)
      .map(([name, count]) => `${count} ${name}`)
      .join(" · ") || `${batch.undo_count} tracked change${batch.undo_count === 1 ? "" : "s"}`;
  }

  const system = settings?.system;
  const diskFreePercent = system?.storage.disk_total_bytes
    ? Math.round((system.storage.disk_free_bytes / system.storage.disk_total_bytes) * 100)
    : 0;
  const setupHealth = settings && system ? [
    {
      label: "HTTPS",
      status: window.location.protocol === "https:" ? "Ready" : "Needs attention",
      detail: window.location.protocol === "https:" ? "This connection is protected" : "Open Findstuff through HTTPS, such as Tailscale Serve",
    },
    {
      label: "Authentication",
      status: settings.setup.authentication.required && settings.setup.authentication.configured ? "Ready" : "Needs attention",
      detail: settings.setup.authentication.required ? "Sign-in protection is active" : "Turn on sign-in protection before sharing access",
    },
    {
      label: "Backup",
      status: settings.setup.backup.enabled && settings.setup.backup.last_backup_at ? "Ready" : "Needs attention",
      detail: settings.setup.backup.last_backup_at ? `Last automatic Backup ${new Date(settings.setup.backup.last_backup_at).toLocaleString()}` : settings.setup.backup.enabled ? "Waiting for the first automatic Backup" : "Automatic Backups are off",
    },
    {
      label: "AI",
      status: settings.integrations.ai.enabled && settings.integrations.ai.endpoint && settings.integrations.ai.model && settings.integrations.ai.api_key_set ? "Ready" : settings.integrations.ai.enabled ? "Needs attention" : "Optional",
      detail: settings.integrations.ai.enabled ? "AI Scan is configured" : "Set up AI to use automatic photo recognition",
    },
    {
      label: "MQTT",
      status: settings.integrations.mqtt.enabled && settings.integrations.mqtt.host ? "Ready" : settings.integrations.mqtt.enabled ? "Needs attention" : "Optional",
      detail: settings.integrations.mqtt.enabled ? "Home Assistant publishing is configured" : "Connect Home Assistant when you want it",
    },
    {
      label: "Updates",
      status: softwareUpdate?.enabled ? "Ready" : "Optional",
      detail: softwareUpdate?.enabled ? "In-app updates are available" : "Update from the Linux machine",
    },
    {
      label: "Storage",
      status: diskFreePercent >= 10 && system.storage.disk_free_bytes >= 1024 ** 3 ? "Ready" : "Needs attention",
      detail: `${formatBytes(system.storage.disk_free_bytes)} free`,
    },
    {
      label: "App version",
      status: "Ready",
      detail: system.app.version,
    },
  ] : [];

  return (
    <section className="manage-page">
      <details className="setup-health" open><summary><span className="summary-icon"><Icon name="check" /></span><span><strong>Setup health</strong><small>{setupHealth.filter((entry) => entry.status === "Needs attention").length ? `${setupHealth.filter((entry) => entry.status === "Needs attention").length} need attention` : "Everything important is ready"}</small></span><Icon name="chevron" /></summary><div className="manage-panel setup-health-grid">{setupHealth.map((entry) => <article key={entry.label}><span>{entry.label}</span><b className={`health-status ${entry.status.toLowerCase().replace(" ", "-")}`}>{entry.status}</b><small>{entry.detail}</small></article>)}</div></details>
      {manageActivity && <div className="inline-activity manage-activity" role="status"><span className="activity-spinner" />{manageActivity}</div>}
      <button className="feature-link" onClick={onLocations}><span><Icon name="pin" /></span><div><strong>Places</strong><small>Build your room, shelf, drawer, and box hierarchy</small></div><Icon name="chevron" /></button>
      <button className="feature-link" onClick={onCategories}><span><Icon name="tag" /></span><div><strong>Categories</strong><small>{categories.length} Categories · hierarchy, details, and default Places</small></div><Icon name="chevron" /></button>
      <button className="feature-link" onClick={onOffCategoryMappings}><span><Icon name="spark" /></span><div><strong>Open Food Facts category mapping</strong><small>Review scanned categories, assignments, and JSON imports</small></div><Icon name="chevron" /></button>

      <details open={aiScansOpen} onToggle={(event) => setAiScansOpen(event.currentTarget.open)}><summary><span className="summary-icon"><Icon name="spark" /></span><span><strong>Inbox</strong><small>{aiScans.length ? `${aiScans.length} AI suggestion${aiScans.length === 1 ? "" : "s"} to review` : "Nothing waiting for review"}</small></span><Icon name="chevron" /></summary><div className="manage-panel ai-proposal-list">
        <p className="panel-copy">AI processes photos in the background. Review, edit, approve, or reject each suggested Item here.</p>
        {aiReviewBusy && <div className="inline-activity" role="status"><span className="activity-spinner" />{aiReviewBusy}</div>}
        {aiScans.some((scan) => scan.status === "pending") && <div className="ai-inbox-toolbar">
          <button type="button" className="secondary" disabled={Boolean(aiReviewBusy)} onClick={() => setSelectedAiScans(new Set(aiScans.filter((scan) => scan.status === "pending").map((scan) => scan.public_id)))}>Select all</button>
          {selectedAiScans.size > 0 && <button type="button" onClick={() => setSelectedAiScans(new Set())}>Clear</button>}
          <span>{selectedAiScans.size} selected</span>
          <button type="button" className="primary" disabled={!selectedAiScans.size || Boolean(aiReviewBusy)} onClick={() => void approveAIScans(aiScans.filter((scan) => selectedAiScans.has(scan.public_id)))}>Approve selected</button>
          <button type="button" className="danger-button" disabled={!selectedAiScans.size || Boolean(aiReviewBusy)} onClick={() => void rejectAIScans(aiScans.filter((scan) => selectedAiScans.has(scan.public_id)))}>Reject selected</button>
          <button type="button" className="high-confidence-action" disabled={Boolean(aiReviewBusy) || !aiScans.some((scan) => scan.status === "pending" && (scan.proposal?.confidence || 0) >= 0.85)} onClick={() => void approveAIScans(aiScans.filter((scan) => scan.status === "pending" && (scan.proposal?.confidence || 0) >= 0.85))}><Icon name="spark" size={15} />Approve all high-confidence</button>
        </div>}
        {aiScans.length === 0 && <div className="empty-inline"><span>Your Inbox is clear</span></div>}
        {aiScans.map((scan) => <AIScanProposalCard
          key={scan.public_id}
          scan={scan}
          categories={categories}
          locations={flatLocations}
          units={units}
          busy={busy || Boolean(aiReviewBusy)}
          selected={selectedAiScans.has(scan.public_id)}
          onSelect={(selected) => setSelectedAiScans((current) => {
            const next = new Set(current);
            if (selected) next.add(scan.public_id); else next.delete(scan.public_id);
            return next;
          })}
          onSave={(changes) => performAIScan(() => api.updateAiScan(scan.public_id, changes), "AI scan proposal updated")}
          onApprove={() => approveAIScans([scan])}
          onReject={() => performAIScan(() => api.rejectAiScan(scan.public_id), "AI scan proposal rejected")}
          onRetry={() => performAIScan(() => api.retryAiScan(scan.public_id), "AI scan queued again")}
        />)}
      </div></details>

      <details><summary><span className="summary-icon"><Icon name="settings" /></span><span><strong>Appearance</strong><small>{theme === "system" ? "Follows this device" : `${theme[0].toUpperCase()}${theme.slice(1)} theme`}</small></span><Icon name="chevron" /></summary><div className="manage-panel"><div className="theme-options" role="radiogroup" aria-label="Color theme">{(["light", "dark", "system"] as ThemePreference[]).map((option) => <button type="button" role="radio" aria-checked={theme === option} className={theme === option ? "active" : ""} key={option} onClick={() => onThemeChange(option)}><span className={`theme-preview ${option}`} aria-hidden="true" /><strong>{option === "system" ? "Device" : option[0].toUpperCase() + option.slice(1)}</strong><small>{option === "system" ? "Match system setting" : `${option} colors`}</small></button>)}</div></div></details>

      <details><summary><span className="summary-icon"><Icon name="user" /></span><span><strong>Security</strong><small>Change the administrator password</small></span><Icon name="chevron" /></summary><div className="manage-panel">
        <p className="panel-copy">Change the password used to open Findstuff and call its API. It stays write-only and is excluded from exports and backup ZIPs.</p>
        <form className="form-card compact-form" onSubmit={changeAdminPassword}>
          <label>Current password<input required type="password" autoComplete="current-password" value={currentAdminPassword} onChange={(event) => setCurrentAdminPassword(event.target.value)} /></label>
          <label>New password<input required minLength={10} maxLength={256} type="password" autoComplete="new-password" value={newAdminPassword} onChange={(event) => setNewAdminPassword(event.target.value)} /><small>At least 10 characters.</small></label>
          <label>Confirm new password<input required minLength={10} maxLength={256} type="password" autoComplete="new-password" value={confirmAdminPassword} onChange={(event) => setConfirmAdminPassword(event.target.value)} /></label>
          <button className="secondary" disabled={busy || !currentAdminPassword || newAdminPassword.length < 10 || newAdminPassword !== confirmAdminPassword}>Change password</button>
        </form>
        <p className="panel-copy">After saving, Findstuff will return to its sign-in page for the new password.</p>
      </div></details>

      <details><summary><span className="summary-icon"><Icon name="search" /></span><span><strong>Lost items</strong><small>{lostItems.length ? `${lostItems.length} marked lost` : "Nothing marked lost"}</small></span><Icon name="chevron" /></summary><div className="manage-panel"><div className="lost-list">{lostItems.length === 0 && <div className="empty-inline"><span>Everything is accounted for</span></div>}{lostItems.map((item) => <article className="lost-row" key={item.public_id}><button type="button" className="lost-main" onClick={() => onOpenItem(item)}><span><Icon name="search" size={17} /></span><div><strong>{item.name}</strong><small>{item.location_path}</small></div></button><div className="lost-actions"><button className="secondary" type="button" onClick={() => void onMarkFound(item)}><Icon name="check" size={14} />Found</button><button type="button" onClick={() => void onForeverLost(item)}><Icon name="close" size={14} />Forever lost</button></div></article>)}</div></div></details>
      <details><summary><span className="summary-icon"><Icon name="spark" /></span><span><strong>Recent activity</strong><small>{dashboard?.recent_events.length ? "Latest inventory changes" : "No changes yet"}</small></span><Icon name="chevron" /></summary><div className="manage-panel"><div className="event-list">{!dashboard?.recent_events.length && <div className="empty-inline"><span>Changes will appear here</span></div>}{dashboard?.recent_events.slice(0, 12).map((event, index) => <div className="event" key={`${event.created_at}-${index}`}><span>{activityLabel(event.action)}</span><strong>{event.item_name}</strong><time>{new Date(`${event.created_at}Z`).toLocaleString()}</time></div>)}</div></div></details>

      <details><summary><span className="summary-icon"><Icon name="settings" /></span><span><strong>Storage & app info</strong><small>{system ? `${formatBytes(system.storage.total_managed_bytes)} used · version ${system.app.version}` : "Storage and version"}</small></span><Icon name="chevron" /></summary><div className="manage-panel app-info-panel">
        {system ? <>
          <div className="app-metric-grid">
            <div><span>Total data</span><strong>{formatBytes(system.storage.total_managed_bytes)}</strong><small>Database + photos</small></div>
            <div><span>Database</span><strong>{formatBytes(system.storage.database_bytes)}</strong><small>{formatBytes(system.storage.database_main_bytes)} main · {formatBytes(system.storage.database_wal_bytes)} WAL</small></div>
            <div><span>Photos</span><strong>{formatBytes(system.storage.photos_bytes)}</strong><small>{system.inventory.photos} saved photo{system.inventory.photos === 1 ? "" : "s"}</small></div>
            <div><span>App CPU</span><strong>{system.resources.cpu_percent.toFixed(1)}%</strong><small>{system.resources.cpu_count} CPU core{system.resources.cpu_count === 1 ? "" : "s"} available</small></div>
            <div><span>App RAM</span><strong>{formatBytes(system.resources.memory_rss_bytes)}</strong><small>Current resident memory</small></div>
            <div><span>Disk free</span><strong>{formatBytes(system.storage.disk_free_bytes)}</strong><small>{diskFreePercent}% of {formatBytes(system.storage.disk_total_bytes)}</small></div>
          </div>
          <div className="integration-list app-info-list"><p><span>Inventory</span><small>{system.inventory.items} Items · {system.inventory.locations} Places · {system.inventory.categories} Categories</small></p><p><span>Version</span><code>{system.app.version}</code></p><p><span>Running for</span><small>{formatUptime(system.app.uptime_seconds)}</small></p></div>
          <details className="nested-form technical-details"><summary>Technical details</summary><div className="integration-list app-info-list">
            <p><span>Other data folder usage</span><small>{formatBytes(system.storage.other_data_bytes)}</small></p>
            <p><span>Database engine</span><small>{system.database.journal_mode.toUpperCase()} · {system.database.page_count.toLocaleString()} pages · {formatBytes(system.database.page_size)} page size</small></p>
            <p><span>Started</span><small>{new Date(system.app.started_at).toLocaleString()}</small></p>
            <p><span>Process</span><small>PID {system.app.process_id} · Python {system.app.python_version}</small></p>
            <p><span>Database path</span><code>{system.storage.database_path}</code></p>
            <p><span>Data folder</span><code>{system.storage.data_dir}</code></p>
          </div></details>
          <button className="outline-button" onClick={() => void load()}>Refresh info</button>
        </> : <div className="empty-inline"><span>Loading app information</span></div>}
      </div></details>

      <details><summary><span className="summary-icon"><Icon name="pin" /></span><span><strong>Default locations & types</strong><small>{rules.length} rules · {locationTypes.length} location types</small></span><Icon name="chevron" /></summary><div className="manage-panel">
        <form className="form-card compact-form" onSubmit={createRule}><div className="form-row"><label>Match type<select value={ruleType} onChange={(event) => setRuleType(event.target.value as "name" | "barcode" | "category")}><option value="name">Item/name contains</option><option value="barcode">Exact barcode</option><option value="category">Category contains</option></select></label><label>Match value<input required list={ruleType === "category" ? "category-rule-options" : undefined} value={ruleMatch} onChange={(event) => setRuleMatch(event.target.value)} placeholder={ruleType === "barcode" ? "807680..." : ruleType === "category" ? "Electronics > Components" : "pasta, milk, ESP32…"} /><datalist id="category-rule-options">{categories.map((entry) => <option key={entry.id} value={categoryOptionLabel(entry)} />)}</datalist></label></div><label>Default location<select value={ruleLocation} onChange={(event) => setRuleLocation(event.target.value)}>{flatLocations.map((entry) => <option key={entry.public_id} value={entry.public_id}>{entry.path}</option>)}</select></label><button className="secondary" disabled={!ruleMatch.trim()}>Save default rule</button></form>
        <div className="rules-list">{rules.length === 0 && <div className="empty-inline"><span>No default rules yet</span></div>}{rules.map((rule) => <div className="rule-row" key={rule.public_id}><div><strong>{rule.rule_type}: {rule.match_value}</strong><small>→ {rule.location_name}</small></div><button aria-label={`Delete ${rule.rule_type} rule ${rule.match_value}`} onClick={() => { if (window.confirm(`Delete this ${rule.rule_type} default?\n\n${rule.match_value} → ${rule.location_name}`)) void perform(() => api.deleteLocationRule(rule.public_id), "Default rule removed"); }}><Icon name="close" size={15} /></button></div>)}</div>
        <form className="form-card compact-form type-form" onSubmit={createType}><label>Custom location type<input value={customType} onChange={(event) => setCustomType(event.target.value)} placeholder="crate, suitcase, rack…" /></label><button className="secondary" disabled={!customType.trim()}>Add type</button></form>
        <div className="type-chip-row">{locationTypes.map((entry) => <span key={entry.name}>{entry.name}</span>)}</div>
      </div></details>

      <details><summary><span className="summary-icon"><Icon name="settings" /></span><span><strong>Units of measure</strong><small>{units.length} saved units</small></span><Icon name="chevron" /></summary><div className="manage-panel">
        <form className="form-card compact-form type-form" onSubmit={addUnit}><label>New unit<input value={customUnit} onChange={(event) => setCustomUnit(event.target.value)} placeholder="tray, bottle, reel, sheet…" maxLength={24} /></label><button className="secondary" disabled={!customUnit.trim()}>Add unit</button></form>
        <div className="type-chip-row">{units.map((entry) => <span key={entry}>{entry}<button type="button" aria-label={`Remove ${entry}`} onClick={() => void removeUnit(entry)}><Icon name="close" size={12} /></button></span>)}</div>
      </div></details>

      <details><summary><span className="summary-icon"><Icon name="box" /></span><span><strong>Projects & reservations</strong><small>{projects.filter((project) => project.status === "active").length} active projects</small></span><Icon name="chevron" /></summary><div className="manage-panel">
        {projects.map((project) => <article className="manage-card" key={project.public_id}><header><div><strong>{project.name}</strong><small>{project.status}</small></div><div className="project-actions">{project.status === "active" && <button onClick={() => void perform(() => api.setProjectStatus(project, "completed"), "Project completed")}>Complete</button>}<button onClick={() => void removeProject(project)}>Delete</button></div></header>{project.description && <p>{project.description}</p>}{project.reservations.map((reservation) => <div className="reservation" key={reservation.item_public_id}><span>{reservation.item_name}</span><small>{reservation.quantity} {reservation.unit}</small><button aria-label={`Remove ${reservation.item_name} reservation`} onClick={() => void perform(() => api.removeReservation(project, reservation.item_public_id), "Reservation removed")}><Icon name="close" size={15} /></button></div>)}</article>)}
        {projects.length === 0 && <div className="empty-inline"><span>No projects yet</span></div>}
        <details className="nested-form"><summary>Create a project</summary><form className="form-card compact-form" onSubmit={createProject}><label>Project name<input required value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="e.g. Workbench power supply" /></label><label>Description<input value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} /></label><button className="secondary">Create project</button></form></details>
        {projects.some((project) => project.status === "active") && reservableItems.length > 0 && <details className="nested-form"><summary>Reserve inventory</summary><form className="form-card compact-form" onSubmit={reserve}><label>Project<select value={reserveProject} onChange={(event) => setReserveProject(event.target.value)}>{projects.filter((project) => project.status === "active").map((project) => <option value={project.public_id} key={project.public_id}>{project.name}</option>)}</select></label><label>Inventory item<select value={reserveItem} onChange={(event) => setReserveItem(event.target.value)}>{reservableItems.map((item) => <option value={item.public_id} key={item.public_id}>{item.name} · {item.quantity} {item.unit}</option>)}</select></label><label>Reserve quantity<input inputMode="decimal" value={reserveQuantity} onChange={(event) => setReserveQuantity(event.target.value)} /></label><button className="secondary">Reserve item</button></form></details>}
      </div></details>

      <details><summary><span className="summary-icon"><Icon name="user" /></span><span><strong>Borrowed & lent</strong><small>{loans.filter((loan) => !loan.returned_at).length} open records</small></span><Icon name="chevron" /></summary><div className="manage-panel">
        {loans.filter((loan) => !loan.returned_at).map((loan) => <article className="loan-card" key={loan.public_id}><div><strong>{loan.item_name}</strong><p>{loan.direction === "lent" ? `Lent to ${loan.person}` : `Borrowed from ${loan.person}`}</p><small>{loan.due_date ? `Due ${loan.due_date}` : "No due date"}</small></div><button onClick={() => void perform(() => api.returnLoan(loan), "Marked as returned")}>Returned</button></article>)}
        {loans.filter((loan) => !loan.returned_at).length === 0 && <div className="empty-inline"><span>Nothing is currently out</span></div>}
        <details className="nested-form"><summary>Record a loan</summary><form className="form-card compact-form" onSubmit={createLoan}><label>Item<select value={loanItem} onChange={(event) => setLoanItem(event.target.value)}>{items.map((item) => <option value={item.public_id} key={item.public_id}>{item.name}</option>)}</select></label><div className="form-row"><label>Direction<select value={loanDirection} onChange={(event) => setLoanDirection(event.target.value as "lent" | "borrowed")}><option value="lent">I lent it</option><option value="borrowed">I borrowed it</option></select></label><label>Person<input required value={loanPerson} onChange={(event) => setLoanPerson(event.target.value)} /></label></div><label>Due date<input type="date" value={loanDue} onChange={(event) => setLoanDue(event.target.value)} /></label><button className="secondary" disabled={!loanItem}>Record loan</button></form></details>
      </div></details>

      <details><summary><span className="summary-icon"><Icon name="settings" /></span><span><strong>Notifications</strong><small>{notificationsEnabled ? "ntfy alerts enabled" : "Alerts are off"}</small></span><Icon name="chevron" /></summary><div className="manage-panel"><form className="form-card compact-form" onSubmit={saveNotifications}><label className="toggle"><input type="checkbox" checked={notificationsEnabled} onChange={(event) => setNotificationsEnabled(event.target.checked)} /><span><strong>Enable notifications</strong><small>Low stock and upcoming expiration alerts</small></span></label><label>ntfy topic URL<input type="url" value={notificationUrl} onChange={(event) => setNotificationUrl(event.target.value)} placeholder="https://ntfy.sh/your-private-topic" /></label><label>Access token {settings?.notifications.ntfy_token_set && <small>(saved)</small>}<input type="password" value={notificationToken} onChange={(event) => setNotificationToken(event.target.value)} placeholder="Leave blank to keep existing" /></label><label>Warn before expiration<input type="number" min="0" max="365" value={expirationDays} onChange={(event) => setExpirationDays(event.target.value)} /><small>Days before the expiration date</small></label><button className="secondary">Save notifications</button></form><button className="outline-button" onClick={() => void perform(() => api.testNotification(), "Test notification sent")}>Send test notification</button></div></details>

      <details><summary><span className="summary-icon"><Icon name="qr" /></span><span><strong>Backup & data</strong><small>{settings?.setup.backup.last_backup_at ? `Automatic Backup: ${new Date(settings.setup.backup.last_backup_at).toLocaleDateString()}` : "Download, restore, import, and undo"}</small></span><Icon name="chevron" /></summary><div className="manage-panel">
        <div className="backup-status-card"><div><strong>Automatic Backups</strong><small>{settings?.setup.backup.enabled ? `${settings.setup.backup.backup_count} saved · keeps the latest ${settings.setup.backup.retention}` : "Not enabled on this installation"}</small></div><b className={`health-status ${settings?.setup.backup.enabled && settings.setup.backup.last_backup_at ? "ready" : "needs-attention"}`}>{settings?.setup.backup.last_backup_at ? `Last made ${new Date(settings.setup.backup.last_backup_at).toLocaleString()}` : settings?.setup.backup.enabled ? "Waiting for first Backup" : "Needs attention"}</b></div>
        {dataActivity && <div className="inline-activity" role="status"><span className="activity-spinner" />{dataActivity}</div>}
        <div className="button-row data-download-row"><button type="button" className="primary download-button" disabled={Boolean(dataActivity)} onClick={() => void downloadData("/api/v1/admin/export", "findstuff-export.json", "Export")}>Download JSON export</button><button type="button" className="secondary download-button" disabled={Boolean(dataActivity)} onClick={() => void downloadData("/api/v1/admin/backup", "findstuff-backup.zip", "Backup")}>Download full Backup</button></div>
        <div className="restore-backup-box"><div><strong>Restore a full Backup</strong><span>Choose a Findstuff Backup file to replace every Item, Place, Category, history record, and saved photo. A safety Backup is made first.</span></div><button type="button" className="danger-button" disabled={busy || Boolean(dataActivity)} onClick={() => restoreInputRef.current?.click()}>Choose Backup</button><input ref={restoreInputRef} hidden type="file" accept="application/zip,.zip" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void restoreFullBackup(file); }} /></div>
        <details className="nested-form import-template-box"><summary>Import templates</summary><div className="import-template-grid"><button type="button" className="secondary" onClick={() => downloadImportTemplate("items")}><Icon name="plus" size={15} />Add items</button><button type="button" className="secondary" onClick={() => downloadImportTemplate("quantity")}><Icon name="minus" size={15} />Adjust quantities</button><button type="button" className="secondary" onClick={() => downloadImportTemplate("move")}><Icon name="pin" size={15} />Move/update items</button><button type="button" className="secondary" onClick={() => downloadImportTemplate("structure")}><Icon name="tag" size={15} />Categories & locations</button></div></details>
        <label className="upload-import"><strong>Import data</strong><span>Choose a Findstuff export or changes file to preview it first.</span><input type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && void readImport(event.target.files[0])} /></label>
        {importSummary && <div className="import-preview"><strong>{importErrors.length ? "Import needs fixes" : "Ready to merge"}</strong>{Object.entries(importSummary).map(([name, count]) => <p key={name}><span>{name}</span><b>{count}</b></p>)}{importDetails.length > 0 && <div className="import-detail-list"><span>Dry-run details</span>{importDetails.map((detail) => <article className={`import-detail ${detail.status}`} key={`${detail.index}-${detail.label}`}><b>{detail.status}</b><div><strong>{detail.label}</strong><small>{detail.message}</small></div></article>)}</div>}{importErrors.length > 0 && <div className="import-errors">{importErrors.map((error, index) => <small key={`${index}-${error}`}>{error}</small>)}</div>}<button className="primary" disabled={busy || !importPayload || importErrors.length > 0} onClick={() => void mergeImport()}>Merge into this inventory</button></div>}
        <div className="import-history"><strong>Recent imports</strong><small>Only the latest five are kept; older import history is removed automatically.</small>{importBatches.length === 0 && <div className="empty-inline"><span>No undoable imports yet</span></div>}{importBatches.map((batch) => <article className="import-batch" key={batch.public_id}><div><strong>{batch.mode === "operations" ? "Changes import" : "Data import"}</strong><small>{new Date(batch.created_at).toLocaleString()} · {importBatchSummary(batch)}</small>{batch.undone_at && <em>Undone {new Date(batch.undone_at).toLocaleString()}</em>}</div><button className="secondary" disabled={busy || Boolean(batch.undone_at)} onClick={() => void undoImport(batch)}>Undo</button></article>)}</div>
      </div></details>

      <details><summary><span className="summary-icon"><Icon name="settings" /></span><span><strong>Software update</strong><small>{softwareUpdate ? softwareUpdate.status : "Check latest installed state"}</small></span><Icon name="chevron" /></summary><div className="manage-panel">
        <p className="panel-copy">{softwareUpdate?.enabled ? "Securely asks the host updater to fast-forward this installation from its configured Git origin, pull the container image, and restart Findstuff." : "In-app updates are disabled for this installation. Update safely on the host with ./update-docker.sh."}</p>
        <div className="integration-list update-status-list">
          <p><span>Status</span><b className={`integration-status ${softwareUpdate?.status === "complete" ? "ready" : ""}`}>{softwareUpdate?.status || "unknown"}</b></p>
          <p><span>Message</span><small>{softwareUpdate?.message || "No update status yet"}</small></p>
          {softwareUpdate?.commit && <p><span>Commit</span><code>{softwareUpdate.commit}</code></p>}
          {softwareUpdate?.completed_at && <p><span>Finished</span><small>{new Date(softwareUpdate.completed_at).toLocaleString()}</small></p>}
        </div>
        {softwareUpdate?.log_tail && softwareUpdate.log_tail.length > 0 && <details className="nested-form" open={softwareUpdate.status === "failed" || softwareUpdate.status === "attention"}><summary>Recent updater log · last 30 lines</summary><pre className="log-tail">{softwareUpdate.log_tail.join("\n")}</pre></details>}
        <div className="button-row">{softwareUpdate?.enabled && <button className="primary" disabled={busy || softwareUpdate?.status === "running" || softwareUpdate?.status === "queued"} onClick={() => void requestUpdate()}><Icon name="spark" size={16} />Update Findstuff</button>}<button className="secondary" disabled={busy} onClick={() => void perform(async () => setSoftwareUpdate(await api.softwareUpdateStatus()), "Update status refreshed")}>Refresh status</button></div>
      </div></details>

      <details><summary><span className="summary-icon"><Icon name="spark" /></span><span><strong>Integrations</strong><small>Configure AI and Home Assistant MQTT</small></span><Icon name="chevron" /></summary><div className="manage-panel integration-settings">
        <section className="integration-config-card">
          <div className="integration-config-heading"><div><strong>AI parser & vision</strong><small>OpenAI-compatible chat-completions endpoint for commands and AI Scan</small></div><b className={`integration-status ${settings?.integrations.ai.enabled ? "ready" : ""}`}>{settings?.integrations.ai.enabled ? "Enabled" : "Disabled"}</b></div>
          <form className="form-card compact-form" onSubmit={saveAiSettings}>
            <label className="toggle"><input type="checkbox" checked={aiEnabled} onChange={(event) => setAiEnabled(event.target.checked)} /><span><strong>Enable AI</strong><small>Use this provider for text commands and image recognition</small></span></label>
            <label>API endpoint<input type="url" value={aiEndpoint} onChange={(event) => setAiEndpoint(event.target.value)} placeholder="https://api.openai.com/v1/chat/completions" /></label>
            <label>Model<input value={aiModel} onChange={(event) => setAiModel(event.target.value)} placeholder="gpt-4.1-mini" /></label>
            <label>API key {settings?.integrations.ai.api_key_set && <small>(saved)</small>}<input type="password" autoComplete="new-password" value={aiApiKey} onChange={(event) => setAiApiKey(event.target.value)} placeholder="Leave blank to keep the saved key" /></label>
            <div className="button-row"><button className="secondary" disabled={busy}>Save AI settings</button><button type="button" className="outline-button" disabled={busy || Boolean(manageActivity) || !settings?.integrations.ai.endpoint} onClick={() => void testAiConnection()}>Test connection</button>{settings?.integrations.ai.api_key_set && <button type="button" disabled={busy} onClick={() => void clearAiKey()}>Remove key</button>}</div>
          </form>
          {aiDiagnostic && <details id="ai-test-diagnostic" className="ai-diagnostic" open><summary><span>Provider response</span><Icon name="chevron" size={15} /></summary><div><p><span>HTTP status</span><strong>{aiDiagnostic.http_status}</strong></p><p><span>Model</span><code>{aiDiagnostic.model}</code></p><p><span>Response type</span><code>{aiDiagnostic.response_type || "Not provided"}</code></p>{aiDiagnostic.provider_reply && <p><span>Provider reply</span><code>{aiDiagnostic.provider_reply}</code></p>}<small>{aiDiagnostic.hint}</small><label>Safe response preview<textarea readOnly rows={10} value={aiDiagnostic.response_preview || "No response body"} /></label><em>API keys, tokens, passwords, and secrets are redacted. The preview is limited to 4,000 characters.</em></div></details>}
        </section>
        <section className="integration-config-card">
          <div className="integration-config-heading"><div><strong>Home Assistant MQTT</strong><small>Publishes discovery, availability, and inventory counters to your broker</small></div><b className={`integration-status ${settings?.integrations.mqtt.enabled ? "ready" : ""}`}>{settings?.integrations.mqtt.enabled ? "Enabled" : "Disabled"}</b></div>
          <form className="form-card compact-form" onSubmit={saveMqttSettings}>
            <label className="toggle"><input type="checkbox" checked={mqttEnabled} onChange={(event) => setMqttEnabled(event.target.checked)} /><span><strong>Enable MQTT publishing</strong><small>Home Assistant discovers Findstuff sensors automatically</small></span></label>
            <div className="form-row"><label>Broker host<input value={mqttHost} onChange={(event) => setMqttHost(event.target.value)} placeholder="homeassistant.local" /></label><label>Port<input type="number" min="1" max="65535" value={mqttPort} onChange={(event) => setMqttPort(event.target.value)} /></label></div>
            <div className="form-row"><label>Username<input autoComplete="username" value={mqttUsername} onChange={(event) => setMqttUsername(event.target.value)} /></label><label>Password {settings?.integrations.mqtt.password_set && <small>(saved)</small>}<input type="password" autoComplete="new-password" value={mqttPassword} onChange={(event) => setMqttPassword(event.target.value)} placeholder="Leave blank to keep saved" /></label></div>
            <div className="form-row"><label>Base topic<input value={mqttBaseTopic} onChange={(event) => setMqttBaseTopic(event.target.value)} /></label><label>Discovery prefix<input value={mqttDiscoveryPrefix} onChange={(event) => setMqttDiscoveryPrefix(event.target.value)} /></label></div>
            <div className="form-row"><label>Client ID<input value={mqttClientId} onChange={(event) => setMqttClientId(event.target.value)} /></label><label>Publish every (seconds)<input type="number" min="15" max="86400" value={mqttPublishInterval} onChange={(event) => setMqttPublishInterval(event.target.value)} /></label></div>
            <small>Discovery: {mqttDiscoveryPrefix || "homeassistant"}/sensor/findstuff/# · State: {mqttBaseTopic || "findstuff"}/state</small>
            <div className="button-row"><button className="secondary" disabled={busy}>Save MQTT settings</button><button type="button" className="outline-button" disabled={busy || !settings?.integrations.mqtt.host} onClick={() => void perform(() => api.testMqttSettings(), "MQTT connection successful")}>Test connection</button>{settings?.integrations.mqtt.password_set && <button type="button" disabled={busy} onClick={() => void clearMqttPassword()}>Remove password</button>}</div>
          </form>
        </section>
        <div className="integration-list"><p><span>Open Food Facts</span><b className="integration-status ready">Ready</b></p><p><span>Speech-to-text</span><b className="integration-status">{settings?.integrations.stt_configured ? "Ready" : "Browser only"}</b></p></div>
        <p className="panel-copy">Secrets are write-only: the app never returns the AI key or MQTT password through its API, JSON exports, or backup ZIPs. Re-enter them after restoring a backup.</p>
      </div></details>
      <details><summary><span className="summary-icon"><Icon name="spark" /></span><span><strong>Enrichment queue</strong><small>Run safe metadata lookups for barcode items</small></span><Icon name="chevron" /></summary><div className="manage-panel"><p className="panel-copy">This queues barcode items that have not already been enriched, then processes a small batch. On the Pi, the maintenance timer runs this periodically.</p><div className="button-row"><button className="secondary" onClick={() => void perform(() => api.queueMissingEnrichment(), "Missing enrichment jobs queued")}>Queue missing</button><button className="primary" onClick={() => void perform(() => api.runEnrichment(), "Enrichment batch processed")}>Run batch now</button></div><small>Current provider: Open Food Facts. Google scraping is intentionally not used.</small></div></details>
      <details><summary><span className="summary-icon"><Icon name="spark" /></span><span><strong>External enrichment review</strong><small>{suggestions.length} pending imported suggestion{suggestions.length === 1 ? "" : "s"}</small></span><Icon name="chevron" /></summary><div className="manage-panel">
        <p className="panel-copy">Export missing/weak metadata, let an external agent research it, import the response, then review patches before they change your inventory.</p>
        <div className="button-row"><button className="secondary" onClick={() => void perform(downloadEnrichmentExport, "Enrichment request downloaded")}>Export request JSON</button><label className="upload-import compact-upload"><strong>Import response JSON</strong><input type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && void readEnrichmentResponse(event.target.files[0])} /></label></div>
        {enrichmentFile !== null && <button className="primary wide" onClick={() => void perform(async () => { const result = await api.importEnrichmentResponse(enrichmentFile); setEnrichmentFile(null); await load(); return result; }, "Enrichment response imported")}>Validate and import suggestions</button>}
        <div className="suggestion-list">{suggestions.length === 0 && <div className="empty-inline"><span>No pending suggestions</span></div>}{suggestions.map((suggestion) => <article className="suggestion-row" key={suggestion.public_id}><div><strong>{suggestion.item_name}</strong><small>{suggestion.path} · {Math.round(suggestion.confidence * 100)}% confidence</small><code>{typeof suggestion.value === "object" ? JSON.stringify(suggestion.value) : String(suggestion.value)}</code>{suggestion.sources[0]?.url && <a href={suggestion.sources[0].url} target="_blank" rel="noreferrer">{suggestion.sources[0].label || "Source"}</a>}{suggestion.uncertainty && <em>{suggestion.uncertainty}</em>}</div><div><button className="primary" onClick={() => void perform(async () => { await api.acceptSuggestion(suggestion.public_id); await onInventoryChanged(); }, "Suggestion accepted")}>Accept</button><button onClick={() => void perform(() => api.rejectSuggestion(suggestion.public_id), "Suggestion rejected")}>Reject</button></div></article>)}</div>
      </div></details>
    </section>
  );
}

function DashboardView({
  dashboard,
  detailsCount,
  connectionIssue,
  onRetry,
  onNavigate,
  onCapture,
  onGlobalSearch,
  onInventory,
  onNotice,
}: {
  dashboard: Dashboard | null;
  detailsCount: number;
  connectionIssue: string;
  onRetry: () => void;
  onNavigate: (view: View) => void;
  onCapture: (mode?: CaptureMode) => void;
  onGlobalSearch: () => void;
  onInventory: (filter: InventoryFilter) => void;
  onNotice: (message: string) => void;
}) {
  const [shopping, setShopping] = useState<ShoppingEntry[]>([]);
  const [newEntry, setNewEntry] = useState("");
  const loadShopping = useCallback(async () => {
    try { setShopping(await api.shopping()); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Could not load the shopping list"); }
  }, [onNotice]);
  useEffect(() => {
    if (!dashboard || connectionIssue) return;
    void loadShopping();
  }, [connectionIssue, dashboard, loadShopping]);
  async function shoppingAction(action: () => Promise<unknown>, success?: string): Promise<boolean> {
    try { await action(); await loadShopping(); if (success) onNotice(success); return true; }
    catch (error) { onNotice(error instanceof Error ? error.message : "Could not update the shopping list"); return false; }
  }
  if (!dashboard) return (
    <div className="dashboard-load-failed">
      <EmptyState icon="spark" title="Home could not load" text={connectionIssue || "Findstuff could not reach the backend."} action={{ label: "Try again", onClick: onRetry }} />
    </div>
  );
  return (
    <section className="dashboard-page">
      {connectionIssue && <div className="connection-panel" role="status"><div><strong>Using local view</strong><span>{connectionIssue}</span></div><button className="outline-button" type="button" onClick={onRetry}>Retry</button></div>}
      <button className="where-button" onClick={onGlobalSearch}><span><Icon name="search" size={25} /></span><div><small>GLOBAL SEARCH</small><strong>Find anything in Findstuff</strong></div><kbd>⌘K</kbd></button>
      <div className="attention-strip" aria-label="Inventory shortcuts">
        <button className={dashboard.low_stock_count ? "hot" : ""} onClick={() => onInventory("low")}><strong>{dashboard.low_stock_count}</strong><span>low stock</span></button>
        <button className={dashboard.expiring_count ? "hot" : ""} onClick={() => onInventory("expiring")}><strong>{dashboard.expiring_count}</strong><span>expiring</span></button>
        <button className={detailsCount ? "hot" : ""} onClick={() => onInventory("details")}><strong>{detailsCount}</strong><span>missing location</span></button>
      </div>
      <div className="quick-grid">
        <button onClick={() => onCapture("quick")}><span><Icon name="plus" /></span><strong>Quick capture</strong><small>Type, photo, or template</small></button>
        <button onClick={() => onCapture("scan")}><span><Icon name="scan" /></span><strong>Scan code</strong><small>Barcode or QR</small></button>
      </div>
      <div className="dashboard-columns">
        <section className="shopping-panel"><div className="section-heading"><div><h2>Shopping list</h2><span>{shopping.filter((entry) => !entry.checked).length} remaining</span></div><button className="text-button" onClick={() => onInventory("low")}>Review low stock</button></div><form className="search shopping-add" onSubmit={(event) => { event.preventDefault(); if (newEntry.trim()) void shoppingAction(() => api.addShopping(newEntry), "Shopping item added").then((ok) => { if (ok) setNewEntry(""); }); }}><input value={newEntry} onChange={(event) => setNewEntry(event.target.value)} placeholder="Add something to buy" aria-label="Shopping item" /><button className="icon-button primary" aria-label="Add shopping item"><Icon name="plus" /></button></form><div className="shopping-list">{shopping.length === 0 && <div className="empty-inline"><span>Your list is clear</span></div>}{shopping.map((entry) => <label className={`shopping-entry ${entry.checked ? "checked" : ""}`} key={entry.public_id}><input type="checkbox" checked={entry.checked} onChange={(event) => void shoppingAction(() => api.checkShopping(entry, event.target.checked))} /><span>{entry.name}</span><small>{entry.quantity} {entry.unit}</small></label>)}</div></section>
      </div>
    </section>
  );
}

function EmptyState({ icon = "box", title, text, action }: { icon?: IconName; title: string; text: string; action?: { label: string; onClick: () => void } }) {
  return <div className="empty-state"><span><Icon name={icon} size={27} /></span><h3>{title}</h3><p>{text}</p>{action && <button className="secondary" onClick={action.onClick}>{action.label}</button>}</div>;
}

export default App;
