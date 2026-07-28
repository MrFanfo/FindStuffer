export type LocationNode = {
  public_id: string;
  name: string;
  kind: string;
  description: string;
  path: string;
  item_count?: number;
  total_item_count?: number;
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
  index: number;
  action: string;
  entity: string;
  label: string;
  status: string;
  message: string;
};

export type Category = {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  path: string;
  depth: number;
  sort_order: number;
  item_count: number;
  total_item_count: number;
  default_location: { public_id: string; name: string } | null;
  capabilities: CategoryCapabilities;
};

export type CategoryCapabilities = {
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
  override: boolean;
  inherited_from: number | null;
  inherited_label: string;
};

export type Item = {
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
  barcode: string;
  links: Array<{ label: string; url: string }>;
  tags: string[];
  archived_at: string | null;
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
  recursive: boolean;
};

export type CategoryContents = {
  category: Category;
  children: Category[];
  items: Item[];
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

export type BarcodeResult = {
  found: boolean;
  cached: boolean;
  local?: boolean;
  warning?: string;
  existing_item?: Item | null;
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
  categories: Array<{ label: string; item_count: number }>;
  locations: Array<{ label: string; item_count: number }>;
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
  status: "active" | "completed" | "archived";
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
  };
  units: string[];
  category_data: {
    fields: Array<keyof Omit<CategoryCapabilities, "override" | "inherited_from" | "inherited_label">>;
    overrides: Record<string, Partial<Omit<CategoryCapabilities, "override" | "inherited_from" | "inherited_label">>>;
    resolved: Record<string, CategoryCapabilities>;
  };
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
};

export type Bootstrap = {
  auth: AuthStatus;
  categories: Category[];
  dashboard: Dashboard;
  items: Item[];
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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
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
  const isForm = options?.body instanceof FormData;
  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = path.startsWith("/api/v1/admin/restore")
    ? 30 * 60 * 1000
    : 20000;
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
      const body = (await response.json()) as { detail?: string; diagnostic?: AIConnectionDiagnostic };
      if (body.detail) message = body.detail;
      if (body.diagnostic) diagnostic = body.diagnostic;
    } catch {
      // The status remains useful when the server did not return JSON.
    }
    throw new HttpRequestError(response.status, message, diagnostic);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  authStatus: () => request<AuthStatus>("/api/v1/auth/status"),
  login: (username: string, password: string) =>
    request<AuthStatus>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<void>("/api/v1/auth/logout", { method: "POST" }),
  bootstrap: (query = "", options?: RequestInit, includeZero = false) =>
    request<Bootstrap>(`/api/v1/bootstrap?q=${encodeURIComponent(query)}&limit=250&include_zero=${includeZero ? "true" : "false"}`, options),
  dashboard: (options?: RequestInit) => request<Dashboard>("/api/v1/dashboard", options),
  analytics: (days = 90) =>
    request<Analytics>(`/api/v1/analytics?days=${encodeURIComponent(String(days))}`),
  syncOfflineOperation: (
    operationId: string,
    kind: "create_item" | "adjust_quantity",
    payload: Record<string, unknown>,
  ) => request<{ operation_id: string; status: string; result: Item }>("/api/v1/offline/sync", {
    method: "POST",
    body: JSON.stringify({ operation_id: operationId, kind, payload }),
  }),
  categories: () => request<Category[]>("/api/v1/categories"),
  createCategory: (name: string, parent_id: number | null = null) =>
    request<Category>("/api/v1/categories", {
      method: "POST",
      body: JSON.stringify({ name, parent_id }),
    }),
  updateCategory: (categoryId: number, body: { name?: string; parent_id?: number | null }) =>
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
  changeAdminPassword: (currentPassword: string, newPassword: string) =>
    request<{ status: string }>("/api/v1/admin/password", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    }),
  softwareUpdateStatus: () => request<SoftwareUpdateStatus>("/api/v1/admin/software-update"),
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
    request<void>(`/api/v1/items/${item.public_id}`, { method: "DELETE" }),
  restoreItem: (publicId: string) =>
    request<Item>(`/api/v1/items/${publicId}/restore`, { method: "POST" }),
  hardDeleteItem: (item: Item) =>
    request<void>(`/api/v1/items/${item.public_id}/permanent`, { method: "DELETE" }),
};

export function flattenLocations(nodes: LocationNode[]): LocationNode[] {
  return nodes.flatMap((node) => [node, ...flattenLocations(node.children)]);
}
