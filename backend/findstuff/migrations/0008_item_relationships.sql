CREATE TABLE item_relationships (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    item_a_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    item_b_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL DEFAULT 'related',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (item_a_id < item_b_id),
    UNIQUE(item_a_id, item_b_id, relation_type)
);

CREATE INDEX idx_item_relationships_a ON item_relationships(item_a_id);
CREATE INDEX idx_item_relationships_b ON item_relationships(item_b_id);
