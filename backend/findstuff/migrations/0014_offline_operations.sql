CREATE TABLE offline_operations (
    operation_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('create_item', 'adjust_quantity')),
    status TEXT NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing', 'applied', 'failed')),
    result_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_at TEXT
);
