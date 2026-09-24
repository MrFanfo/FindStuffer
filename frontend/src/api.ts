export type LocationNode = {
  public_id: string;
  name: string;
  kind: string;
  description: string;
  path: string;
  item_count?: number;
  total_item_count?: number;
  /** The icon chosen for this place; empty means the interface suggests one. */
  icon?: string;
  children: LocationNode[];
};

export type LocationType = {
  name: string;
  icon: string;
  sort_order: number;
};

export type LocationRule = {
  public_id: string;
  rule_type: "name" | "barcode" | "category";
  match_value: string;
  priority: number;
  enabled: boolean;
  location_public_id: string;
  location_name: string;
};

export type ImportBatch = {
  public_id: string;
  mode: string;
  summary: Record<string, number>;
  undo_count: number;
  undone_at: string | null;
  created_at: string;
};

export type ImportPreviewDetail = {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  moved?: boolean;
  validation_status?: "valid" | "warning" | "failed";
  source_after?: Record<string, unknown>;
  transferred_quantity?: string;
  warnings?: string[];
  table?: string;
  row_index?: number;
  index: number;
  action: string;
  entity: string;
  label: string;
  status: string;
  message: string;
};

export type CategoryIconSet = {
  format: string;
  version: number;
  icons: Array<{ slug: string; path: string; icon: string }>;
};

export type CategoryIconImportResult = {
  applied: boolean;
  matched: number;
  unmatched: string[];
  unmatched_count: number;
  invalid: string[];
  invalid_count: number;
};

export type CategoryMarkSet = { format: string; version: number; marks: Record<string, string> };

export type CategoryMarkImportResult = {
  applied: boolean;
  added: string[];
  replaced: string[];
  added_count: number;
  replaced_count: number;
  rejected: Array<{ name: string; reason: string }>;
  rejected_count: number;
};

export type Category = {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  icon: string;
  path: string;
  depth: number;
  sort_order: number;
  item_count: number;
  total_item_count: number;
  default_location: { public_id: string; name: string } | null;
  capabilities: CategoryCapabilities;
};

export type CategoryCapabilities = {
  documents: boolean;
  related: boolean;
  fullness: boolean;
  expiration: boolean;
  batches: boolean;
  maintenance: boolean;
  reservation: boolean;
  enrichment: boolean;
  photos: boolean;
  identity: boolean;
  specs: boolean;
  price: boolean;
  links: boolean;
  shopping_list: boolean;
  low_stock: boolean;
  override: boolean;
  inherited_from: number | null;
  inherited_label: string;
};

export type Item = {
  project_holds?: Array<{public_id: string; name: string; quantity: string}>;
  container_item_id?: string | null;
  is_container?: boolean;
  direct_location_public_id?: string | null;
  containment_path?: string;
  contents_count?: number;
  /** In a category view, how many of the category's items this container holds. */
  contained_matches?: number;
  container_chain?: Array<{public_id: string; name: string}>;
  custom_fields?: Record<string, unknown>;
  public_id: string;
  version: number;
  name: string;
  description: string;
  notes: string;
  category_id: number | null;
  category_name: string | null;
  category_slug: string | null;
  category_parent_id: number | null;
  category_path: string | null;
  location_public_id: string;
  location_name: string;
  location_path: string;
  quantity: string;
  unit: string;
  purchase_price_minor: number | null;
  purchase_currency: string | null;
  estimated_price_minor: number | null;
  estimated_price_currency: string | null;
  estimated_price_at: string | null;
  weight_g: number | null;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  brand: string;
  model: string;
  serial_number: string;
  expiration_date: string | null;
  low_stock_threshold: string | null;
  /** False when the item's category does not track low stock; the threshold is kept. */
  low_stock_enabled?: boolean;
  fullness_percent: number | null;
  barcode: string;
  links: Array<{ label: string; url: string }>;
  tags: string[];
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  primary_photo_url?: string | null;
};

export type ItemLot = {
  public_id: string;
  quantity: string;
  expiration_date: string | null;
  note: string;
  created_at: string;
  updated_at: string;
};

export type MaintenanceTask = {
  public_id: string;
  title: string;
  notes: string;
  interval_days: number;
  last_completed_at: string | null;
  next_due_at: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LocationContents = {
  location: LocationNode & { item_count?: number };
  children: Array<LocationNode & { item_count?: number }>;
  items: Item[];
  /** Items stored inside a container here; only the container is listed. */
  inside_containers?: number;
  recursive: boolean;
};

export type CategoryContents = {
  category: Category;
  children: Category[];
  items: Item[];
  /** Items of this category stored inside a container; the outermost container is listed instead. */
  inside_containers?: number;
  recursive: boolean;
};

export type HistoryEvent = {
  public_id: string;
  action: string;
  quantity_delta: string | null;
  from_location: string | null;
  to_location: string | null;
  source: string;
  created_at: string;
};

export type Photo = {
  public_id: string;
  url: string;
  mime_type: string;
  width: number | null;
  height: number | null;
};

export type ItemDocument = {
  public_id: string;
  item_public_id: string;
  document_type: "receipt" | "invoice" | "manual" | "certificate" | "warranty" | "other";
  title: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  purchase_date: string | null;
  warranty_expires_at: string | null;
  extracted_text: string;
  extracted_serial_number: string;
  extracted_purchase_date: string | null;
  extracted_warranty_expires_at: string | null;
  extraction_status: "pending" | "processing" | "complete" | "unavailable" | "failed";
  extraction_error: string | null;
  content_url: string;
  created_at: string;
  updated_at: string;
};

export type ConsolidationPreview = { token: string; source: string; target: string; item_count: number; items: Array<{ public_id: string; name: string }>; source_rules: Array<{ public_id: string; match_value: string }>; categories_retained: number; target_defaults: { name: string } | null };
export type HomePreferences = { pinned_places: string[]; favorite_categories: number[]; show_shopping: boolean };
export type Attention = { ai_pending: number; reminders: Array<{ kind: string; item_id: string; item_name: string; title: string; due: string }> };
export type BackupPreview = { filename: string; size_bytes: number; counts: Record<string, number>; manifest: { created_at: string; includes: string[] } };

export type InventoryQueryOptions = {
  filter?: string; sort?: string; location?: string; category_id?: string;
  tag?: string; formula?: string; compatibility?: string;
};

export type ItemPage = {
  items: Item[];
  next_cursor: string | null;
  has_more: boolean;
};

export type HumanSearchResult = {
  available_tags?: string[];
  total: number;
  next_cursor: string | null;
  has_more: boolean;
  query: string;
  normalized_query: string;
  count: number;
  items: Item[];
  matched_by: string[];
  fuzzy: boolean;
  can_add: boolean;
  can_mark_lost: boolean;
};

export type SearchAlias = {
  public_id: string;
  alias: string;
  target_type: "term" | "item" | "location";
  replacement: string;
  target_public_id: string | null;
  source: "manual" | "learned";
  use_count: number;
  created_at: string;
  updated_at: string;
};

export type BarcodeResult = {
  found: boolean;
  cached: boolean;
  local?: boolean;
  warning?: string;
  existing_item?: Item | null;
  existing_items?: Item[];
  mapped_category?: {
    id: number;
    name: string;
    path: string;
    default_location: { public_id: string; name: string } | null;
    source: "explicit" | "automatic";
    off_tag: string | null;
  } | null;
  suggested_location?: { public_id: string; name: string; reason: string } | null;
  product: null | {
    barcode: string;
    name: string;
    brand: string;
    package_quantity: string;
    categories: string[];
    direct_categories: string[];
    ingredients_text: string;
    nutriscore_grade: string;
    nova_group: string;
    ecoscore_grade: string;
    nutrition: Record<string, string | number>;
    image_url: string | null;
    source: string;
    source_url: string;
  };
};

export type OffCategoryMapping = {
  off_tag: string;
  label: string;
  scan_count: number;
  first_seen_at: string;
  last_seen_at: string;
  category_id: number | null;
  explicit_category: { id: number; name: string; path: string } | null;
  automatic_category: { id: number; name: string; path: string } | null;
  effective_category: { id: number; name: string; path: string } | null;
  mapping_source: "explicit" | "automatic" | "unmapped";
};

export type OffCategoryMappingImportResult = {
  ready: number;
  errors: number;
  applied: number;
  details: Array<{ index: number; off_tag?: string; status: "ready" | "error"; message: string }>;
};

export type AICommand = {
  public_id: string;
  status: string;
  proposal: {
    summary: string;
    warnings: string[];
    operations: Array<{
      op: "add" | "modify" | "delete";
      type: "item" | "category" | "location";
      match?: Record<string, unknown>;
      data?: Record<string, unknown>;
    }>;
  };
  preview: {
    valid: boolean;
    counts: Record<string, number>;
    errors: string[];
    details: ImportPreviewDetail[];
  };
  requires_confirmation: boolean;
  search_results?: Item[] | null;
};

export type Analytics = {
  generated_at: string;
  days: number;
  summary: {
    active_items: number;
    archived_items: number;
    locations: number;
    categories: number;
    low_stock: number;
    zero_stock: number;
    expired: number;
    expiring_7_days: number;
    expiring_30_days: number;
    unassigned: number;
    missing_category: number;
    missing_photo: number;
    missing_details: number;
    priced_items: number;
    health_score: number;
  };
  activity_summary: {
    current_events: number;
    prior_events: number;
    percent_change: number | null;
    active_days: number;
    average_daily: number;
    busiest_day: string | null;
    busiest_day_events: number;
  };
  values: Array<{
    currency: string;
    purchase_minor: number;
    estimated_minor: number;
  }>;
  categories: Array<{
    category_id: number | null;
    label: string;
    item_count: number;
  }>;
  locations: Array<{
    location_public_id: string;
    label: string;
    item_count: number;
  }>;
  activity: Array<{
    date: string;
    changes: number;
    created: number;
    quantity_in: number;
    quantity_out: number;
    moved: number;
  }>;
  action_mix: Array<{ key: string; label: string; count: number }>;
  source_mix: Array<{ source: string; count: number }>;
  source_activity: Array<{ date: string; source: string; changes: number }>;
  stock: Array<{ label: string; count: number }>;
  inventory_age: Array<{ label: string; count: number }>;
  completeness: Array<{
    key: string;
    label: string;
    complete: number;
    total: number;
    percent: number;
  }>;
  expiration: Array<{ label: string; count: number }>;
  top_consumed: Array<{
    public_id: string;
    name: string;
    unit: string;
    quantity: string;
  }>;
  top_changed: Array<{
    public_id: string;
    name: string;
    event_count: number;
    last_changed_at: string;
  }>;
};

export type AIScanProposal = {
  public_id: string;
  status: "processing" | "pending" | "applying" | "approved" | "rejected" | "failed";
  location_public_id: string;
  location_name: string;
  location_path: string;
  photo_url: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  proposal: null | {
    item: {
      name: string;
      description: string;
      notes: string;
      category_id: number | null;
      quantity: string;
      unit: string;
      brand: string;
      model: string;
      serial_number: string;
      barcode: string;
      links: Array<{ label: string; url: string }>;
    };
    confidence: number;
    warnings: string[];
    research: null | { label: string; url: string; summary: string };
  };
  error: string | null;
  item_public_id: string | null;
  created_at: string;
  processed_at: string | null;
  decided_at: string | null;
};

export type ShoppingEntry = {
  public_id: string;
  item_public_id: string | null;
  name: string;
  quantity: string;
  unit: string;
  checked: boolean;
  source: string;
};

export type Project = {
  public_id: string;
  name: string;
  description: string;
  status: "planned" | "active" | "completed" | "archived";
  reservations: Array<{
    item_public_id: string;
    item_name: string;
    quantity: string;
    unit: string;
  }>;
};

export type ItemReservation = {
  project_public_id: string;
  project_name: string;
  project_status: Project["status"];
  quantity: string;
  unit: string;
};

export type Loan = {
  public_id: string;
  item_public_id: string;
  item_name: string;
  unit: string;
  direction: "lent" | "borrowed";
  person: string;
  quantity: string;
  due_date: string | null;
  notes: string;
  returned_at: string | null;
  created_at: string;
};

export type Enrichment = {
  product: null | {
    barcode: string;
    name: string;
    brand: string;
    package_quantity: string;
    ingredients_text: string;
    nutriscore_grade: string;
    nova_group: string;
    ecoscore_grade: string;
    nutrition: Record<string, string | number>;
    image_url: string | null;
    source: string;
    source_url: string;
    source_updated_at: string | null;
  };
  full_product_available: boolean;
  jobs: Array<{
    public_id: string;
    provider: string;
    job_type: string;
    status: string;
    error: string | null;
  }>;
  candidates: Array<{
    public_id: string;
    proposed: Record<string, unknown>;
    source_url: string | null;
    source_label: string;
    confidence: number | null;
    status: string;
  }>;
};

export type FullOffProduct = {
  product: Record<string, unknown>;
  source: string;
  source_url: string;
};

export type EnrichmentExport = {
  schema_version: string;
  export_id: string;
  created_at: string;
  instructions: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
};

export type EnrichmentSuggestion = {
  public_id: string;
  item_public_id: string;
  item_name: string;
  location_name: string;
  op: string;
  path: string;
  value: unknown;
  value_type: string;
  confidence: number;
  sources: Array<{ url?: string; label?: string; source_type?: string }>;
  uncertainty: string;
  rationale: string;
  status: string;
  safety_flags: string[];
  created_at: string;
};

export type ApplicationSettings = {
  notifications: {
    enabled: boolean;
    ntfy_url: string;
    ntfy_token_set: boolean;
    expiration_days: number;
    notify_low_stock: boolean;
    notify_expiration: boolean;
    notify_warranty: boolean;
  };
  units: string[];
  category_data: {
    fields: Array<keyof Omit<CategoryCapabilities, "override" | "inherited_from" | "inherited_label">>;
    overrides: Record<string, Partial<Omit<CategoryCapabilities, "override" | "inherited_from" | "inherited_label">>>;
    resolved: Record<string, CategoryCapabilities>;
  };
  inventory_display: InventoryDisplaySettings;
  system: {
    app: {
      version: string;
      python_version: string;
      platform: string;
      process_id: number;
      started_at: string;
      uptime_seconds: number;
    };
    resources: {
      cpu_percent: number;
      cpu_count: number;
      memory_rss_bytes: number;
    };
    storage: {
      data_dir: string;
      database_path: string;
      database_bytes: number;
      database_main_bytes: number;
      database_wal_bytes: number;
      database_shm_bytes: number;
      photos_bytes: number;
      documents_bytes: number;
      total_managed_bytes: number;
      data_dir_bytes: number;
      other_data_bytes: number;
      disk_total_bytes: number;
      disk_free_bytes: number;
    };
    inventory: {
      items: number;
      locations: number;
      categories: number;
      photos: number;
      documents: number;
      schema_migrations: number;
    };
    database: {
      page_count: number;
      page_size: number;
      freelist_count: number;
      journal_mode: string;
    };
  };
  setup: {
    authentication: {
      required: boolean;
      configured: boolean;
    };
    backup: {
      destination?: string;
      off_device_copy?: string;
      last_restore?: { status: string; message?: string; completed_at?: string };
      enabled: boolean;
      last_backup_at: string | null;
      backup_count: number;
      retention: number;
    };
  };
  integrations: {
    ai: {
      enabled: boolean;
      endpoint: string;
      model: string;
      api_key_set: boolean;
      usage: {
        calls: number;
        successful_calls: number;
        failed_calls: number;
        input_tokens: number;
        output_tokens: number;
        estimated_calls: number;
        scan_calls: number;
        command_calls: number;
        image_bytes: number;
        original_image_bytes: number;
        image_bytes_saved: number;
        all_time_calls: number;
      };
    };
    stt_configured: boolean;
    open_food_facts: boolean;
    mqtt: {
      enabled: boolean;
      host: string;
      port: number;
      username: string;
      base_topic: string;
      discovery_prefix: string;
      client_id: string;
      publish_interval_seconds: number;
      password_set: boolean;
    };
  };
};

export type InventoryDisplaySettings = {
  show_photo: boolean;
  show_location: boolean;
  show_category: boolean;
  show_quantity: boolean;
  show_brand: boolean;
  show_model: boolean;
};

export type StoredBackup = {
  id: string;
  created_at: string;
  size_bytes: number;
};

export type AIConnectionDiagnostic = {
  endpoint: string;
  model: string;
  http_status: number;
  response_type: string;
  provider_reply: string;
  response_preview: string;
  hint: string;
};

export type SoftwareUpdateStatus = {
  enabled?: boolean;
  status: string;
  message: string;
  requested_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  version: string | null;
  current_version: string;
  latest_version: string | null;
  update_available: boolean | null;
  release_url: string | null;
  release_check_error: string | null;
  request_pending: boolean;
  log_tail: string[];
};

export type BackupRestoreResult = {
  status: string;
  message: string;
  queued_at?: string;
  counts?: {
    items: number;
    locations: number;
    categories: number;
    photos: number;
  };
};

export type Dashboard = {
  item_count: number;
  location_count: number;
  low_stock_count: number;
  expiring_count: number;
  needs_details_count: number;
  recent_events: Array<{
    action: string;
    created_at: string;
    item_public_id: string;
    item_name: string;
  }>;
};

export type AuthStatus = {
  authenticated: boolean;
  user: { public_id: string; username: string; is_admin: boolean } | null;
  session_token?: string;
};

export type Bootstrap = {
  auth: AuthStatus;
  categories: Category[];
  dashboard: Dashboard;
  items: Item[];
  items_next_cursor?: string | null;
  items_has_more?: boolean;
  location_types: LocationType[];
  locations: LocationNode[];
  units: string[];
};

export type ItemDetailPayload = {
  item: Item;
  history: HistoryEvent[];
  photos: Photo[];
  enrichment: Enrichment;
  lots: ItemLot[];
  maintenance: MaintenanceTask[];
  reservations: ItemReservation[];
  related: RelatedItem[];
  documents: ItemDocument[];
};

export type RelatedItem = Item & {
  relationship_public_id: string;
  relationship_type: string;
  relationship_note: string;
  relationship_created_at: string;
};

const inFlightGetRequests = new Map<string, Promise<unknown>>();
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export class RequestAbortedError extends Error {
  constructor() {
    super("Request cancelled");
    this.name = "RequestAbortedError";
  }
}

export class HttpRequestError extends Error {
  status: number;
  diagnostic: AIConnectionDiagnostic | null;

  constructor(status: number, message: string, diagnostic: AIConnectionDiagnostic | null = null) {
    super(message);
    this.name = "HttpRequestError";
    this.status = status;
    this.diagnostic = diagnostic;
  }
}

export function isRequestAborted(error: unknown): boolean {
  return error instanceof RequestAbortedError;
}

export function isAuthenticationError(error: unknown): boolean {
  return error instanceof HttpRequestError && error.status === 401;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldRetryRequest(error: unknown, method: string, attempt: number, signal?: AbortSignal): boolean {
  if (attempt >= 2 || method !== "GET" || signal?.aborted || error instanceof RequestAbortedError) return false;
  if (error instanceof HttpRequestError) return RETRYABLE_STATUSES.has(error.status);
  if (!(error instanceof Error)) return false;
  return error.message === "Failed to fetch" || error.message.includes("timed out");
}

// Findstuff framed by another site (a Home Assistant dashboard, say) cannot keep
// its SameSite=Strict session cookie: the browser drops it, so the first request
// after a successful sign-in comes back 401. That tab carries the session as a
// header instead, kept in sessionStorage so it ends with the tab. Images and
// files the browser loads itself cannot send a header, so they get a short-lived
// read-only media token in their query string.
const HEADER_SESSION_KEY = "findstuff.headerSession.v1";
let headerSession: string | null = readHeaderSession();
let mediaToken: { token: string; expiresAt: number } | null = null;
let mediaTokenRequest: Promise<void> | null = null;

function readHeaderSession(): string | null {
  try { return sessionStorage.getItem(HEADER_SESSION_KEY); } catch { return null; }
}

export function setHeaderSession(token: string | null): void {
  headerSession = token;
  mediaToken = null;
  try {
    if (token) sessionStorage.setItem(HEADER_SESSION_KEY, token);
    else sessionStorage.removeItem(HEADER_SESSION_KEY);
  } catch {
    // Without storage the header still works until this page is reloaded.
  }
}

export function authHeaders(): Record<string, string> {
  return headerSession ? { Authorization: `Bearer ${headerSession}` } : {};
}

async function ensureMediaToken(): Promise<void> {
  if (!headerSession) return;
  if (mediaToken && mediaToken.expiresAt - 3600 > Date.now() / 1000) return;
  mediaTokenRequest ??= doRequest<{ token: string; expires_at: number }>("/api/v1/auth/media-token")
    .then((issued) => { mediaToken = { token: issued.token, expiresAt: issued.expires_at }; })
    .catch(() => undefined)
    .finally(() => { mediaTokenRequest = null; });
  await mediaTokenRequest;
}

export function mediaUrl(url: string): string {
  if (!mediaToken || !url.startsWith("/api/v1/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}media_token=${encodeURIComponent(mediaToken.token)}`;
}

// Every API field that points at a Findstuff file ends in "url", so rewriting
// those in one place covers photos, documents and project files wherever they
// are rendered.
function withMediaTokens<T>(value: T): T {
  if (!mediaToken) return value;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([key, entry]) => [
      key,
      typeof entry === "string" && /url$/i.test(key) ? mediaUrl(entry) : walk(entry),
    ]));
  };
  return walk(value) as T;
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = options?.method || "GET";
  const coalesceKey = method === "GET" && !options?.signal ? path : "";
  if (coalesceKey && inFlightGetRequests.has(coalesceKey)) {
    return inFlightGetRequests.get(coalesceKey) as Promise<T>;
  }
  const promise = requestWithRetry<T>(path, options, method);
  if (coalesceKey) {
    inFlightGetRequests.set(coalesceKey, promise);
    promise.finally(() => inFlightGetRequests.delete(coalesceKey)).catch(() => undefined);
  }
  return promise;
}

async function requestWithRetry<T>(path: string, options: RequestInit | undefined, method: string): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await doRequest<T>(path, options);
    } catch (error) {
      if (!shouldRetryRequest(error, method, attempt, options?.signal ?? undefined)) throw error;
      await sleep(120 * 2 ** attempt);
    }
  }
}

async function doRequest<T>(path: string, options?: RequestInit): Promise<T> {
  if (headerSession && path !== "/api/v1/auth/media-token") await ensureMediaToken();
  const isForm = options?.body instanceof FormData;
  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = path.startsWith("/api/v1/admin/restore")
    ? 30 * 60 * 1000
    : path.startsWith("/api/v1/admin/import") ? 45000 : 20000;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const externalSignal = options?.signal;
  if (externalSignal?.aborted) {
    window.clearTimeout(timeout);
    throw new RequestAbortedError();
  }
  const abortFromExternal = () => controller.abort();
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  let response: Response;
  try {
    const requestOptions = { ...(options || {}) };
    delete requestOptions.signal;
    response = await fetch(path, {
      ...requestOptions,
      cache: options?.method && options.method !== "GET" ? "no-store" : options?.cache,
      credentials: "same-origin",
      signal: controller.signal,
      headers: {
        ...(isForm ? {} : { "Content-Type": "application/json" }),
        ...authHeaders(),
        ...options?.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      if (!timedOut && externalSignal?.aborted) {
        throw new RequestAbortedError();
      }
      throw new Error("Request timed out. The change may not have reached the server; try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let diagnostic: AIConnectionDiagnostic | null = null;
    try {
      const body = (await response.json()) as { detail?: string | { message?: string }; diagnostic?: AIConnectionDiagnostic };
      if (body.detail) message = typeof body.detail === "string" ? body.detail : body.detail.message || message;
      if (body.diagnostic) diagnostic = body.diagnostic;
    } catch {
      // The status remains useful when the server did not return JSON.
    }
    throw new HttpRequestError(response.status, message, diagnostic);
  }
  if (response.status === 204) return undefined as T;
  return withMediaTokens(await response.json() as T);
}

export const api = {
  authStatus: () => request<AuthStatus>("/api/v1/auth/status"),
  login: (username: string, password: string) =>
    request<AuthStatus>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<void>("/api/v1/auth/logout", { method: "POST" }).finally(() => setHeaderSession(null)),
  bootstrap: (query = "", options?: RequestInit, includeZero = false) =>
    request<Bootstrap>(`/api/v1/bootstrap?q=${encodeURIComponent(query)}&limit=250&include_zero=${includeZero ? "true" : "false"}`, options),
  dashboard: (options?: RequestInit) => request<Dashboard>("/api/v1/dashboard", options),
  consolidationPreview: (source: string, target: string) => request<ConsolidationPreview>(`/api/v1/categories/consolidation-preview?source=${source}&target=${target}`),
  consolidateCategories: (source: string, target: string, token: string) => request<{ updated: number }>(`/api/v1/categories/consolidate?source=${source}&target=${target}&token=${token}`, { method: "POST" }),
  preferences: () => request<HomePreferences>("/api/v1/preferences"),
  savePreferences: (values: Partial<HomePreferences>) => request<HomePreferences>("/api/v1/preferences", { method: "PATCH", body: JSON.stringify(values) }),
  attention: () => request<Attention>("/api/v1/attention"),
  previewBackup: (file: File) => request<BackupPreview>(`/api/v1/admin/restore?preview=true&filename=${encodeURIComponent(file.name)}`, { method: "POST", body: file, headers: { "Content-Type": "application/zip" } }),
  analytics: (days = 90, includeImports = false) =>
    request<Analytics>(`/api/v1/analytics?days=${encodeURIComponent(String(days))}&include_imports=${includeImports}`),
  syncOfflineOperation: (
    operationId: string,
    kind: "create_item" | "adjust_quantity",
    payload: Record<string, unknown>,
  ) => request<{ operation_id: string; status: string; result: Item }>("/api/v1/offline/sync", {
    method: "POST",
    body: JSON.stringify({ operation_id: operationId, kind, payload }),
  }),
  categories: () => request<Category[]>("/api/v1/categories"),
  suggestCategoryIcons: (overwrite = false) =>
    request<{ updated: number; unchanged: number }>(
      `/api/v1/categories/icons/suggest?overwrite=${overwrite}`,
      { method: "POST" },
    ),
  exportCategoryIcons: () => request<CategoryIconSet>("/api/v1/categories/icons/export"),
  categoryMarks: () => request<{ marks: string[] }>("/api/v1/category-marks"),
  enrichmentExport: (scope: { category?: number; place?: string }, includeChildren = true) =>
    request<Record<string, unknown>>(
      scope.category !== undefined
        ? `/api/v1/categories/${scope.category}/enrichment-export?include_children=${includeChildren}`
        : `/api/v1/locations/${encodeURIComponent(scope.place || "")}/enrichment-export?include_children=${includeChildren}`,
    ),
  exportCategoryMarks: () => request<CategoryMarkSet>("/api/v1/category-marks/export"),
  importCategoryMarks: (payload: CategoryMarkSet, apply: boolean) =>
    request<CategoryMarkImportResult>("/api/v1/category-marks/import", {
      method: "POST",
      body: JSON.stringify({ apply, payload }),
    }),
  saveCategoryMark: (name: string, svg: string) =>
    request<{ name: string; svg: string }>(`/api/v1/category-marks/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify({ svg }),
    }),
  importCategoryIcons: (payload: CategoryIconSet, apply: boolean) =>
    request<CategoryIconImportResult>("/api/v1/categories/icons/import", {
      method: "POST",
      body: JSON.stringify({ apply, payload }),
    }),
  createCategory: (name: string, parent_id: number | null = null) =>
    request<Category>("/api/v1/categories", {
      method: "POST",
      body: JSON.stringify({ name, parent_id }),
    }),
  updateCategory: (
    categoryId: number,
    body: { name?: string; parent_id?: number | null; icon?: string },
  ) =>
    request<Category>(`/api/v1/categories/${categoryId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteCategory: (categoryId: number) =>
    request<void>(`/api/v1/categories/${categoryId}`, { method: "DELETE" }),
  deleteCategoryTree: (categoryId: number) =>
    request<void>(`/api/v1/categories/${categoryId}/tree`, { method: "DELETE" }),
  categoryContents: (categoryId: number) =>
    request<CategoryContents>(`/api/v1/categories/${categoryId}/contents`),
  setCategoryDefaultLocation: (categoryId: number, location_public_id: string | null) =>
    request<Category>(`/api/v1/categories/${categoryId}/default-location`, {
      method: "PUT",
      body: JSON.stringify({ location_public_id }),
    }),
  locationTypes: () => request<LocationType[]>("/api/v1/location-types"),
  createLocationType: (name: string) =>
    request<LocationType>("/api/v1/location-types", {
      method: "POST",
      body: JSON.stringify({ name, icon: name.includes("box") ? "box" : "pin" }),
    }),
  locationRules: () => request<LocationRule[]>("/api/v1/location-rules"),
  createLocationRule: (body: {
    rule_type: "name" | "barcode" | "category";
    match_value: string;
    location_public_id: string;
    priority?: number;
  }) => request<LocationRule>("/api/v1/location-rules", { method: "POST", body: JSON.stringify(body) }),
  updateLocationRule: (publicId: string, body: {
    rule_type?: "name" | "barcode" | "category";
    match_value?: string;
    location_public_id?: string;
    priority?: number;
    enabled?: boolean;
  }) => request<LocationRule>(`/api/v1/location-rules/${publicId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteLocationRule: (publicId: string) =>
    request<void>(`/api/v1/location-rules/${publicId}`, { method: "DELETE" }),
  suggestLocation: (name = "", barcode = "", category = "") =>
    request<{ suggestion: { public_id: string; name: string; reason: string } | null }>(
      `/api/v1/location-rules/suggest?name=${encodeURIComponent(name)}&barcode=${encodeURIComponent(barcode)}&category=${encodeURIComponent(category)}`,
    ),
  locations: () => request<LocationNode[]>("/api/v1/locations/tree"),
  locationContents: (publicId: string) =>
    request<LocationContents>(`/api/v1/locations/${publicId}/contents`),
  items: (query = "", options?: RequestInit, filters: { categoryId?: number | null; needsDetails?: boolean; includeZero?: boolean; archivedOnly?: boolean } = {}) => {
    const parameters = new URLSearchParams({ q: query });
    parameters.set("limit", "2000");
    if (filters.categoryId !== undefined && filters.categoryId !== null) {
      parameters.set("category_id", String(filters.categoryId));
    }
    if (filters.needsDetails) parameters.set("needs_details", "true");
    if (filters.includeZero) parameters.set("include_zero", "true");
    if (filters.archivedOnly) parameters.set("archived_only", "true");
    return request<Item[]>(`/api/v1/items?${parameters.toString()}`, options);
  },
  itemPage: (
    query = "",
    cursor: string | null = null,
    options?: RequestInit,
    filters: { categoryId?: number | null; needsDetails?: boolean; includeZero?: boolean; archivedOnly?: boolean } = {},
  ) => {
    const parameters = new URLSearchParams({ q: query, limit: "100" });
    if (cursor) parameters.set("cursor", cursor);
    if (filters.categoryId !== undefined && filters.categoryId !== null) {
      parameters.set("category_id", String(filters.categoryId));
    }
    if (filters.needsDetails) parameters.set("needs_details", "true");
    if (filters.includeZero) parameters.set("include_zero", "true");
    if (filters.archivedOnly) parameters.set("archived_only", "true");
    return request<ItemPage>(`/api/v1/items/page?${parameters.toString()}`, options);
  },
  inventoryQuery: (query: string, filters: InventoryQueryOptions, includeZero: boolean, cursor: string | null = null, options?: RequestInit) => {
    const params = new URLSearchParams({ q: query, include_zero: String(includeZero), limit: "100" });
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    if (cursor) params.set("cursor", cursor);
    return request<HumanSearchResult>(`/api/v1/items/query?${params}`, options);
  },
  humanSearch: (query: string, includeZero = false, cursor: string | null = null, options?: RequestInit) =>
    request<HumanSearchResult>(
      `/api/v1/search?q=${encodeURIComponent(query)}&include_zero=${includeZero}&cursor=${encodeURIComponent(cursor || "")}`,
      options,
    ),
  searchAliases: () => request<SearchAlias[]>("/api/v1/search/aliases"),
  searchLearningCandidates: () =>
    request<Array<{
      normalized_query: string;
      original_query: string;
      result_count: number;
      search_count: number;
      last_searched_at: string;
    }>>("/api/v1/search/learning-candidates"),
  deleteSearchLearningCandidate: (query: string) =>
    request<void>(`/api/v1/search/learning-candidates?query=${encodeURIComponent(query)}`, {
      method: "DELETE",
    }),
  createSearchAlias: (body: {
    alias: string;
    target_type: SearchAlias["target_type"];
    replacement?: string;
    target_public_id?: string | null;
    source?: SearchAlias["source"];
  }) => request<SearchAlias>("/api/v1/search/aliases", {
    method: "POST",
    body: JSON.stringify(body),
  }),
  deleteSearchAlias: (publicId: string) =>
    request<void>(`/api/v1/search/aliases/${publicId}`, { method: "DELETE" }),
  archivedItems: () => request<Item[]>("/api/v1/items?q=&limit=2000&archived_only=true&include_zero=true"),
  item: (publicId: string) => request<Item>(`/api/v1/items/${publicId}`),
  itemDetail: (publicId: string) =>
    request<ItemDetailPayload>(`/api/v1/items/${publicId}/detail`),
  history: (publicId: string) =>
    request<HistoryEvent[]>(`/api/v1/items/${publicId}/history`),
  photos: (publicId: string) =>
    request<Photo[]>(`/api/v1/items/${publicId}/photos`),
  lots: (item: Item) =>
    request<ItemLot[]>(`/api/v1/items/${item.public_id}/lots`),
  createLot: (item: Item, body: { quantity: string; expiration_date: string | null; note: string }) =>
    request<ItemLot>(`/api/v1/items/${item.public_id}/lots`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteLot: (item: Item, lot: ItemLot) =>
    request<void>(`/api/v1/items/${item.public_id}/lots/${lot.public_id}`, { method: "DELETE" }),
  maintenance: (item: Item) =>
    request<MaintenanceTask[]>(`/api/v1/items/${item.public_id}/maintenance`),
  createMaintenance: (item: Item, body: {
    title: string;
    notes: string;
    interval_days: number;
    last_completed_at: string | null;
    next_due_at: string;
  }) => request<MaintenanceTask>(`/api/v1/items/${item.public_id}/maintenance`, {
    method: "POST",
    body: JSON.stringify(body),
  }),
  completeMaintenance: (item: Item, task: MaintenanceTask) =>
    request<MaintenanceTask>(`/api/v1/items/${item.public_id}/maintenance/${task.public_id}/complete`, { method: "POST" }),
  createLocation: (body: {
    name: string;
    kind: string;
    parent_public_id: string | null;
  }) => request<LocationNode>("/api/v1/locations", { method: "POST", body: JSON.stringify(body) }),
  updateLocation: (publicId: string, body: {
    name?: string;
    kind?: string;
    parent_public_id?: string | null;
    icon?: string;
  }) => request<LocationNode>(`/api/v1/locations/${publicId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  }),
  deleteLocation: (publicId: string) =>
    request<void>(`/api/v1/locations/${publicId}`, { method: "DELETE" }),
  deleteLocationTree: (publicId: string) =>
    request<void>(`/api/v1/locations/${publicId}/tree`, { method: "DELETE" }),
  createItem: (body: Record<string, unknown>) =>
    request<Item>("/api/v1/items", { method: "POST", body: JSON.stringify(body) }),
  updateItem: (item: Item, body: Record<string, unknown>) =>
    request<Item>(`/api/v1/items/${item.public_id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...body, expected_version: item.version }),
    }),
  setTags: (item: Item, tags: string[]) =>
    request<Item>(`/api/v1/items/${item.public_id}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags, expected_version: item.version }),
    }),
  setDefaultLocation: (item: Item, location_public_id: string) =>
    request<{ item: Item; suggestion: { public_id: string; name: string; reason: string } | null }>(
      `/api/v1/items/${item.public_id}/default-location`,
      { method: "PUT", body: JSON.stringify({ location_public_id }) },
    ),
  uploadPhoto: (item: Item, file: Blob, width?: number, height?: number) => {
    const body = new FormData();
    body.append("file", file, "photo.jpg");
    if (width) body.append("width", String(width));
    if (height) body.append("height", String(height));
    return request<Photo>(`/api/v1/items/${item.public_id}/photos`, { method: "POST", body });
  },
  deletePhoto: (photo: Photo) =>
    request<void>(`/api/v1/photos/${photo.public_id}`, { method: "DELETE" }),
  documents: (item: Item) =>
    request<ItemDocument[]>(`/api/v1/items/${item.public_id}/documents`),
  uploadDocument: (
    item: Item,
    file: File,
    metadata: {
      document_type: ItemDocument["document_type"];
      title: string;
      purchase_date?: string;
      warranty_expires_at?: string;
    },
  ) => {
    const body = new FormData();
    body.append("file", file, file.name);
    body.append("document_type", metadata.document_type);
    body.append("title", metadata.title);
    if (metadata.purchase_date) body.append("purchase_date", metadata.purchase_date);
    if (metadata.warranty_expires_at) {
      body.append("warranty_expires_at", metadata.warranty_expires_at);
    }
    return request<ItemDocument>(`/api/v1/items/${item.public_id}/documents`, {
      method: "POST",
      body,
    });
  },
  updateDocument: (document: ItemDocument, body: Record<string, unknown>) =>
    request<ItemDocument>(`/api/v1/documents/${document.public_id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  extractDocument: (document: ItemDocument) =>
    request<ItemDocument>(`/api/v1/documents/${document.public_id}/extract`, {
      method: "POST",
    }),
  applyDocumentExtraction: (document: ItemDocument) =>
    request<ItemDocument>(`/api/v1/documents/${document.public_id}/apply-extraction`, {
      method: "POST",
    }),
  deleteDocument: (document: ItemDocument) =>
    request<void>(`/api/v1/documents/${document.public_id}`, { method: "DELETE" }),
  warrantiesDue: (days = 30) =>
    request<Array<ItemDocument & { item_name: string; expired: boolean }>>(
      `/api/v1/dashboard/warranties?days=${encodeURIComponent(String(days))}`,
    ),
  relateItem: (item: Item, relatedItemPublicId: string, relationType = "related", note = "") =>
    request<RelatedItem>(`/api/v1/items/${item.public_id}/relationships`, {
      method: "POST",
      body: JSON.stringify({
        related_item_public_id: relatedItemPublicId,
        relation_type: relationType,
        note,
      }),
    }),
  deleteRelationship: (item: Item, relationshipPublicId: string) =>
    request<void>(`/api/v1/items/${item.public_id}/relationships/${relationshipPublicId}`, {
      method: "DELETE",
    }),
  importPhotoFromUrl: (item: Item, url: string) =>
    request<Photo>(`/api/v1/items/${item.public_id}/photos/from-url`, {
      method: "POST",
      body: JSON.stringify({ url, source_label: "External product image" }),
    }),
  barcode: (code: string) =>
    request<BarcodeResult>(`/api/v1/barcodes/${encodeURIComponent(code)}/lookup`),
  decodeBarcodeImage: (file: Blob) => {
    const body = new FormData();
    body.append("file", file, "scan.jpg");
    return request<{ code: string }>("/api/v1/barcodes/decode-image", { method: "POST", body });
  },
  parseCommand: (text: string) =>
    request<AICommand>("/api/v1/commands/parse", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  confirmCommand: (publicId: string) =>
    request<{
      status: string;
      result: {
        valid?: boolean;
        created?: {
          operations?: number;
          add?: number;
          modify?: number;
          delete?: number;
          skipped?: number;
        };
        errors?: string[];
        import_public_id?: string;
      };
    }>(`/api/v1/commands/${publicId}/confirm`, {
      method: "POST",
    }),
  rejectCommand: (publicId: string) =>
    request<void>(`/api/v1/commands/${publicId}/reject`, { method: "POST" }),
  aiScans: (status = "processing,pending,failed") =>
    request<AIScanProposal[]>(`/api/v1/ai-scans?status=${encodeURIComponent(status)}`),
  createAiScan: (
    locationPublicId: string,
    file: Blob,
    width?: number,
    height?: number,
    originalSizeBytes?: number,
  ) => {
    const body = new FormData();
    body.append("location_public_id", locationPublicId);
    body.append("file", file, "ai-scan.jpg");
    if (width) body.append("width", String(width));
    if (height) body.append("height", String(height));
    if (originalSizeBytes) body.append("original_size_bytes", String(originalSizeBytes));
    return request<AIScanProposal>("/api/v1/ai-scans", { method: "POST", body });
  },
  updateAiScan: (publicId: string, body: Record<string, unknown>) =>
    request<AIScanProposal>(`/api/v1/ai-scans/${publicId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  approveAiScan: (publicId: string) =>
    request<Item>(`/api/v1/ai-scans/${publicId}/approve`, { method: "POST" }),
  rejectAiScan: (publicId: string) =>
    request<void>(`/api/v1/ai-scans/${publicId}/reject`, { method: "POST" }),
  retryAiScan: (publicId: string) =>
    request<AIScanProposal>(`/api/v1/ai-scans/${publicId}/retry`, { method: "POST" }),
  shopping: () => request<ShoppingEntry[]>("/api/v1/shopping-list"),
  addShopping: (name: string, quantity = "1", unit = "pcs", itemPublicId?: string) =>
    request<ShoppingEntry>("/api/v1/shopping-list", {
      method: "POST",
      body: JSON.stringify({
        item_public_id: itemPublicId ?? null,
        name,
        quantity,
        unit,
      }),
    }),
  checkShopping: (entry: ShoppingEntry, checked: boolean) =>
    request<void>(`/api/v1/shopping-list/${entry.public_id}`, {
      method: "PATCH",
      body: JSON.stringify({ checked }),
    }),
  generateShopping: () =>
    request<{ created: number }>("/api/v1/shopping-list/generate-low-stock", { method: "POST" }),
  projects: () => request<Project[]>("/api/v1/projects"),
  createProject: (name: string, description: string) =>
    request<Project>("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  setProjectStatus: (project: Project, status: Project["status"]) =>
    request<Project>(`/api/v1/projects/${project.public_id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  deleteProject: (project: Project) =>
    request<void>(`/api/v1/projects/${project.public_id}`, { method: "DELETE" }),
  reserveItem: (project: Project, item: Item, quantity: string) =>
    request<void>(`/api/v1/projects/${project.public_id}/reservations`, {
      method: "POST",
      body: JSON.stringify({ item_public_id: item.public_id, quantity }),
    }),
  removeReservation: (project: Project, itemPublicId: string) =>
    request<void>(`/api/v1/projects/${project.public_id}/reservations/${itemPublicId}`, {
      method: "DELETE",
    }),
  loans: () => request<Loan[]>("/api/v1/loans"),
  createLoan: (body: Record<string, unknown>) =>
    request<Loan>("/api/v1/loans", { method: "POST", body: JSON.stringify(body) }),
  returnLoan: (loan: Loan) =>
    request<void>(`/api/v1/loans/${loan.public_id}/return`, { method: "POST" }),
  enrichment: (item: Item) =>
    request<Enrichment>(`/api/v1/items/${item.public_id}/enrichment`),
  fullEnrichment: (item: Item) =>
    request<FullOffProduct>(`/api/v1/items/${item.public_id}/enrichment/full`),
  clearEnrichment: (item: Item) =>
    request<void>(`/api/v1/items/${item.public_id}/enrichment`, { method: "DELETE" }),
  queueEnrichment: (item: Item) =>
    request<void>(`/api/v1/items/${item.public_id}/enrichment-jobs?refresh=true`, { method: "POST" }),
  runEnrichment: () =>
    request<{ processed: number }>("/api/v1/enrichment/run", { method: "POST" }),
  queueMissingEnrichment: () =>
    request<{ queued: number }>("/api/v1/enrichment/queue-missing", { method: "POST" }),
  enrichmentStatus: () =>
    request<{ missing: number }>("/api/v1/enrichment/status"),
  createEnrichmentExport: () =>
    request<EnrichmentExport>("/api/v1/enrichment/exports", {
      method: "POST",
      body: JSON.stringify({ categories: [], limit: 100, include_photos: true }),
    }),
  importEnrichmentResponse: (payload: unknown) =>
    request<{ import_public_id: string; suggestions: number; unsafe: number; auto_accepted: number }>(
      "/api/v1/enrichment/imports",
      { method: "POST", body: JSON.stringify(payload) },
    ),
  enrichmentSuggestions: (status = "pending") =>
    request<EnrichmentSuggestion[]>(`/api/v1/enrichment/suggestions?status=${encodeURIComponent(status)}`),
  acceptSuggestion: (publicId: string, value?: unknown, edited = false) =>
    request<Item>(`/api/v1/enrichment/suggestions/${publicId}/accept`, {
      method: "POST",
      body: JSON.stringify({ value: value ?? null, edited }),
    }),
  rejectSuggestion: (publicId: string) =>
    request<void>(`/api/v1/enrichment/suggestions/${publicId}/reject`, { method: "POST" }),
  applyEnrichment: (candidateId: string) =>
    request<Item>(`/api/v1/enrichment-candidates/${candidateId}/apply`, { method: "POST" }),
  settings: () => request<ApplicationSettings>("/api/v1/settings"),
  backups: () => request<StoredBackup[]>("/api/v1/admin/backups"),
  changeAdminPassword: (currentPassword: string, newPassword: string) =>
    request<{ status: string }>("/api/v1/admin/password", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    }),
  softwareUpdateStatus: (options: { refresh?: boolean } = {}) =>
    request<SoftwareUpdateStatus>(`/api/v1/admin/software-update${options.refresh ? "?refresh=true" : ""}`),
  requestSoftwareUpdate: () =>
    request<SoftwareUpdateStatus>("/api/v1/admin/software-update", { method: "POST" }),
  restoreBackup: (file: File) =>
    request<BackupRestoreResult>(
      `/api/v1/admin/restore?filename=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        body: file,
        headers: { "Content-Type": "application/zip" },
      },
    ),
  restoreStatus: () => request<BackupRestoreResult>("/api/v1/admin/restore"),
  units: () => request<{ units: string[] }>("/api/v1/settings/units"),
  saveUnits: (units: string[]) =>
    request<{ units: string[] }>("/api/v1/settings/units", {
      method: "PUT",
      body: JSON.stringify({ units }),
    }),
  saveCategoryDataSettings: (overrides: ApplicationSettings["category_data"]["overrides"]) =>
    request<ApplicationSettings["category_data"]>("/api/v1/settings/category-data", {
      method: "PUT",
      body: JSON.stringify({ overrides }),
    }),
  saveInventoryDisplaySettings: (body: InventoryDisplaySettings) =>
    request<InventoryDisplaySettings>("/api/v1/settings/inventory-display", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  offCategoryMappings: () =>
    request<{ format: string; mappings: OffCategoryMapping[] }>("/api/v1/settings/open-food-facts/category-mappings"),
  setOffCategoryMapping: (offTag: string, category_id: number | null) =>
    request<OffCategoryMapping>(`/api/v1/settings/open-food-facts/category-mappings/${encodeURIComponent(offTag)}`, {
      method: "PUT",
      body: JSON.stringify({ category_id }),
    }),
  offCategoryMappingItems: (offTag: string) =>
    request<Item[]>(`/api/v1/settings/open-food-facts/category-mappings/${encodeURIComponent(offTag)}/items`),
  exportOffCategoryMappings: () =>
    request<Record<string, unknown>>("/api/v1/settings/open-food-facts/category-mappings-export"),
  importOffCategoryMappings: (payload: unknown, apply = false) =>
    request<OffCategoryMappingImportResult>(`/api/v1/settings/open-food-facts/category-mappings-import?apply=${apply ? "true" : "false"}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  saveNotifications: (body: Record<string, unknown>) =>
    request<ApplicationSettings["notifications"]>("/api/v1/settings/notifications", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  testNotification: () => request<void>("/api/v1/notifications/test", { method: "POST" }),
  runNotifications: () =>
    request<Record<string, number | string>>("/api/v1/notifications/run", { method: "POST" }),
  saveAiSettings: (body: Record<string, unknown>) =>
    request<ApplicationSettings["integrations"]["ai"]>("/api/v1/settings/ai", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  testAiSettings: () => request<AIConnectionDiagnostic>("/api/v1/settings/ai/test", { method: "POST" }),
  saveMqttSettings: (body: Record<string, unknown>) =>
    request<ApplicationSettings["integrations"]["mqtt"]>("/api/v1/settings/mqtt", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  testMqttSettings: () => request<void>("/api/v1/settings/mqtt/test", { method: "POST" }),
  importPreview: (payload: unknown) =>
    request<{ valid: boolean; counts: Record<string, number>; note: string; errors?: string[]; details?: ImportPreviewDetail[] }>(
      "/api/v1/admin/import-preview",
      { method: "POST", body: JSON.stringify(payload) },
    ),
  importMerge: (payload: unknown) =>
    request<{ valid: boolean; mode: string; created: Record<string, number>; errors?: string[]; import_public_id?: string }>("/api/v1/admin/import", {
      method: "POST",
      body: JSON.stringify({ mode: "merge", payload }),
    }),
  importBatches: () => request<ImportBatch[]>("/api/v1/admin/imports"),
  undoImport: (publicId: string) =>
    request<{ undone: boolean; already_undone?: boolean; operations?: number }>(
      `/api/v1/admin/imports/${publicId}/undo`,
      { method: "POST" },
    ),
  adjust: (item: Item, delta: number) =>
    request<Item>(`/api/v1/items/${item.public_id}/adjust-quantity`, {
      method: "POST",
      body: JSON.stringify({ delta: String(delta), expected_version: item.version }),
    }),
  move: (item: Item, destination_public_id: string) =>
    request<Item>(`/api/v1/items/${item.public_id}/move`, {
      method: "POST",
      body: JSON.stringify({ destination_public_id, expected_version: item.version }),
    }),
  archive: (item: Item) =>
    request<void>(`/api/v1/items/${item.public_id}`, { method: "DELETE" }).then(() => { window.dispatchEvent(new CustomEvent("findstuff:item-removed", { detail: item.public_id })); }),
  restoreItem: (publicId: string) =>
    request<Item>(`/api/v1/items/${publicId}/restore`, { method: "POST" }),
  hardDeleteItem: (item: Item) =>
    request<void>(`/api/v1/items/${item.public_id}/permanent`, { method: "DELETE" }).then(() => { window.dispatchEvent(new CustomEvent("findstuff:item-removed", { detail: item.public_id })); }),
};

export function flattenLocations(nodes: LocationNode[]): LocationNode[] {
  return nodes.flatMap((node) => [node, ...flattenLocations(node.children)]);
}
