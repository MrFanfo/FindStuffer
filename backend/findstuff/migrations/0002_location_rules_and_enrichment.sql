CREATE TABLE location_types (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    icon TEXT NOT NULL DEFAULT 'pin',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO location_types(name, icon, sort_order) VALUES
    ('home', 'home', 10),
    ('room', 'pin', 20),
    ('location', 'pin', 30),
    ('shelf', 'pin', 40),
    ('drawer', 'box', 50),
    ('box', 'box', 60),
    ('container', 'box', 70),
    ('freezer', 'box', 80),
    ('fridge', 'box', 90),
    ('pantry', 'box', 100)
ON CONFLICT(name) DO NOTHING;

ALTER TABLE products ADD COLUMN default_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN local_image_url TEXT;

ALTER TABLE location_rules ADD COLUMN public_id TEXT NOT NULL DEFAULT '';
UPDATE location_rules SET public_id = 'rule_' || lower(hex(randomblob(9))) WHERE public_id = '';
CREATE UNIQUE INDEX idx_location_rules_public_id ON location_rules(public_id);

CREATE TABLE item_metadata (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    value_json TEXT NOT NULL,
    value_type TEXT NOT NULL DEFAULT 'string',
    confidence REAL,
    sources_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'confirmed',
    confirmed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(item_id, path)
);

CREATE TABLE metadata_field_locks (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(item_id, path)
);

CREATE TABLE enrichment_exports (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    criteria_json TEXT NOT NULL,
    item_count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE enrichment_imports (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    export_public_id TEXT,
    agent_json TEXT NOT NULL DEFAULT '{}',
    raw_json TEXT NOT NULL,
    validation_status TEXT NOT NULL DEFAULT 'validated',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE enrichment_suggestions (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    import_id INTEGER REFERENCES enrichment_imports(id) ON DELETE SET NULL,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    op TEXT NOT NULL,
    path TEXT NOT NULL,
    value_json TEXT NOT NULL,
    value_type TEXT NOT NULL DEFAULT 'string',
    confidence REAL NOT NULL DEFAULT 0,
    sources_json TEXT NOT NULL DEFAULT '[]',
    uncertainty TEXT NOT NULL DEFAULT '',
    rationale TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    safety_flags_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at TEXT
);

CREATE INDEX idx_item_metadata_item_path ON item_metadata(item_id, path);
CREATE INDEX idx_enrichment_suggestions_status ON enrichment_suggestions(status, created_at);
