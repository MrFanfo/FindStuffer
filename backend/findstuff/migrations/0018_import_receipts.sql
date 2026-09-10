-- Retry receipts and provenance outlive the five undoable import snapshots.
CREATE TABLE import_receipts (
    import_id TEXT PRIMARY KEY,
    payload_hash TEXT NOT NULL,
    batch_public_id TEXT,
    result_json TEXT NOT NULL,
    undone_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE import_provenance (
    id INTEGER PRIMARY KEY,
    import_id TEXT NOT NULL REFERENCES import_receipts(import_id),
    operation_index INTEGER NOT NULL,
    entity TEXT NOT NULL,
    object_id TEXT,
    action TEXT NOT NULL,
    detail_json TEXT NOT NULL
);
CREATE INDEX import_provenance_object ON import_provenance(entity, object_id);
