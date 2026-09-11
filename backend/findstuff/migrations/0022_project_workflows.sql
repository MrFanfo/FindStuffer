ALTER TABLE projects ADD COLUMN multiplier INTEGER NOT NULL DEFAULT 1 CHECK(multiplier BETWEEN 1 AND 10000);
ALTER TABLE projects ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR';
ALTER TABLE projects ADD COLUMN links_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE project_requirements ADD COLUMN optional INTEGER NOT NULL DEFAULT 0 CHECK(optional IN (0,1));
ALTER TABLE project_requirements ADD COLUMN estimated_unit_cost_minor INTEGER CHECK(estimated_unit_cost_minor >= 0);
ALTER TABLE project_requirements ADD COLUMN actual_spent_minor INTEGER NOT NULL DEFAULT 0 CHECK(actual_spent_minor >= 0);
CREATE TABLE project_completions (
 id INTEGER PRIMARY KEY, public_id TEXT NOT NULL UNIQUE,
 project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE project_outputs (
 id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
 item_public_id TEXT NOT NULL, quantity_milli INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE project_files (
 id INTEGER PRIMARY KEY, public_id TEXT NOT NULL UNIQUE,
 project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name TEXT NOT NULL, mime_type TEXT NOT NULL, file_path TEXT NOT NULL,
 size_bytes INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
