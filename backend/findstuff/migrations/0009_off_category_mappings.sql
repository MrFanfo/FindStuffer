CREATE TABLE off_category_observations (
    off_tag TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    scan_count INTEGER NOT NULL DEFAULT 0,
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE off_category_mappings (
    off_tag TEXT PRIMARY KEY REFERENCES off_category_observations(off_tag) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_off_category_mappings_category ON off_category_mappings(category_id);
