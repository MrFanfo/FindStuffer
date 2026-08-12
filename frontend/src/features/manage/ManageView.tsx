import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  api,
  type AIConnectionDiagnostic,
  type ApplicationSettings,
  type Category,
  type Dashboard,
  type EnrichmentSuggestion,
  HttpRequestError,
  type Item,
  type InventoryDisplaySettings,
  type LocationNode,
  type LocationRule,
  type LocationType,
  type SoftwareUpdateStatus,
} from "../../api";
import { Icon } from "../../components/Icon";
import { SearchAliasManager } from "../../components/SearchAliasManager";
import { formatBytes, SystemInfo } from "./SystemInfo";
import { activityLabel } from "../../domain/inventory";

export type ThemePreference = "light" | "dark" | "system";
type RetryAction = { action: () => Promise<void>; label: string };


export function ManageView({ items, dashboard, locations, categories, locationTypes, units, busy, theme, setNotice, notify, onBack, onThemeChange, onInventoryChanged, onLocations, onCategories, onDefaultRules, onOffCategoryMappings, onInbox, onUnitsChanged }: {
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
  onBack: () => void;
  onThemeChange: (theme: ThemePreference) => void;
  onInventoryChanged: () => Promise<void>;
  onLocations: () => void;
  onCategories: () => void;
  onDefaultRules: () => void;
  onOffCategoryMappings: () => void;
  onInbox: () => void;
  onUnitsChanged: (units: string[]) => void;
}) {
  const [settings, setSettings] = useState<ApplicationSettings | null>(null);
  const [rules, setRules] = useState<LocationRule[]>([]);
  const [suggestions, setSuggestions] = useState<EnrichmentSuggestion[]>([]);
  const [missingEnrichmentCount, setMissingEnrichmentCount] = useState<number | null>(null);
  const [softwareUpdate, setSoftwareUpdate] = useState<SoftwareUpdateStatus | null>(null);
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
  const [manageActivity, setManageActivity] = useState("");
  const [enrichmentFile, setEnrichmentFile] = useState<unknown>(null);
  const [customPlaceType, setCustomPlaceType] = useState("");
  const [customUnit, setCustomUnit] = useState("");

  async function setInventoryDisplay(key: keyof InventoryDisplaySettings, value: boolean) {
    if (!settings) return;
    const next = { ...settings.inventory_display, [key]: value };
    setSettings({ ...settings, inventory_display: next });
    try {
      const saved = await api.saveInventoryDisplaySettings(next);
      setSettings((current) => current ? { ...current, inventory_display: saved } : current);
      setNotice("Inventory display updated");
    } catch (error) {
      await load();
      setNotice(error instanceof Error ? error.message : "Could not update inventory display");
    }
  }

  const load = useCallback(async () => {
    try {
      const [nextSettings, nextRules, nextSuggestions, nextEnrichmentStatus, nextUpdate] = await Promise.all([
        api.settings(),
        api.locationRules(),
        api.enrichmentSuggestions("pending"),
        api.enrichmentStatus(),
        api.softwareUpdateStatus(),
      ]);
      setSettings({
        ...nextSettings,
        inventory_display: nextSettings.inventory_display || {
          show_photo: true,
          show_location: true,
          show_category: true,
          show_quantity: true,
          show_brand: false,
          show_model: false,
        },
      });
      setSoftwareUpdate(nextUpdate);
      onUnitsChanged(nextSettings.units);
      setRules(nextRules);
      setSuggestions(nextSuggestions);
      setMissingEnrichmentCount(nextEnrichmentStatus.missing);
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
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load management data");
    }
  }, [onUnitsChanged, setNotice]);
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

  async function requestUpdate() {
    if (!window.confirm("Install the latest FindStuffer release? The app will restart when the update finishes.")) return;
    await perform(async () => {
      const status = await api.requestSoftwareUpdate();
      setSoftwareUpdate(status);
    }, "Software update queued");
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
    <section className="workspace-page manage-page settings-workspace">
      <header className="workspace-header"><button className="text-button workspace-back" onClick={onBack}><Icon name="chevron" size={16} />Extra</button><p className="eyebrow">SETTINGS</p><h1>Make Findstuff yours</h1><p>Choose how inventory looks, adjust app behavior, connect services, and inspect this installation.</p></header>
      {manageActivity && <div className="inline-activity manage-activity" role="status"><span className="activity-spinner" />{manageActivity}</div>}
      <button className="feature-link ai-inbox-link" onClick={onInbox}><span><Icon name="spark" /></span><div><strong>AI Inbox</strong><small>Review photos and approve, edit, or reject suggested Items</small></div><Icon name="chevron" /></button>
      <button className="feature-link" onClick={onLocations}><span><Icon name="pin" /></span><div><strong>Places</strong><small>Build your room, shelf, drawer, and box hierarchy</small></div><Icon name="chevron" /></button>
      <button className="feature-link" onClick={onCategories}><span><Icon name="tag" /></span><div><strong>Categories</strong><small>{categories.length} Categories · hierarchy, details, and default Places</small></div><Icon name="chevron" /></button>
      <button className="feature-link" onClick={onOffCategoryMappings}><span><Icon name="spark" /></span><div><strong>Open Food Facts category mapping</strong><small>Review scanned categories, assignments, and JSON imports</small></div><Icon name="chevron" /></button>

      <details><summary><span className="summary-icon"><Icon name="settings" /></span><span><strong>Appearance</strong><small>{theme === "system" ? "Follows this device" : `${theme[0].toUpperCase()}${theme.slice(1)} theme`}</small></span><Icon name="chevron" /></summary><div className="manage-panel"><div className="theme-options" role="radiogroup" aria-label="Color theme">{(["light", "dark", "system"] as ThemePreference[]).map((option) => <button type="button" role="radio" aria-checked={theme === option} className={theme === option ? "active" : ""} key={option} onClick={() => onThemeChange(option)}><span className={`theme-preview ${option}`} aria-hidden="true" /><strong>{option === "system" ? "Device" : option[0].toUpperCase() + option.slice(1)}</strong><small>{option === "system" ? "Match system setting" : `${option} colors`}</small></button>)}</div></div></details>

      <details><summary><span className="summary-icon"><Icon name="box" /></span><span><strong>Inventory cards</strong><small>Choose the details shown in every Item row</small></span><Icon name="chevron" /></summary><div className="manage-panel inventory-display-settings"><p className="panel-copy">Names always remain visible and wrap on small screens. Brand is hidden by default to leave more room.</p><div>{settings && ([
        ["show_photo", "Photo", "Item image or placeholder"],
        ["show_location", "Place", "Where the Item is stored"],
        ["show_category", "Category", "Category badge beside the name"],
        ["show_quantity", "Quantity", "Current amount and unit"],
        ["show_brand", "Brand", "Brand below the Item name"],
        ["show_model", "Model", "Model below the Item name"],
      ] as Array<[keyof InventoryDisplaySettings, string, string]>).map(([key, label, detail]) => <label className="display-option" key={key}><span><strong>{label}</strong><small>{detail}</small></span><input type="checkbox" checked={settings.inventory_display[key]} onChange={(event) => void setInventoryDisplay(key, event.target.checked)} /></label>)}</div></div></details>

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

      <details><summary><span className="summary-icon"><Icon name="spark" /></span><span><strong>Recent activity</strong><small>{dashboard?.recent_events.length ? "Latest inventory changes" : "No changes yet"}</small></span><Icon name="chevron" /></summary><div className="manage-panel"><div className="event-list">{!dashboard?.recent_events.length && <div className="empty-inline"><span>Changes will appear here</span></div>}{dashboard?.recent_events.slice(0, 12).map((event, index) => <div className="event" key={`${event.created_at}-${index}`}><span>{activityLabel(event.action)}</span><strong>{event.item_name}</strong><time>{new Date(`${event.created_at}Z`).toLocaleString()}</time></div>)}</div></div></details>

      <button className="feature-link" onClick={onDefaultRules}><span><Icon name="settings" /></span><div><strong>Default locations</strong><small>{rules.length} rules · search, edit, and inspect automatic destinations</small></div><Icon name="chevron" /></button>

      <details><summary><span className="summary-icon"><Icon name="settings" /></span><span><strong>Customization</strong><small>{locationTypes.length} Place types · {units.length} units of measure</small></span><Icon name="chevron" /></summary><div className="manage-panel customization-panel">
        <section className="customization-group"><div><strong>Place types</strong><small>Names available when creating or editing a Place</small></div><div className="type-chip-row">{locationTypes.map((entry) => <span key={entry.name}>{entry.name}</span>)}</div><form className="form-card compact-form type-form" onSubmit={addPlaceType}><label>New Place type<input value={customPlaceType} onChange={(event) => setCustomPlaceType(event.target.value)} placeholder="crate, suitcase, rack…" maxLength={40} /></label><button className="secondary" disabled={!customPlaceType.trim()}>Add Place type</button></form></section>
        <section className="customization-group"><div><strong>Units of measure</strong><small>Units available when recording Item quantities</small></div><div className="type-chip-row">{units.map((entry) => <span key={entry}>{entry}<button type="button" aria-label={`Remove ${entry}`} onClick={() => void removeUnit(entry)}><Icon name="close" size={12} /></button></span>)}</div><form className="form-card compact-form type-form" onSubmit={addUnit}><label>New unit<input value={customUnit} onChange={(event) => setCustomUnit(event.target.value)} placeholder="tray, bottle, reel, sheet…" maxLength={24} /></label><button className="secondary" disabled={!customUnit.trim()}>Add unit</button></form></section>
      </div></details>

      <details><summary><span className="summary-icon"><Icon name="settings" /></span><span><strong>Notifications</strong><small>{notificationsEnabled ? "ntfy alerts enabled" : "Alerts are off"}</small></span><Icon name="chevron" /></summary><div className="manage-panel"><form className="form-card compact-form" onSubmit={saveNotifications}><label className="toggle"><input type="checkbox" checked={notificationsEnabled} onChange={(event) => setNotificationsEnabled(event.target.checked)} /><span><strong>Enable notifications</strong><small>Low stock and upcoming expiration alerts</small></span></label><label>ntfy topic URL<input type="url" value={notificationUrl} onChange={(event) => setNotificationUrl(event.target.value)} placeholder="https://ntfy.sh/your-private-topic" /></label><label>Access token {settings?.notifications.ntfy_token_set && <small>(saved)</small>}<input type="password" value={notificationToken} onChange={(event) => setNotificationToken(event.target.value)} placeholder="Leave blank to keep existing" /></label><label>Warn before expiration<input type="number" min="0" max="365" value={expirationDays} onChange={(event) => setExpirationDays(event.target.value)} /><small>Days before the expiration date</small></label><button className="secondary">Save notifications</button></form><button className="outline-button" onClick={() => void perform(() => api.testNotification(), "Test notification sent")}>Send test notification</button></div></details>

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
      <SystemInfo system={system} diskFreePercent={diskFreePercent} setupHealth={setupHealth} onRefresh={() => void load()} />
    </section>
  );
}
