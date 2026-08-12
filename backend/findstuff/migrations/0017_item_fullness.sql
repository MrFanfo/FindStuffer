ALTER TABLE items ADD COLUMN fullness_percent INTEGER
    CHECK (fullness_percent IS NULL OR (fullness_percent >= 0 AND fullness_percent <= 100));

CREATE TABLE dismissed_search_observations (
    normalized_query TEXT PRIMARY KEY,
    dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
