import { FormEvent, useMemo, useRef, useState } from "react";
import { api, type AICommand, type Category, type Item, type LocationNode, flattenLocations } from "../../api";
import { Icon } from "../../components/Icon";

type SpeechResultEvent = { results: ArrayLike<{ 0: { transcript: string } }> };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
};

type ComposerMode = "ai" | "guided";
type ComposerReferenceKind = "location" | "category" | "item";
type ComposerReference = {
  kind: ComposerReferenceKind;
  marker: string;
  id: string | number;
  label: string;
};
type ComposerSuggestion = {
  kind: ComposerReferenceKind | "action";
  id: string | number;
  label: string;
  detail: string;
  value: string;
};
type ComposerTrigger = {
  kind: ComposerSuggestion["kind"];
  query: string;
  start: number;
};
type GuidedComposerPreview = {
  payload: { format: "findstuff-ops-v1"; operations: Array<Record<string, unknown>> };
  summary: string;
  warnings: string[];
  preview: AICommand["preview"];
};

const COMPOSER_ACTIONS = [
  { value: "add", label: "/add", detail: "Create a new item" },
  { value: "move", label: "/move", detail: "Move an existing item" },
  { value: "adjust", label: "/adjust", detail: "Add or remove stock" },
  { value: "update", label: "/update", detail: "Change an item’s details" },
  { value: "delete", label: "/delete", detail: "Archive an existing item" },
];

function composerTrigger(text: string, cursor: number): ComposerTrigger | null {
  const before = text.slice(0, cursor);
  const lineStart = before.lastIndexOf("\n") + 1;
  const line = before.slice(lineStart);
  const action = line.match(/(?:^|\s)\/([a-z]*)$/i);
  const candidates: ComposerTrigger[] = [];
  if (action) {
    const slash = before.lastIndexOf("/");
    candidates.push({ kind: "action", query: action[1], start: slash });
  }
  for (const [opening, closing, kind] of [
    ["(", ")", "location"],
    ["<", ">", "category"],
    ["[", "]", "item"],
  ] as Array<[string, string, ComposerReferenceKind]>) {
    const start = before.lastIndexOf(opening);
    if (start >= lineStart && before.slice(start + 1).indexOf(closing) === -1) {
      candidates.push({ kind, query: before.slice(start + 1), start });
    }
  }
  return candidates.sort((left, right) => right.start - left.start)[0] || null;
}
function composerSearchScore(query: string, label: string, detail: string): number {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return 1;
  const name = label.toLocaleLowerCase();
  const haystack = `${name} ${detail.toLocaleLowerCase()}`;
  if (name === needle) return 100;
  if (name.startsWith(needle)) return 80;
  if (haystack.includes(needle)) return 60;
  const tokens = needle.split(/\s+/).filter(Boolean);
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 10 : 0), 0);
}

function composerSuggestions(
  trigger: ComposerTrigger | null,
  locations: LocationNode[],
  categories: Category[],
  items: Item[],
): ComposerSuggestion[] {
  if (!trigger) return [];
  let choices: ComposerSuggestion[] = [];
  if (trigger.kind === "action") {
    choices = COMPOSER_ACTIONS.map((entry) => ({
      kind: "action",
      id: entry.value,
      label: entry.label,
      detail: entry.detail,
      value: entry.value,
    }));
  } else if (trigger.kind === "location") {
    choices = flattenLocations(locations).map((entry) => ({
      kind: "location",
      id: entry.public_id,
      label: entry.path,
      detail: entry.kind,
      value: entry.path,
    }));
  } else if (trigger.kind === "category") {
    choices = categories.map((entry) => ({
      kind: "category",
      id: entry.id,
      label: entry.path,
      detail: `${entry.total_item_count} item${entry.total_item_count === 1 ? "" : "s"}`,
      value: entry.path,
    }));
  } else {
    choices = items.map((entry) => ({
      kind: "item",
      id: entry.public_id,
      label: entry.name,
      detail: entry.location_path,
      value: `${entry.name} · ${entry.location_path}`,
    }));
  }
  return choices
    .map((choice) => ({ choice, score: composerSearchScore(trigger.query, choice.label, choice.detail) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.choice.label.localeCompare(right.choice.label))
    .slice(0, 7)
    .map((entry) => entry.choice);
}

function enclosedValue(line: string, opening: string, closing: string): string {
  const start = line.indexOf(opening);
  if (start === -1) return "";
  const end = line.lastIndexOf(closing);
  return end === -1 ? "" : line.slice(start + 1, end).trim();
}

function selectedReference(
  kind: ComposerReferenceKind,
  marker: string,
  references: ComposerReference[],
  locations: LocationNode[],
  categories: Category[],
  items: Item[],
): string | number | null {
  const selected = [...references].reverse().find((entry) => entry.kind === kind && entry.marker === marker);
  if (selected) return selected.id;
  if (kind === "location") {
    const matches = flattenLocations(locations).filter((entry) =>
      entry.path.localeCompare(marker, undefined, { sensitivity: "accent" }) === 0
      || entry.name.localeCompare(marker, undefined, { sensitivity: "accent" }) === 0,
    );
    return matches.length === 1 ? matches[0].public_id : null;
  }
  if (kind === "category") {
    const matches = categories.filter((entry) =>
      entry.path.localeCompare(marker, undefined, { sensitivity: "accent" }) === 0
      || entry.name.localeCompare(marker, undefined, { sensitivity: "accent" }) === 0,
    );
    return matches.length === 1 ? matches[0].id : null;
  }
  const itemLabel = marker.split(" · ", 1)[0];
  const matches = items.filter((entry) => entry.name.localeCompare(itemLabel, undefined, { sensitivity: "accent" }) === 0);
  return matches.length === 1 ? matches[0].public_id : null;
}

function guidedOperations(
  text: string,
  references: ComposerReference[],
  locations: LocationNode[],
  categories: Category[],
  items: Item[],
): Array<Record<string, unknown>> {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error("Write at least one operation.");
  return lines.map((line, index) => {
    const actionMatch = line.match(/\/(add|move|adjust|update|delete)\b/i);
    if (!actionMatch) throw new Error(`Line ${index + 1}: choose an action with /add, /move, /adjust, /update, or /delete.`);
    const action = actionMatch[1].toLocaleLowerCase();
    const locationMarker = enclosedValue(line, "(", ")");
    const categoryMarker = enclosedValue(line, "<", ">");
    const itemMarker = enclosedValue(line, "[", "]");
    const locationId = locationMarker
      ? selectedReference("location", locationMarker, references, locations, categories, items)
      : null;
    const categoryId = categoryMarker
      ? selectedReference("category", categoryMarker, references, locations, categories, items)
      : null;
    const itemId = itemMarker
      ? selectedReference("item", itemMarker, references, locations, categories, items)
      : null;
    if (locationMarker && !locationId) throw new Error(`Line ${index + 1}: choose the Place from the suggestions so Findstuff can use its exact ID.`);
    if (categoryMarker && !categoryId) throw new Error(`Line ${index + 1}: choose the Category from the suggestions so Findstuff can use its exact ID.`);
    if (itemMarker && !itemId) throw new Error(`Line ${index + 1}: choose the Item from the suggestions so Findstuff can use its exact ID.`);

    const withoutReferences = line
      .replace(actionMatch[0], " ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\[[^\]]*\]/g, " ");
    const priceMatch = withoutReferences.match(/(?:€\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*€)/);
    const price = priceMatch ? Number((priceMatch[1] || priceMatch[2]).replace(",", ".")) : null;
    const quantityMatch = withoutReferences.match(/\bx\s*(\d+(?:[.,]\d+)?)\b|\b(\d+(?:[.,]\d+)?)\s*x\b/i);
    const quantity = quantityMatch ? Number((quantityMatch[1] || quantityMatch[2]).replace(",", ".")) : 1;
    const tags = [...withoutReferences.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((match) => match[1]);

    if (action === "add") {
      let name = withoutReferences
        .replace(priceMatch?.[0] || "", " ")
        .replace(quantityMatch?.[0] || "", " ")
        .replace(/#[\p{L}\p{N}_-]+/gu, " ")
        .replace(/\b(?:i\s+(?:just\s+)?bought|i\s+got|ho\s+comprato|aggiungi|add)\b/gi, " ")
        .replace(/\b(?:and\s+i\s+put\s+it\s+(?:in|at)|e\s+l['’]?ho\s+messo\s+(?:in|a))\b/gi, " ")
        .replace(/\b(?:for|per|in|at|a)\s*$/i, " ")
        .replace(/\s+/g, " ")
        .trim();
      name = name.replace(/^[,.;:\s]+|[,.;:\s]+$/g, "");
      if (!name) throw new Error(`Line ${index + 1}: add the Item name after /add.`);
      const data: Record<string, unknown> = { name, quantity, unit: "pcs" };
      if (locationId) data.location_public_id = locationId;
      if (categoryId) data.category_id = categoryId;
      if (price !== null) {
        if (!Number.isFinite(price) || price < 0) throw new Error(`Line ${index + 1}: enter a valid € price.`);
        data.purchase_price_minor = Math.round(price * 100);
        data.purchase_currency = "EUR";
      }
      if (tags.length) data.tags = tags;
      return { op: "add", type: "item", match: {}, data };
    }

    if (!itemId) throw new Error(`Line ${index + 1}: select an existing Item with [item name].`);
    if (action === "move") {
      if (!locationId) throw new Error(`Line ${index + 1}: select the destination with (Place).`);
      return { op: "modify", type: "item", match: { public_id: itemId }, data: { location_public_id: locationId } };
    }
    if (action === "delete") {
      return { op: "delete", type: "item", match: { public_id: itemId }, data: {} };
    }
    if (action === "adjust") {
      const amountText = withoutReferences.match(/[+-]?\d+(?:[.,]\d+)?/)?.[0];
      if (!amountText) throw new Error(`Line ${index + 1}: add a signed quantity, for example -2 or +3.`);
      const amount = Number(amountText.replace(",", "."));
      if (!Number.isFinite(amount) || amount === 0) throw new Error(`Line ${index + 1}: quantity adjustment cannot be zero.`);
      return {
        op: "modify",
        type: "item",
        match: { public_id: itemId },
        data: amount > 0 ? { add_quantity: amount } : { remove_quantity: Math.abs(amount) },
      };
    }
    const data: Record<string, unknown> = {};
    if (locationId) data.location_public_id = locationId;
    if (categoryId) data.category_id = categoryId;
    if (price !== null) {
      data.purchase_price_minor = Math.round(price * 100);
      data.purchase_currency = "EUR";
    }
    if (tags.length) data.tags = tags;
    if (Object.keys(data).length === 0) throw new Error(`Line ${index + 1}: /update needs a Place, Category, € price, or #tag.`);
    return { op: "modify", type: "item", match: { public_id: itemId }, data };
  });
}

export function AICommandBox({ busy, items, locations, categories, onApplied }: {
  busy: boolean;
  items: Item[];
  locations: LocationNode[];
  categories: Category[];
  onApplied: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ComposerMode>("ai");
  const [command, setCommand] = useState<AICommand | null>(null);
  const [guidedPreview, setGuidedPreview] = useState<GuidedComposerPreview | null>(null);
  const [references, setReferences] = useState<ComposerReference[]>([]);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState("");
  const [listening, setListening] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [appliedSummary, setAppliedSummary] = useState("");
  const editor = useRef<HTMLTextAreaElement | null>(null);
  const trigger = mode === "guided" ? composerTrigger(text, cursor) : null;
  const suggestions = useMemo(
    () => composerSuggestions(trigger, locations, categories, items),
    [trigger?.kind, trigger?.query, trigger?.start, locations, categories, items],
  );
  const activeProposal = command?.proposal || (guidedPreview ? {
    summary: guidedPreview.summary,
    warnings: guidedPreview.warnings,
    operations: guidedPreview.payload.operations,
  } : null);
  const activePreview = command?.preview || guidedPreview?.preview || null;
  const canConfirm = command?.requires_confirmation || Boolean(guidedPreview?.preview.valid);
  const activeReferences = references.filter((reference) => {
    const delimiters = reference.kind === "location" ? ["(", ")"] : reference.kind === "category" ? ["<", ">"] : ["[", "]"];
    return text.includes(`${delimiters[0]}${reference.marker}${delimiters[1]}`);
  });

  async function parse(event: FormEvent) {
    event.preventDefault();
    setError("");
    setAppliedSummary("");
    setParsing(true);
    try {
      if (mode === "ai") {
        setGuidedPreview(null);
        setCommand(await api.parseCommand(text));
      } else {
        setCommand(null);
        const operations = guidedOperations(text, references, locations, categories, items);
        const payload = { format: "findstuff-ops-v1" as const, operations };
        const preview = await api.importPreview(payload);
        setGuidedPreview({
          payload,
          summary: `${operations.length} guided operation${operations.length === 1 ? "" : "s"}`,
          warnings: [],
          preview: {
            valid: preview.valid,
            counts: preview.counts,
            errors: preview.errors || [],
            details: preview.details || [],
          },
        });
      }
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not compose operations"); }
    finally { setParsing(false); }
  }

  function switchMode(nextMode: ComposerMode) {
    setMode(nextMode);
    setCommand(null);
    setGuidedPreview(null);
    setError("");
    setAppliedSummary("");
    window.requestAnimationFrame(() => editor.current?.focus());
  }

  function insertSuggestion(suggestion: ComposerSuggestion) {
    if (!trigger) return;
    const before = text.slice(0, trigger.start);
    const after = text.slice(cursor);
    const marker = suggestion.kind === "action"
      ? `/${suggestion.value} `
      : suggestion.kind === "location"
        ? `(${suggestion.value})`
        : suggestion.kind === "category"
          ? `<${suggestion.value}>`
          : `[${suggestion.value}]`;
    const next = `${before}${marker}${after}`;
    const nextCursor = before.length + marker.length;
    setText(next);
    setCommand(null);
    setGuidedPreview(null);
    setCursor(nextCursor);
    if (suggestion.kind !== "action") {
      const referenceKind: ComposerReferenceKind = suggestion.kind;
      setReferences((current) => [
        ...current.filter((entry) => !(entry.kind === referenceKind && entry.marker === suggestion.value)),
        {
          kind: referenceKind,
          marker: suggestion.value,
          id: suggestion.id,
          label: suggestion.label,
        },
      ]);
    }
    window.requestAnimationFrame(() => {
      editor.current?.focus();
      editor.current?.setSelectionRange(nextCursor, nextCursor);
    });
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
    if (!command && !guidedPreview) return;
    setError("");
    setApplying(true);
    try {
      const response = command
        ? await api.confirmCommand(command.public_id)
        : { status: "applied", result: await api.importMerge(guidedPreview!.payload) };
      await onApplied();
      const changed = Number(response.result.created?.add || 0)
        + Number(response.result.created?.modify || 0)
        + Number(response.result.created?.delete || 0);
      const failures = response.result.errors?.length || 0;
      setAppliedSummary(`${changed} operation${changed === 1 ? "" : "s"} applied${failures ? ` · ${failures} could not be applied` : ""}. You can undo this batch from Settings & data → Recent imports.`);
      setCommand(null);
      setGuidedPreview(null);
      setText("");
      setReferences([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not apply operations"); }
    finally { setApplying(false); }
  }

  async function reject() {
    if (command?.requires_confirmation) await api.rejectCommand(command.public_id);
    setCommand(null);
    setGuidedPreview(null);
  }

  return (
    <section className="ai-box">
      <div className="ai-heading"><span><Icon name={mode === "ai" ? "spark" : "more"} size={22} /></span><div><p className="eyebrow">VOICE / AI</p><h2>Operations composer</h2><p>{mode === "ai" ? "Describe what happened naturally. Findstuff resolves existing Items, Categories, and Places, then previews every operation." : "Build exact operations without AI. Suggestions become real references to your saved records, so names never need to be guessed."}</p></div></div>
      <div className="composer-mode-switch" role="tablist" aria-label="Composer method"><button type="button" role="tab" aria-selected={mode === "ai"} className={mode === "ai" ? "active" : ""} onClick={() => switchMode("ai")}><Icon name="spark" size={16} />Use AI</button><button type="button" role="tab" aria-selected={mode === "guided"} className={mode === "guided" ? "active" : ""} onClick={() => switchMode("guided")}><Icon name="more" size={16} />Compose from text</button></div>
      <form onSubmit={parse}>
        <label className="sr-only" htmlFor="ai-command">Inventory operations</label>
        <div className={`composer-editor ${suggestions.length ? "has-suggestions" : ""}`}>
          <textarea ref={editor} id="ai-command" value={text} onSelect={(event) => setCursor(event.currentTarget.selectionStart)} onClick={(event) => setCursor(event.currentTarget.selectionStart)} onKeyUp={(event) => setCursor(event.currentTarget.selectionStart)} onChange={(event) => { setText(event.target.value); setCursor(event.target.selectionStart); setCommand(null); setGuidedPreview(null); }} placeholder={mode === "ai" ? "I bought a ROG Chakram for €200 and put it in the first desk drawer in my studio." : "/add ROG Chakram €200 x1 (Place) <Category> #gaming"} rows={5} />
          {mode === "guided" && suggestions.length > 0 && <div className="composer-suggestions" role="listbox" aria-label={`${trigger?.kind} suggestions`}>{suggestions.map((suggestion) => <button type="button" role="option" key={`${suggestion.kind}-${suggestion.id}`} onMouseDown={(event) => event.preventDefault()} onClick={() => insertSuggestion(suggestion)}><Icon name={suggestion.kind === "location" ? "pin" : suggestion.kind === "category" ? "tag" : suggestion.kind === "item" ? "box" : "more"} size={15} /><span><strong>{suggestion.label}</strong><small>{suggestion.detail}</small></span></button>)}</div>}
        </div>
        {mode === "guided" && activeReferences.length > 0 && <div className="composer-reference-strip"><span><Icon name="check" size={14} />Linked records</span>{activeReferences.map((reference) => <b key={`${reference.kind}-${reference.id}-${reference.marker}`}><Icon name={reference.kind === "location" ? "pin" : reference.kind === "category" ? "tag" : "box"} size={13} />{reference.label}</b>)}</div>}
        {mode === "guided" && <div className="composer-language"><span>Type to insert:</span><button type="button" onClick={() => { setText((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}/`); window.requestAnimationFrame(() => { const position = editor.current?.value.length || 0; setCursor(position); editor.current?.focus(); editor.current?.setSelectionRange(position, position); }); }}><code>/</code> action</button><button type="button" onClick={() => { setText((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}(`); window.requestAnimationFrame(() => { const position = editor.current?.value.length || 0; setCursor(position); editor.current?.focus(); editor.current?.setSelectionRange(position, position); }); }}><code>( )</code> Place</button><button type="button" onClick={() => { setText((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}<`); window.requestAnimationFrame(() => { const position = editor.current?.value.length || 0; setCursor(position); editor.current?.focus(); editor.current?.setSelectionRange(position, position); }); }}><code>&lt; &gt;</code> Category</button><button type="button" onClick={() => { setText((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}[`); window.requestAnimationFrame(() => { const position = editor.current?.value.length || 0; setCursor(position); editor.current?.focus(); editor.current?.setSelectionRange(position, position); }); }}><code>[ ]</code> Item</button><span><code>€</code> price · <code>x2</code> quantity · <code>#tag</code></span></div>}
        <div className="ai-buttons">{mode === "ai" && <button type="button" className="secondary button-with-icon" disabled={parsing || applying} onClick={dictate}><Icon name="mic" size={17} />{listening ? "Listening…" : "Dictate"}</button>}<button className="primary" disabled={busy || parsing || applying || !text.trim()}>{parsing ? "Composing…" : activePreview ? "Preview again" : mode === "ai" ? "Use AI & preview" : "Build exact preview"}</button></div>
      </form>
      {error && <div className="inline-alert" role="alert">{error}</div>}
      {appliedSummary && <div className="composer-success" role="status"><Icon name="check" size={18} /><span>{appliedSummary}</span></div>}
      {activeProposal && activePreview && <div className="proposal composer-preview">
        <div className="composer-preview-heading"><div><p className="eyebrow">IMPORT PREVIEW · {command ? "AI" : "EXACT"}</p><h3>{activeProposal.summary}</h3></div><b className={activePreview.valid ? "ready" : "blocked"}>{activePreview.valid ? "Ready" : "Needs changes"}</b></div>
        <div className="composer-counts">{Object.entries(activePreview.counts).filter(([, value]) => value > 0).map(([label, value]) => <span key={label}><strong>{value}</strong>{label.replaceAll("_", " ")}</span>)}</div>
        <div className="composer-operation-list">{activePreview.details.map((detail) => <article key={`${detail.index}-${detail.action}-${detail.entity}`} className={detail.status}><b>{detail.index}</b><div><strong>{detail.action} {detail.entity}</strong><span>{detail.label}</span><small>{detail.message}</small></div><Icon name={detail.status === "error" ? "close" : "check"} size={17} /></article>)}</div>
        {activeProposal.warnings?.map((warning) => <p className="warning" key={warning}>{warning}</p>)}
        {activePreview.errors.map((message) => <p className="warning" key={message}>{message}</p>)}
        <p className="composer-undo-note">Applied as one import batch. Recent imports keeps the latest five batches available for rollback.</p>
        <div className="proposal-actions"><button type="button" disabled={applying} onClick={() => void reject()}>Revise</button><button type="button" className="primary button-with-icon" disabled={!canConfirm || applying} onClick={() => void confirm()}><Icon name="check" size={17} />{applying ? "Applying…" : `Apply ${activeProposal.operations.length} operation${activeProposal.operations.length === 1 ? "" : "s"}`}</button></div>
      </div>}
    </section>
  );
}
