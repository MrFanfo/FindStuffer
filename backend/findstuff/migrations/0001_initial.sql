CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
);

CREATE TABLE sessions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE locations (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    parent_id INTEGER REFERENCES locations(id) ON DELETE RESTRICT,
    name TEXT NOT NULL COLLATE NOCASE,
    kind TEXT NOT NULL DEFAULT 'location',
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (parent_id, name)
);

CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    default_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    default_low_stock_milli INTEGER CHECK (default_low_stock_milli IS NULL OR default_low_stock_milli >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    barcode TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    brand TEXT NOT NULL DEFAULT '',
    net_quantity_text TEXT NOT NULL DEFAULT '',
    image_url TEXT,
    source TEXT NOT NULL DEFAULT '',
    source_updated_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    version INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    quantity_milli INTEGER NOT NULL DEFAULT 1000 CHECK (quantity_milli >= 0),
    unit TEXT NOT NULL DEFAULT 'pcs',
    purchase_price_minor INTEGER CHECK (purchase_price_minor IS NULL OR purchase_price_minor >= 0),
    purchase_currency TEXT CHECK (purchase_currency IS NULL OR length(purchase_currency) = 3),
    estimated_price_minor INTEGER CHECK (estimated_price_minor IS NULL OR estimated_price_minor >= 0),
    estimated_price_currency TEXT CHECK (estimated_price_currency IS NULL OR length(estimated_price_currency) = 3),
    estimated_price_at TEXT,
    weight_g INTEGER CHECK (weight_g IS NULL OR weight_g >= 0),
    length_mm INTEGER CHECK (length_mm IS NULL OR length_mm >= 0),
    width_mm INTEGER CHECK (width_mm IS NULL OR width_mm >= 0),
    height_mm INTEGER CHECK (height_mm IS NULL OR height_mm >= 0),
    serial_number TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    brand TEXT NOT NULL DEFAULT '',
    expiration_date TEXT,
    low_stock_milli INTEGER CHECK (low_stock_milli IS NULL OR low_stock_milli >= 0),
    barcode_override TEXT NOT NULL DEFAULT '',
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE item_tags (
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, tag_id)
);

CREATE TABLE photos (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    thumbnail_path TEXT,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    width INTEGER,
    height INTEGER,
    sha256 TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_events (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    action TEXT NOT NULL,
    quantity_delta_milli INTEGER,
    from_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    to_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    before_json TEXT,
    after_json TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    command_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE location_rules (
    id INTEGER PRIMARY KEY,
    rule_type TEXT NOT NULL,
    match_value TEXT NOT NULL COLLATE NOCASE,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ai_commands (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    raw_text TEXT NOT NULL,
    proposal_json TEXT,
    resolved_json TEXT,
    status TEXT NOT NULL DEFAULT 'proposed',
    provider TEXT,
    model TEXT,
    schema_version TEXT NOT NULL DEFAULT '1',
    proposal_hash TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TEXT,
    applied_at TEXT,
    expires_at TEXT
);

CREATE TABLE external_cache (
    id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,
    cache_key TEXT NOT NULL,
    response_json TEXT,
    status TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    etag TEXT,
    UNIQUE (provider, cache_key)
);

CREATE TABLE enrichment_jobs (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    error TEXT,
    requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    completed_at TEXT
);

CREATE TABLE enrichment_candidates (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    job_id INTEGER NOT NULL REFERENCES enrichment_jobs(id) ON DELETE CASCADE,
    proposed_json TEXT NOT NULL,
    source_url TEXT,
    source_label TEXT NOT NULL,
    confidence REAL,
    status TEXT NOT NULL DEFAULT 'proposed',
    retrieved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at TEXT
);

CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE VIRTUAL TABLE item_fts USING fts5(
    item_id UNINDEXED,
    name,
    description,
    notes,
    category,
    tags,
    location_path,
    brand,
    model,
    serial_number,
    barcode,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE INDEX idx_locations_parent ON locations(parent_id, archived_at);
CREATE INDEX idx_items_location ON items(location_id, archived_at);
CREATE INDEX idx_items_category ON items(category_id, archived_at);
CREATE INDEX idx_items_product ON items(product_id);
CREATE INDEX idx_items_expiration ON items(expiration_date) WHERE archived_at IS NULL;
CREATE INDEX idx_items_low_stock ON items(low_stock_milli) WHERE archived_at IS NULL;
CREATE INDEX idx_events_item_created ON inventory_events(item_id, created_at DESC);
CREATE INDEX idx_jobs_status_retry ON enrichment_jobs(status, next_attempt_at);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

INSERT INTO locations(public_id, name, kind, description)
VALUES ('unassigned', 'Unassigned', 'system', 'Items waiting to be placed');

INSERT INTO categories(name, slug) VALUES
    ('Electronics', 'electronics'),
    ('Tools', 'tools'),
    ('Groceries', 'groceries'),
    ('Consumables', 'consumables');
