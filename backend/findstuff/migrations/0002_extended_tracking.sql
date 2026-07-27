CREATE TABLE shopping_list_entries (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    quantity_milli INTEGER NOT NULL DEFAULT 1000 CHECK (quantity_milli >= 0),
    unit TEXT NOT NULL DEFAULT 'pcs',
    checked INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0, 1)),
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE project_reservations (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, item_id)
);

CREATE TABLE loans (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    direction TEXT NOT NULL CHECK (direction IN ('lent', 'borrowed')),
    person TEXT NOT NULL,
    quantity_milli INTEGER NOT NULL DEFAULT 1000 CHECK (quantity_milli > 0),
    due_date TEXT,
    notes TEXT NOT NULL DEFAULT '',
    returned_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_shopping_checked ON shopping_list_entries(checked, created_at);
CREATE INDEX idx_reservations_item ON project_reservations(item_id);
CREATE INDEX idx_loans_active ON loans(returned_at, due_date);
