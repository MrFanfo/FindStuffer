CREATE TABLE ai_scan_proposals (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing', 'pending', 'applying', 'approved', 'rejected', 'failed')),
    photo_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    width INTEGER,
    height INTEGER,
    proposal_json TEXT,
    provider TEXT NOT NULL DEFAULT 'external',
    model TEXT NOT NULL DEFAULT '',
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TEXT,
    decided_at TEXT
);

CREATE INDEX idx_ai_scan_proposals_status_created
ON ai_scan_proposals(status, created_at DESC);

CREATE INDEX idx_ai_scan_proposals_location
ON ai_scan_proposals(location_id, created_at DESC);
