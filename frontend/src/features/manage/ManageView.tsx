import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  flattenLocations,
  type AIConnectionDiagnostic,
  type ApplicationSettings,
  type Category,
  type CategoryCapabilities,
  type Dashboard,
  type EnrichmentSuggestion,
  HttpRequestError,
  type ImportBatch,
  type ImportPreviewDetail,
  type Item,
  type LocationNode,
  type LocationRule,
  type LocationType,
  type Loan,
  type Project,
  type SoftwareUpdateStatus,
} from "../../api";
import { Icon } from "../../components/Icon";
import { SearchAliasManager } from "../../components/SearchAliasManager";
import { capabilitiesForCategory, categoryOptionLabel } from "../capture/itemCaptureUtils";

export type ThemePreference = "light" | "dark" | "system";
type RetryAction = { action: () => Promise<void>; label: string };

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

function hasLostTag(item: Item): boolean {
  return item.tags.some((tag) => tag.toLowerCase() === "lost");
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

export function ManageView({ items, dashboard, locations, categories, locationTypes, units, busy, theme, setNotice, notify, onThemeChange, onInventoryChanged, onLocations, onCategories, onDefaultRules, onOffCategoryMappings, onInbox, onOpenItem, onMarkFound, onForeverLost, onUnitsChanged }: {
  items: Item[];
  dashboard: Dashboard | null;
  locations: LocationNode[];
  categories: Category[];
  locationTypes: LocationType[];
  units: string[];
  busy: boolean;
  theme: ThemePreference;
  setNotice: (message: string) => void;
  notify: (message: string, action?: RetryAction) => void;
  onThemeChange: (theme: ThemePreference) => void;
  onInventoryChanged: () => Promise<void>;
  onLocations: () => void;
  onCategories: () => void;
  onDefaultRules: () => void;
  onOffCategoryMappings: () => void;
  onInbox: () => void;
  onOpenItem: (item: Item) => void;
  onMarkFound: (item: Item) => Promise<void>;
  onForeverLost: (item: Item) => Promise<void>;
  onUnitsChanged: (units: string[]) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [settings, setSettings] = useState<ApplicationSettings | null>(null);
  const [rules, setRules] = useState<LocationRule[]>([]);
  const [suggestions, setSuggestions] = useState<EnrichmentSuggestion[]>([]);
  const [archivedItems, setArchivedItems] = useState<Item[]>([]);
  const [missingEnrichmentCount, setMissingEnrichmentCount] = useState<number | null>(null);
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
  const [customPlaceType, setCustomPlaceType] = useState("");
  const [customUnit, setCustomUnit] = useState("");
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);
  const reservableItems = useMemo(
    () => items.filter((item) => capabilitiesForCategory(categories, item.category_id).reservation),
    [categories, items],
  );
  const lostItems = useMemo(() => items.filter(hasLostTag), [items]);

  const load = useCallback(async () => {
    try {
      const [nextProjects, nextLoans, nextSettings, nextRules, nextSuggestions, nextArchivedItems, nextEnrichmentStatus, nextUpdate, nextImports] = await Promise.all([
        api.projects(),
        api.loans(),
        api.settings(),
        api.locationRules(),
        api.enrichmentSuggestions("pending"),
        api.archivedItems(),
        api.enrichmentStatus(),
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
      setArchivedItems(nextArchivedItems);
      setMissingEnrichmentCount(nextEnrichmentStatus.missing);
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
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load management data");
    }
  }, [items, loanItem, reservableItems, reserveItem, reserveProject, setNotice]);
  useEffect(() => { void load(); }, []);

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

  async function restoreArchivedItem(item: Item) {
    await perform(async () => {
      await api.restoreItem(item.public_id);
      await onInventoryChanged();
    }, `${item.name} restored to Inventory`);
  }

  async function permanentlyDeleteArchivedItem(item: Item) {
    if (!window.confirm(
      `Delete ${item.name} forever?\n\nThis permanently removes the Item, its photos, and its history. This cannot be undone.`,
    )) return;
    await perform(async () => {
      await api.hardDeleteItem(item);
      await onInventoryChanged();
    }, `${item.name} permanently deleted`);
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    await perform(() => api.createProject(projectName, projectDescription), "Project created");
    setProjectName(""); setProjectDescription("");
  }

  async function requestUpdate() {
    if (!window.confirm("Install the latest FindStuffer release? The app will restart when the update finishes.")) return;
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
      notify_warranty: true,
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
      void load();
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

  async function addPlaceType(event: FormEvent) {
    event.preventDefault();
    const name = customPlaceType.trim();
    if (!name) return;
    await perform(async () => {
      await api.createLocationType(name);
      await onInventoryChanged();
    }, "Place type added");
    setCustomPlaceType("");
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

  function downloadImportTemplate() {
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
    const availableLocations = flatLocations.map((location) => ({
      public_id: location.public_id,
      path: location.path,
      kind: location.kind,
    }));
    const templateHelp = {
      purpose: "Give this file to a chatbot together with a plain-language list of the inventory changes you want. The chatbot must return one completed findstuff-ops-v1 JSON document for Findstuff to preview.",
      suggested_chatbot_prompt: [
        "Read the instructions and available values in the attached Findstuff operations template.",
        "Create the operations needed for the changes I describe below.",
        "Return only valid JSON with format exactly findstuff-ops-v1 and an operations array. Do not return Markdown, commentary, or code fences.",
        "Do not guess ambiguous existing records. Use IDs or full paths from the template where possible, and ask me for clarification if a safe match is not possible.",
        "My requested changes:",
        "- Replace this line with what to add, adjust, move, update, archive, or reorganize.",
      ],
      workflow: [
        "In Findstuff, open Manage > Backup & data > Import operations with a chatbot.",
        "Download this template. It is generated with the current categories, locations, location kinds, and units.",
        "Attach the template to a chatbot and describe the changes in ordinary language. You can request several kinds of change in one conversation.",
        "Save the chatbot's JSON response as a .json file without reformatting it.",
        "Back in Findstuff, choose that JSON under Import data. Findstuff previews every operation against a temporary copy of the current inventory.",
        "Review all counts and dry-run details. If there are errors, do not merge; give the errors to the chatbot and ask it for corrected JSON.",
        "When the preview is clean, click Merge into this inventory.",
        "If needed, use Undo under Recent imports. Findstuff retains the latest five tracked imports.",
      ],
      file_format: {
        format: "The root object must keep format exactly equal to findstuff-ops-v1. This tells Findstuff this is an operations import, not a full database export.",
        operations: "The root operations field must be an array. Each array entry is one change to preview and then apply in order.",
        comments: "JSON does not support comments. Put guidance only in the instructions object, then keep operations valid JSON.",
        unknown_fields: "Do not invent field names. Use only the fields documented here unless the user explicitly asks for custom notes text.",
      },
      how_to_use: [
        "Fill the root operations array with only the changes requested by the user.",
        "The examples are reference material inside instructions.operation_examples; do not copy examples unless the user actually requested those changes.",
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
      operation_examples: {
        add_items: [
          {
            op: "add",
            type: "item",
            data: {
              name: "Example item name",
              category: availableCategories[0]?.path || "",
              location: availableLocations[0]?.path || "",
              quantity: "1",
              unit: units[0] || "pcs",
              notes: "",
              tags: ["example"],
              barcode: "",
            },
          },
        ],
        adjust_quantities: [
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
        move_or_update_items: [
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
        add_categories_and_locations: [
          {
            op: "add",
            type: "category",
            data: {
              name: "New subcategory",
              parent: availableCategories[0]?.path || "",
              default_location: availableLocations[0]?.path || null,
            },
          },
          {
            op: "add",
            type: "location",
            data: {
              name: "New box or shelf",
              kind: locationTypes[0]?.name || "location",
              parent: availableLocations[0]?.path || "",
              description: "",
            },
          },
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
        estimated_price_minor: "integer cents",
        estimated_price_currency: "3-letter currency code, for example EUR",
        links: [{ label: "Manual", url: "https://example.com/manual.pdf" }],
      },
      item_rules: [
        "name is required for add item.",
        "category may be a category path, category id, or empty/null for no category.",
        "location may be a location path or public_id. If omitted during add, Findstuff uses the category default location when available, otherwise Unassigned.",
        "quantity replaces the current quantity. add_quantity and remove_quantity adjust the current quantity and should be used for stock changes.",
        "links must be an array of objects. Each link object needs label and url.",
        "expiration_date must be YYYY-MM-DD or null.",
        "purchase_price_minor and estimated_price_minor are integer minor currency units, for example cents.",
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
      _available_categories: availableCategories,
      _available_locations: availableLocations,
      operations: [],
    };
    downloadJsonTemplate("findstuff-operations-template.json", base);
    setNotice("Operations template downloaded");
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
  const updateLabel = softwareUpdate?.status === "queued" || softwareUpdate?.status === "running"
    ? "Updating…"
    : softwareUpdate?.status === "failed" || softwareUpdate?.status === "attention"
      ? "Needs attention"
      : softwareUpdate?.update_available === true
        ? "Update available"
        : softwareUpdate?.update_available === false
          ? "Up to date"
          : "Check for updates";

  return (
    <section className="manage-page">
      {manageActivity && <div className="inline-activity manage-activity" role="status"><span className="activity-spinner" />{manageActivity}</div>}
      <button className="feature-link ai-inbox-link" onClick={onInbox}><span><Icon name="spark" /></span><div><strong>AI Inbox</strong><small>Review photos and approve, edit, or reject suggested Items</small></div><Icon name="chevron" /></button>
      <button className="feature-link" onClick={onLocations}><span><Icon name="pin" /></span><div><strong>Places</strong><small>Build your room, shelf, drawer, and box hierarchy</small></div><Icon name="chevron" /></button>
      <button className="feature-link" onClick={onCategories}><span><Icon name="tag" /></span><div><strong>Categories</strong><small>{categories.length} Categories · hierarchy, details, and default Places</small></div><Icon name="chevron" /></button>
      <button className="feature-link" onClick={onOffCategoryMappings}><span><Icon name="spark" /></span><div><strong>Open Food Facts category mapping</strong><small>Review scanned categories, assignments, and JSON imports</small></div><Icon name="chevron" /></button>

      <details><summary><span className="summary-icon"><Icon name="settings" /></span><span><strong>Appearance</strong><small>{theme === "system" ? "Follows this device" : `${theme[0].toUpperCase()}${theme.slice(1)} theme`}</small></span><Icon name="chevron" /></summary><div className="manage-panel"><div className="theme-options" role="radiogroup" aria-label="Color theme">{(["light", "dark", "system"] as ThemePreference[]).map((option) => <button type="button" role="radio" aria-checked={theme === option} className={theme === option ? "active" : ""} key={option} onClick={() => onThemeChange(option)}><span className={`theme-preview ${option}`} aria-hidden="true" /><strong>{option === "system" ? "Device" : option[0].toUpperCase() + option.slice(1)}</strong><small>{option === "system" ? "Match system setting" : `${option} colors`}</small></button>)}</div></div></details>

      <details><summary><span className="summary-icon"><Icon name="search" /></span><span><strong>Search language</strong><small>Aliases, nicknames, and household terms</small></span><Icon name="chevron" /></summary><div className="manage-panel"><SearchAliasManager items={items} locations={locations} /></div></details>

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
      <details><summary><span className="summary-icon"><Icon name="box" /></span><span><strong>Archived Items</strong><small>{archivedItems.length ? `${archivedItems.length} archived` : "Archive is empty"}</small></span><Icon name="chevron" /></summary><div className="manage-panel">
        <p className="panel-copy">Archived Items stay out of Inventory but remain available to restore. Delete forever permanently removes the Item, its photos, and its history.</p>
        <div className="archived-list">
          {archivedItems.length === 0 && <div className="empty-inline"><span>No archived Items</span></div>}
          {archivedItems.map((item) => <article className="archived-row" key={item.public_id}>
            {item.primary_photo_url ? <img src={item.primary_photo_url} alt="" /> : <span className="archived-placeholder"><Icon name="box" size={19} /></span>}
            <div className="archived-main"><strong>{item.name}</strong><small>{item.location_path}{item.category_path ? ` · ${item.category_path}` : ""}</small><time>Archived {item.archived_at ? new Date(`${item.archived_at}Z`).toLocaleString() : "recently"}</time></div>
            <div className="archived-actions"><button className="secondary" type="button" disabled={busy} onClick={() => void restoreArchivedItem(item)}><Icon name="check" size={14} />Restore</button><button className="danger-button" type="button" disabled={busy} onClick={() => void permanentlyDeleteArchivedItem(item)}><Icon name="close" size={14} />Delete forever</button></div>
          </article>)}
        </div>
      </div></details>
      <details><summary><span className="summary-icon"><Icon name="spark" /></span><span><strong>Recent activity</strong><small>{dashboard?.recent_events.length ? "Latest inventory changes" : "No changes yet"}</small></span><Icon name="chevron" /></summary><div className="manage-panel"><div className="event-list">{!dashboard?.recent_events.length && <div className="empty-inline"><span>Changes will appear here</span></div>}{dashboard?.recent_events.slice(0, 12).map((event, index) => <div className="event" key={`${event.created_at}-${index}`}><span>{activityLabel(event.action)}</span><strong>{event.item_name}</strong><time>{new Date(`${event.created_at}Z`).toLocaleString()}</time></div>)}</div></div></details>

      <button className="feature-link" onClick={onDefaultRules}><span><Icon name="settings" /></span><div><strong>Default locations</strong><small>{rules.length} rules · search, edit, and inspect automatic destinations</small></div><Icon name="chevron" /></button>

      <details><summary><span className="summary-icon"><Icon name="settings" /></span><span><strong>Customization</strong><small>{locationTypes.length} Place types · {units.length} units of measure</small></span><Icon name="chevron" /></summary><div className="manage-panel customization-panel">
        <section className="customization-group"><div><strong>Place types</strong><small>Names available when creating or editing a Place</small></div><div className="type-chip-row">{locationTypes.map((entry) => <span key={entry.name}>{entry.name}</span>)}</div><form className="form-card compact-form type-form" onSubmit={addPlaceType}><label>New Place type<input value={customPlaceType} onChange={(event) => setCustomPlaceType(event.target.value)} placeholder="crate, suitcase, rack…" maxLength={40} /></label><button className="secondary" disabled={!customPlaceType.trim()}>Add Place type</button></form></section>
        <section className="customization-group"><div><strong>Units of measure</strong><small>Units available when recording Item quantities</small></div><div className="type-chip-row">{units.map((entry) => <span key={entry}>{entry}<button type="button" aria-label={`Remove ${entry}`} onClick={() => void removeUnit(entry)}><Icon name="close" size={12} /></button></span>)}</div><form className="form-card compact-form type-form" onSubmit={addUnit}><label>New unit<input value={customUnit} onChange={(event) => setCustomUnit(event.target.value)} placeholder="tray, bottle, reel, sheet…" maxLength={24} /></label><button className="secondary" disabled={!customUnit.trim()}>Add unit</button></form></section>
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
        <details className="nested-form import-template-box"><summary>Import operations with a chatbot</summary><div className="import-template-grid"><p className="panel-copy">Download one guide containing every operation type plus your current Categories, Places, Place types, and units. Attach it to a chatbot, describe the changes you want, then bring its JSON response back here for preview.</p><button type="button" className="secondary button-with-icon" onClick={downloadImportTemplate}><Icon name="spark" size={15} />Download operations template</button></div></details>
        <label className="upload-import"><strong>Import data</strong><span>Choose a Findstuff export or changes file to preview it first.</span><input type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && void readImport(event.target.files[0])} /></label>
        {importSummary && <div className="import-preview"><strong>{importErrors.length ? "Import needs fixes" : "Ready to merge"}</strong>{Object.entries(importSummary).map(([name, count]) => <p key={name}><span>{name}</span><b>{count}</b></p>)}{importDetails.length > 0 && <div className="import-detail-list"><span>Dry-run details</span>{importDetails.map((detail) => <article className={`import-detail ${detail.status}`} key={`${detail.index}-${detail.label}`}><b>{detail.status}</b><div><strong>{detail.label}</strong><small>{detail.message}</small></div></article>)}</div>}{importErrors.length > 0 && <div className="import-errors">{importErrors.map((error, index) => <small key={`${index}-${error}`}>{error}</small>)}</div>}<button className="primary" disabled={busy || !importPayload || importErrors.length > 0} onClick={() => void mergeImport()}>Merge into this inventory</button></div>}
        <div className="import-history"><strong>Recent imports</strong><small>Only the latest five are kept; older import history is removed automatically.</small>{importBatches.length === 0 && <div className="empty-inline"><span>No undoable imports yet</span></div>}{importBatches.map((batch) => <article className="import-batch" key={batch.public_id}><div><strong>{batch.mode === "operations" ? "Changes import" : "Data import"}</strong><small>{new Date(batch.created_at).toLocaleString()} · {importBatchSummary(batch)}</small>{batch.undone_at && <em>Undone {new Date(batch.undone_at).toLocaleString()}</em>}</div><button className="secondary" disabled={busy || Boolean(batch.undone_at)} onClick={() => void undoImport(batch)}>Undo</button></article>)}</div>
      </div></details>

      <details><summary><span className="summary-icon"><Icon name="settings" /></span><span><strong>Software update</strong><small>{updateLabel}</small></span><Icon name="chevron" /></summary><div className="manage-panel">
        <p className="panel-copy">{softwareUpdate?.enabled ? "Install published FindStuffer releases without leaving the app." : "In-app updates are disabled for this installation. Update safely on the Linux machine with ./update-docker.sh."}</p>
        <div className="integration-list update-status-list">
          <p><span>Status</span><b className={`integration-status ${updateLabel === "Up to date" ? "ready" : ""}`}>{updateLabel}</b></p>
          <p><span>Installed version</span><code>{softwareUpdate?.current_version || system?.app.version || "Unknown"}</code></p>
          {softwareUpdate?.latest_version && <p><span>Latest release</span>{softwareUpdate.release_url ? <a href={softwareUpdate.release_url} target="_blank" rel="noreferrer">v{softwareUpdate.latest_version}</a> : <code>{softwareUpdate.latest_version}</code>}</p>}
          {softwareUpdate?.completed_at && <p><span>Finished</span><small>{new Date(softwareUpdate.completed_at).toLocaleString()}</small></p>}
        </div>
        {softwareUpdate?.log_tail && softwareUpdate.log_tail.length > 0 && <details className="nested-form" open={softwareUpdate.status === "failed" || softwareUpdate.status === "attention"}><summary>Recent updater log · last 30 lines</summary><pre className="log-tail">{softwareUpdate.log_tail.join("\n")}</pre></details>}
        <div className="button-row">{softwareUpdate?.enabled && <button className="primary" disabled={busy || softwareUpdate?.status === "running" || softwareUpdate?.status === "queued" || softwareUpdate?.update_available === false} onClick={() => void requestUpdate()}><Icon name="spark" size={16} />Install update</button>}<button className="secondary" disabled={busy} onClick={() => void perform(async () => setSoftwareUpdate(await api.softwareUpdateStatus()), "Update status refreshed")}>Check again</button></div>
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
          {settings?.integrations.ai.usage && <div className="ai-usage-card">
            <div><strong>AI usage this month</strong><small>Provider-reported tokens when available; otherwise a text estimate.</small></div>
            <div className="ai-usage-grid">
              <span><small>Calls</small><strong>{settings.integrations.ai.usage.calls.toLocaleString()}</strong></span>
              <span><small>Input tokens</small><strong>{settings.integrations.ai.usage.input_tokens.toLocaleString()}</strong></span>
              <span><small>Output tokens</small><strong>{settings.integrations.ai.usage.output_tokens.toLocaleString()}</strong></span>
              <span className={settings.integrations.ai.usage.failed_calls ? "warning" : ""}><small>Failed</small><strong>{settings.integrations.ai.usage.failed_calls.toLocaleString()}</strong></span>
            </div>
            <p>{settings.integrations.ai.usage.scan_calls} image scan{settings.integrations.ai.usage.scan_calls === 1 ? "" : "s"} · {settings.integrations.ai.usage.command_calls} command{settings.integrations.ai.usage.command_calls === 1 ? "" : "s"} · {settings.integrations.ai.usage.all_time_calls} calls all time</p>
            {settings.integrations.ai.usage.image_bytes_saved > 0 && <p>{formatBytes(settings.integrations.ai.usage.image_bytes_saved)} of image upload data avoided by resizing and compression.</p>}
            <small>Vision-image token accounting varies by provider. Barcode scans are excluded because they use local decoding and Open Food Facts—not AI.</small>
          </div>}
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
      <details><summary><span className="summary-icon"><Icon name="spark" /></span><span><strong>Enrichment queue</strong><small>{missingEnrichmentCount === null ? "Checking barcode Items…" : missingEnrichmentCount ? `${missingEnrichmentCount} barcode Item${missingEnrichmentCount === 1 ? "" : "s"} missing enrichment` : "No barcode Items are missing enrichment"}</small></span><Icon name="chevron" /></summary><div className="manage-panel"><div className={`enrichment-missing-card ${missingEnrichmentCount === 0 ? "complete" : ""}`}><span><Icon name={missingEnrichmentCount === 0 ? "check" : "qr"} size={21} /></span><div><strong>{missingEnrichmentCount ?? "—"}</strong><small>barcode Item{missingEnrichmentCount === 1 ? "" : "s"} missing enrichment</small></div></div><p className="panel-copy">Queue eligible barcode Items that Open Food Facts has not enriched yet, then process a small batch. Automatic maintenance handles this periodically.</p><div className="button-row"><button className="secondary" disabled={!missingEnrichmentCount} onClick={() => void perform(() => api.queueMissingEnrichment(), "Missing enrichment jobs queued")}>Queue missing</button><button className="primary" onClick={() => void perform(() => api.runEnrichment(), "Enrichment batch processed")}>Run batch now</button></div><small>Current provider: Open Food Facts.</small></div></details>
      <details><summary><span className="summary-icon"><Icon name="spark" /></span><span><strong>External enrichment review</strong><small>{suggestions.length} pending imported suggestion{suggestions.length === 1 ? "" : "s"}</small></span><Icon name="chevron" /></summary><div className="manage-panel">
        <p className="panel-copy">Export missing/weak metadata, let an external agent research it, import the response, then review patches before they change your inventory.</p>
        <div className="button-row"><button className="secondary" onClick={() => void perform(downloadEnrichmentExport, "Enrichment request downloaded")}>Export request JSON</button><label className="upload-import compact-upload"><strong>Import response JSON</strong><input type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && void readEnrichmentResponse(event.target.files[0])} /></label></div>
        {enrichmentFile !== null && <button className="primary wide" onClick={() => void perform(async () => { const result = await api.importEnrichmentResponse(enrichmentFile); setEnrichmentFile(null); await load(); return result; }, "Enrichment response imported")}>Validate and import suggestions</button>}
        <div className="suggestion-list">{suggestions.length === 0 && <div className="empty-inline"><span>No pending suggestions</span></div>}{suggestions.map((suggestion) => <article className="suggestion-row" key={suggestion.public_id}><div><strong>{suggestion.item_name}</strong><small>{suggestion.path} · {Math.round(suggestion.confidence * 100)}% confidence</small><code>{typeof suggestion.value === "object" ? JSON.stringify(suggestion.value) : String(suggestion.value)}</code>{suggestion.sources[0]?.url && <a href={suggestion.sources[0].url} target="_blank" rel="noreferrer">{suggestion.sources[0].label || "Source"}</a>}{suggestion.uncertainty && <em>{suggestion.uncertainty}</em>}</div><div><button className="primary" onClick={() => void perform(async () => { await api.acceptSuggestion(suggestion.public_id); await onInventoryChanged(); }, "Suggestion accepted")}>Accept</button><button onClick={() => void perform(() => api.rejectSuggestion(suggestion.public_id), "Suggestion rejected")}>Reject</button></div></article>)}</div>
      </div></details>
      <details className="app-info-section"><summary><span className="summary-icon"><Icon name="settings" /></span><span><strong>App info</strong><small>{setupHealth.some((entry) => entry.status === "Needs attention") ? `${setupHealth.filter((entry) => entry.status === "Needs attention").length} need attention` : system ? `Everything ready · version ${system.app.version}` : "Health, storage, resources, and version"}</small></span><Icon name="chevron" /></summary><div className="manage-panel app-info-panel">
        <section className="app-info-health"><div className="section-heading"><div><h2>Setup health</h2><span>Connection, protection, Backups, integrations, and updates</span></div></div><div className="setup-health-grid">{setupHealth.map((entry) => <article key={entry.label}><span>{entry.label}</span><b className={`health-status ${entry.status.toLowerCase().replace(" ", "-")}`}>{entry.status}</b><small>{entry.detail}</small></article>)}</div></section>
        {system ? <>
          <div className="section-heading app-info-metrics-heading"><div><h2>Storage & resources</h2><span>Current usage on this FindStuffer machine</span></div></div>
          <div className="app-metric-grid">
            <div><span>Total data</span><strong>{formatBytes(system.storage.total_managed_bytes)}</strong><small>Database + photos + documents</small></div>
            <div><span>Database</span><strong>{formatBytes(system.storage.database_bytes)}</strong><small>{formatBytes(system.storage.database_main_bytes)} main · {formatBytes(system.storage.database_wal_bytes)} WAL</small></div>
            <div><span>Photos</span><strong>{formatBytes(system.storage.photos_bytes)}</strong><small>{system.inventory.photos} saved photo{system.inventory.photos === 1 ? "" : "s"}</small></div>
            <div><span>Documents</span><strong>{formatBytes(system.storage.documents_bytes)}</strong><small>{system.inventory.documents} owned document{system.inventory.documents === 1 ? "" : "s"}</small></div>
            <div><span>App CPU</span><strong>{system.resources.cpu_percent.toFixed(1)}%</strong><small>{system.resources.cpu_count} CPU core{system.resources.cpu_count === 1 ? "" : "s"} available</small></div>
            <div><span>App RAM</span><strong>{formatBytes(system.resources.memory_rss_bytes)}</strong><small>Current resident memory</small></div>
            <div><span>Disk free</span><strong>{formatBytes(system.storage.disk_free_bytes)}</strong><small>{diskFreePercent}% of {formatBytes(system.storage.disk_total_bytes)}</small></div>
          </div>
          <div className="integration-list app-info-list"><p><span>Inventory</span><small>{system.inventory.items} Items · {system.inventory.locations} Places · {system.inventory.categories} Categories</small></p><p><span>Version</span><code>{system.app.version}</code></p><p><span>License</span><a href="https://github.com/MrFanfo/FindStuffer" target="_blank" rel="noreferrer">AGPL-3.0-only · Source code</a></p><p><span>Running for</span><small>{formatUptime(system.app.uptime_seconds)}</small></p></div>
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
    </section>
  );
}
