ALTER TABLE ai_scan_proposals
ADD COLUMN original_size_bytes INTEGER NOT NULL DEFAULT 0
CHECK (original_size_bytes >= 0);

CREATE TABLE ai_usage_events (
    id INTEGER PRIMARY KEY,
    feature TEXT NOT NULL
        CHECK (feature IN ('scan', 'command', 'connection_test')),
    model TEXT NOT NULL DEFAULT '',
    success INTEGER NOT NULL CHECK (success IN (0, 1)),
    input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    token_count_estimated INTEGER NOT NULL DEFAULT 0
        CHECK (token_count_estimated IN (0, 1)),
    image_bytes INTEGER NOT NULL DEFAULT 0 CHECK (image_bytes >= 0),
    original_image_bytes INTEGER NOT NULL DEFAULT 0
        CHECK (original_image_bytes >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_usage_events_created
ON ai_usage_events(created_at DESC);
