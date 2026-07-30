import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  flattenLocations,
  type Category,
  type LocationNode,
  type LocationRule,
} from "../../api";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { SearchableFilterPicker } from "../../components/SearchableFilterPicker";
import { categoryOptionLabel } from "../../domain/inventory";

type RetryNotice = { action: () => Promise<void>; label: string; message: string };

type LocationRuleDraft = {
  rule_type: "name" | "barcode" | "category";
  match_value: string;
  location_public_id: string;
  priority: string;
  enabled: boolean;
};

export function DefaultRulesView({ locations, categories, busy, onBack, onChanged, notify }: {
  locations: LocationNode[];
  categories: Category[];
  busy: boolean;
  onBack: () => void;
  onChanged: () => Promise<void>;
  notify: (message: string, action?: Omit<RetryNotice, "message">) => void;
}) {
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const [rules, setRules] = useState<LocationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | LocationRule["rule_type"]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorPicker, setEditorPicker] = useState<"category" | "location" | null>(null);
  const [draft, setDraft] = useState<LocationRuleDraft>({
    rule_type: "name",
    match_value: "",
    location_public_id: flatLocations[0]?.public_id || "unassigned",
    priority: "100",
    enabled: true,
  });

  const loadRules = useCallback(async () => {
    try {
      setError("");
      setRules(await api.locationRules());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load default rules");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void loadRules(); }, [loadRules]);

  const selectedRule = rules.find((rule) => rule.public_id === selectedId) || null;
  const filteredRules = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return rules.filter((rule) => {
      if (typeFilter !== "all" && rule.rule_type !== typeFilter) return false;
      if (statusFilter === "enabled" && !rule.enabled) return false;
      if (statusFilter === "disabled" && rule.enabled) return false;
      if (locationFilter !== "all" && rule.location_public_id !== locationFilter) return false;
      if (!search) return true;
      const location = flatLocations.find((entry) => entry.public_id === rule.location_public_id);
      return [rule.match_value, rule.rule_type, rule.location_name, location?.path || "", String(rule.priority)]
        .some((value) => value.toLocaleLowerCase().includes(search));
    });
  }, [flatLocations, locationFilter, query, rules, statusFilter, typeFilter]);
  const hasFilters = Boolean(query.trim() || typeFilter !== "all" || statusFilter !== "all" || locationFilter !== "all");

  function startCreate() {
    setSelectedId("");
    setDraft({
      rule_type: "name",
      match_value: "",
      location_public_id: flatLocations[0]?.public_id || "unassigned",
      priority: "100",
      enabled: true,
    });
    setEditorMode("create");
  }

  function startEdit(rule: LocationRule) {
    setDraft({
      rule_type: rule.rule_type,
      match_value: rule.match_value,
      location_public_id: rule.location_public_id,
      priority: String(rule.priority),
      enabled: rule.enabled,
    });
    setEditorMode("edit");
  }

  async function saveRule(event: FormEvent) {
    event.preventDefault();
    const matchValue = draft.match_value.trim();
    const priority = Number(draft.priority);
    if (!matchValue || !draft.location_public_id || !Number.isInteger(priority) || priority < 0 || priority > 10000) return;
    setSaving(true);
    try {
      const body = {
        rule_type: draft.rule_type,
        match_value: matchValue,
        location_public_id: draft.location_public_id,
        priority,
        enabled: draft.enabled,
      };
      const saved = editorMode === "edit" && selectedRule
        ? await api.updateLocationRule(selectedRule.public_id, body)
        : await api.createLocationRule(body);
      await loadRules();
      await onChanged();
      setSelectedId(saved.public_id);
      setEditorMode(null);
      notify(editorMode === "edit" ? "Default rule updated" : "Default rule created");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Could not save default rule");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule(rule: LocationRule) {
    if (!window.confirm(`Delete this default rule?\n\n${rule.match_value} → ${rule.location_name}`)) return;
    setSaving(true);
    try {
      await api.deleteLocationRule(rule.public_id);
      setSelectedId("");
      await loadRules();
      await onChanged();
      notify("Default rule deleted");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Could not delete default rule");
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule: LocationRule) {
    setSaving(true);
    try {
      const updated = await api.updateLocationRule(rule.public_id, { enabled: !rule.enabled });
      setRules((current) => current.map((entry) => entry.public_id === updated.public_id ? updated : entry));
      await onChanged();
      notify(updated.enabled ? "Default rule enabled" : "Default rule disabled");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Could not update default rule");
    } finally {
      setSaving(false);
    }
  }

  function ruleDescription(rule: LocationRule): string {
    if (rule.rule_type === "barcode") return `An Item with barcode ${rule.match_value} goes to this Place. Barcode matches are exact.`;
    if (rule.rule_type === "category") return `Items in ${rule.match_value}, including its child Categories, go to this Place.`;
    return `An Item whose name contains “${rule.match_value}” goes to this Place. Matching ignores letter case.`;
  }

  const selectedLocation = selectedRule
    ? flatLocations.find((entry) => entry.public_id === selectedRule.location_public_id) || null
    : null;

  return <section className="default-rules-page">
    <header className="default-rules-header">
      <button type="button" className="text-button" onClick={onBack}><Icon name="chevron" size={16} />Back to More</button>
      <div><p className="eyebrow">DEFAULT LOCATIONS</p><h1>Default rules</h1><span>Choose where matching Items should go automatically.</span></div>
      <button type="button" className="primary button-with-icon" onClick={startCreate}><Icon name="plus" size={16} />New rule</button>
    </header>

    <div className="default-rules-toolbar">
      <label className="default-rules-search"><Icon name="search" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search rules or Places" aria-label="Search default rules" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear rule search"><Icon name="close" size={14} /></button>}</label>
      <label><span>Type</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}><option value="all">All types</option><option value="name">Item name</option><option value="barcode">Barcode</option><option value="category">Category</option></select></label>
      <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">Any status</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></label>
      <label><span>Place</span><select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="all">Every Place</option>{flatLocations.map((location) => <option value={location.public_id} key={location.public_id}>{location.path}</option>)}</select></label>
      {hasFilters && <button type="button" className="outline-button" onClick={() => { setQuery(""); setTypeFilter("all"); setStatusFilter("all"); setLocationFilter("all"); }}>Clear filters</button>}
    </div>

    <div className={`default-rules-layout ${selectedRule ? "has-detail" : ""}`}>
      <div className="default-rule-list-pane">
        <div className="default-rule-list-summary"><strong>{filteredRules.length} rule{filteredRules.length === 1 ? "" : "s"}</strong><small>{rules.length} total</small></div>
        {loading && <div className="inline-activity"><span className="activity-spinner" />Loading rules…</div>}
        {error && <div className="inline-alert">{error}<button type="button" onClick={() => void loadRules()}>Try again</button></div>}
        {!loading && !error && filteredRules.length === 0 && <EmptyState icon="filter" title={rules.length ? "No matching rules" : "No default rules yet"} text={rules.length ? "Try clearing one of the filters." : "Create a rule to automatically suggest a Place."} />}
        <div className="default-rule-list">
          {filteredRules.map((rule) => {
            const location = flatLocations.find((entry) => entry.public_id === rule.location_public_id);
            return <button type="button" className={`${selectedId === rule.public_id ? "selected" : ""} ${rule.enabled ? "" : "disabled"}`} key={rule.public_id} onClick={() => setSelectedId(rule.public_id)}>
              <span className="default-rule-type"><Icon name={rule.rule_type === "category" ? "tag" : rule.rule_type === "barcode" ? "qr" : "search"} size={17} /></span>
              <span className="default-rule-copy"><small>{rule.rule_type === "name" ? "ITEM NAME" : rule.rule_type.toUpperCase()}</small><strong>{rule.match_value}</strong><em><Icon name="pin" size={12} />{location?.path || rule.location_name}</em></span>
              <span className={`rule-state ${rule.enabled ? "ready" : ""}`}>{rule.enabled ? "On" : "Off"}</span>
              <Icon name="chevron" size={15} />
            </button>;
          })}
        </div>
      </div>

      {selectedRule ? <aside className="default-rule-detail">
        <button type="button" className="default-rule-mobile-back" onClick={() => setSelectedId("")}><Icon name="chevron" size={15} />All rules</button>
        <div className="default-rule-detail-heading"><span><Icon name={selectedRule.rule_type === "category" ? "tag" : selectedRule.rule_type === "barcode" ? "qr" : "search"} size={20} /></span><div><small>{selectedRule.rule_type === "name" ? "ITEM NAME RULE" : `${selectedRule.rule_type.toUpperCase()} RULE`}</small><h2>{selectedRule.match_value}</h2></div><b className={`integration-status ${selectedRule.enabled ? "ready" : ""}`}>{selectedRule.enabled ? "Enabled" : "Disabled"}</b></div>
        <p>{ruleDescription(selectedRule)}</p>
        <div className="default-rule-route"><div><span>When this matches</span><strong>{selectedRule.match_value}</strong></div><Icon name="chevron" /><div><span>Send to</span><strong>{selectedLocation?.path || selectedRule.location_name}</strong></div></div>
        <dl className="default-rule-facts"><div><dt>Match type</dt><dd>{selectedRule.rule_type}</dd></div><div><dt>Priority</dt><dd>{selectedRule.priority} · tie-breaker</dd></div><div><dt>Place</dt><dd>{selectedLocation?.path || selectedRule.location_name}</dd></div><div><dt>Status</dt><dd>{selectedRule.enabled ? "Enabled" : "Disabled"}</dd></div></dl>
        <small className="default-rule-priority-note">You normally do not need to change priority. It only decides between equally specific matching rules; the higher number wins.</small>
        <details className="nested-form default-rule-technical"><summary>Technical details</summary><div><span>Rule ID</span><code>{selectedRule.public_id}</code><small>Internal identifier used by the app and API. You do not need to manage it.</small></div></details>
        <div className="default-rule-detail-actions"><button type="button" className="primary" disabled={busy || saving} onClick={() => startEdit(selectedRule)}><Icon name="settings" size={15} />Edit rule</button><button type="button" className="secondary" disabled={busy || saving} onClick={() => void toggleRule(selectedRule)}>{selectedRule.enabled ? "Disable" : "Enable"}</button><button type="button" className="danger-button" disabled={busy || saving} onClick={() => void deleteRule(selectedRule)}><Icon name="close" size={14} />Delete</button></div>
      </aside> : <aside className="default-rule-detail-empty"><span><Icon name="settings" size={25} /></span><h2>Select a rule</h2><p>Its match behavior, destination, priority, and controls will appear here.</p></aside>}
    </div>

    {editorMode && <div className="rule-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditorMode(null); }}><form className="rule-editor-sheet" onSubmit={saveRule}>
      <header><div><p className="eyebrow">{editorMode === "edit" ? "EDIT DEFAULT" : "NEW DEFAULT"}</p><h2>{editorMode === "edit" ? "Modify rule" : "Create a rule"}</h2></div><button type="button" className="icon-button" onClick={() => setEditorMode(null)} aria-label="Close rule editor"><Icon name="close" /></button></header>
      <label>Match type<select value={draft.rule_type} onChange={(event) => { const ruleType = event.target.value as LocationRuleDraft["rule_type"]; setDraft((current) => ({ ...current, rule_type: ruleType, match_value: "", priority: editorMode === "create" ? ruleType === "barcode" ? "500" : "100" : current.priority })); if (ruleType === "category") setEditorPicker("category"); }}><option value="name">Item name contains</option><option value="barcode">Exact barcode</option><option value="category">Category or child Category</option></select></label>
      {draft.rule_type === "category" ? <div className="picker-field rule-editor-picker-field"><span>Category or child Category</span><button type="button" onClick={() => setEditorPicker("category")}><Icon name="tag" size={16} /><strong>{draft.match_value || "Choose a Category"}</strong><Icon name="chevron" size={15} /></button><small>Matches the selected Category and all Categories below it.</small></div> : <label>Match value<input required autoFocus inputMode={draft.rule_type === "barcode" ? "numeric" : "text"} value={draft.match_value} onChange={(event) => setDraft((current) => ({ ...current, match_value: event.target.value }))} placeholder={draft.rule_type === "barcode" ? "807680…" : "pasta, cable, ESP32…"} /><small>{draft.rule_type === "barcode" ? "Must match the barcode exactly." : "Matches anywhere in the Item name, ignoring case."}</small></label>}
      <div className="picker-field rule-editor-picker-field"><span>Destination Place</span><button type="button" onClick={() => setEditorPicker("location")}><Icon name="pin" size={16} /><strong>{flatLocations.find((location) => location.public_id === draft.location_public_id)?.path || "Choose a Place"}</strong><Icon name="chevron" size={15} /></button></div>
      <label className="toggle rule-enabled-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} /><span><strong>Enabled</strong><small>Use this rule for suggestions</small></span></label>
      <details className="nested-form rule-editor-advanced"><summary>Advanced</summary><div><label>Priority<input required type="number" min="0" max="10000" value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))} /><small>Only a tie-breaker between equally specific matches. Higher wins; most users can leave this unchanged.</small></label></div></details>
      <div className="button-row"><button type="button" onClick={() => setEditorMode(null)}>Cancel</button><button className="primary" disabled={busy || saving || !draft.match_value.trim() || !draft.location_public_id}>{saving ? "Saving…" : editorMode === "edit" ? "Save changes" : "Create rule"}</button></div>
    </form></div>}
    {editorPicker === "category" && <SearchableFilterPicker title="Choose a Category" icon="tag" selectedId={String(categories.find((category) => categoryOptionLabel(category) === draft.match_value)?.id || "")} emptyLabel="No Category selected" emptyDetail="Return without choosing" contextLabel="DEFAULT RULE" topLayer options={categories.map((category) => ({ id: String(category.id), label: category.name, detail: category.path }))} onChoose={(id) => { const category = categories.find((entry) => String(entry.id) === id); if (category) setDraft((current) => ({ ...current, match_value: categoryOptionLabel(category) })); }} onClose={() => setEditorPicker(null)} />}
    {editorPicker === "location" && <SearchableFilterPicker title="Choose destination Place" icon="pin" selectedId={draft.location_public_id} emptyLabel="No Place selected" emptyDetail="Return without choosing" contextLabel="DEFAULT RULE" topLayer options={flatLocations.map((location) => ({ id: location.public_id, label: location.name, detail: location.path }))} onChoose={(id) => { if (id) setDraft((current) => ({ ...current, location_public_id: id })); }} onClose={() => setEditorPicker(null)} />}
  </section>;
}
