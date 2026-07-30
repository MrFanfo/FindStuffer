CREATE TABLE item_documents (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL DEFAULT 'other'
        CHECK (document_type IN ('receipt', 'invoice', 'manual', 'certificate', 'warranty', 'other')),
    title TEXT NOT NULL,
    file_path TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    sha256 TEXT NOT NULL,
    purchase_date TEXT,
    warranty_expires_at TEXT,
    extracted_text TEXT NOT NULL DEFAULT '',
    extracted_serial_number TEXT NOT NULL DEFAULT '',
    extracted_purchase_date TEXT,
    extracted_warranty_expires_at TEXT,
    extraction_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (extraction_status IN ('pending', 'processing', 'complete', 'unavailable', 'failed')),
    extraction_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (item_id, sha256)
);

CREATE INDEX idx_item_documents_item ON item_documents(item_id, created_at DESC);
CREATE INDEX idx_item_documents_warranty ON item_documents(warranty_expires_at)
    WHERE warranty_expires_at IS NOT NULL;

CREATE TABLE search_aliases (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    alias TEXT NOT NULL COLLATE NOCASE,
    target_type TEXT NOT NULL CHECK (target_type IN ('term', 'item', 'location')),
    replacement TEXT NOT NULL DEFAULT '',
    target_public_id TEXT,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'learned')),
    use_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(alias, target_type, target_public_id)
);

CREATE TABLE search_observations (
    normalized_query TEXT PRIMARY KEY,
    original_query TEXT NOT NULL,
    result_count INTEGER NOT NULL DEFAULT 0,
    search_count INTEGER NOT NULL DEFAULT 1,
    last_searched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
