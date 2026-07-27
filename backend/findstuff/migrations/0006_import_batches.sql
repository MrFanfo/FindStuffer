CREATE TABLE import_batches (
    public_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    undo_json TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    undone_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
