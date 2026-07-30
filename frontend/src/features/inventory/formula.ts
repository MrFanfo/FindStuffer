import { Item } from "../../api";

const SAVED_INVENTORY_VIEWS_KEY = "findstuff.savedInventoryViews.v1";

function isLowStock(item: Item): boolean {
  return item.low_stock_threshold !== null
    && Number(item.quantity) <= Number(item.low_stock_threshold);
}

export type InventoryFilter = "all" | "low" | "expiring" | "details" | "zero" | "in-stock"
  | "expired" | "expiring-week" | "expiring-30" | "expiry-8-30" | "expiry-31-90" | "expiry-later"
  | "no-expiry" | "missing-photo" | "uncategorized" | "missing-notes" | "priced"
  | "added-30" | "added-90" | "added-365" | "added-older";
export type InventoryGroup = "none" | "room" | "location" | "category" | "tag" | "unit";
export type InventorySort = "updated" | "name" | "location" | "quantity-asc" | "quantity-desc" | "expiration";
export type FormulaField = "name" | "brand" | "model" | "serial" | "description" | "notes" | "category" | "location" | "tag" | "quantity" | "unit" | "value" | "weight" | "length" | "width" | "height" | "expiration" | "barcode" | "updated" | "low_stock" | "has_photo" | "missing_location";
export type FormulaOperator = "contains" | "not-contains" | "equals" | "not-equals" | "one-of" | "not-one-of" | "gt" | "gte" | "lt" | "lte" | "before" | "after" | "empty" | "not-empty";
export type FormulaRule = { id: string; field: FormulaField; operator: FormulaOperator; value: string };
export type InventoryFormula = { source: string };
export type FormulaNode =
  | { type: "and" | "or"; left: FormulaNode; right: FormulaNode }
  | { type: "not"; node: FormulaNode }
  | { type: "condition"; rule: FormulaRule; choices?: string[] };
export type FormulaToken = { value: string; position: number; kind: "word" | "string" | "operator" | "punctuation" };
export type FormulaValidation = { node: FormulaNode | null; error: string };
export type SavedInventoryView = {
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
export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyInventoryFormula(): InventoryFormula {
  return { source: "" };
}

export function cloneFormula(formula: InventoryFormula): InventoryFormula {
  return { source: formula.source || "" };
}

export function loadSavedInventoryViews(): SavedInventoryView[] {
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

export function saveSavedInventoryViews(views: SavedInventoryView[]): void {
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

export function validateInventoryFormula(source: string): FormulaValidation {
  try {
    return { node: new InventoryFormulaParser(tokenizeFormula(source.trim())).parse(), error: "" };
  } catch (error) {
    return { node: null, error: error instanceof Error ? error.message : "Invalid formula" };
  }
}

export function inventoryFormulaMatches(item: Item, node: FormulaNode | null): boolean {
  if (!node) return true;
  if (node.type === "condition") return formulaRuleMatches(item, node.rule, node.choices);
  if (node.type === "not") return !inventoryFormulaMatches(item, node.node);
  if (node.type === "and") return inventoryFormulaMatches(item, node.left) && inventoryFormulaMatches(item, node.right);
  return inventoryFormulaMatches(item, node.left) || inventoryFormulaMatches(item, node.right);
}
