CREATE TABLE item_lots (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity_milli INTEGER NOT NULL CHECK (quantity_milli >= 0),
    expiration_date TEXT,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE maintenance_tasks (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    interval_days INTEGER NOT NULL CHECK (interval_days > 0),
    last_completed_at TEXT,
    next_due_at TEXT NOT NULL,
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_item_lots_item_expiration ON item_lots(item_id, expiration_date);
CREATE INDEX idx_maintenance_item_due ON maintenance_tasks(item_id, archived_at, next_due_at);
