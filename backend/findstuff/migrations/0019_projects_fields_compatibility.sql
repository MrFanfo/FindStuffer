ALTER TABLE projects ADD COLUMN notes TEXT NOT NULL DEFAULT '';
CREATE TABLE compatibility_targets (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL COLLATE NOCASE,
    manufacturer TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT '',
    parent_id INTEGER REFERENCES compatibility_targets(id) ON DELETE RESTRICT,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE compatibility_names (
    name TEXT PRIMARY KEY COLLATE NOCASE,
    target_id INTEGER NOT NULL REFERENCES compatibility_targets(id) ON DELETE CASCADE,
    canonical INTEGER NOT NULL DEFAULT 0 CHECK(canonical IN (0,1))
);
CREATE TABLE item_compatibility (
    public_id TEXT NOT NULL UNIQUE,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES compatibility_targets(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK(status IN ('compatible','incompatible','requires_adapter','partial','unknown')),
    notes TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    adapter TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(item_id,target_id)
);
CREATE TABLE project_compatibility (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES compatibility_targets(id) ON DELETE RESTRICT,
    PRIMARY KEY(project_id,target_id)
);
CREATE TABLE category_fields (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    overrides_id INTEGER REFERENCES category_fields(id) ON DELETE RESTRICT,
    key TEXT NOT NULL COLLATE NOCASE,
    label TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL CHECK(type IN ('string','text','integer','decimal','boolean','enum','date','url')),
    required INTEGER NOT NULL DEFAULT 0 CHECK(required IN (0,1)),
    nullable INTEGER NOT NULL DEFAULT 1 CHECK(nullable IN (0,1)),
    default_json TEXT,
    allowed_values_json TEXT NOT NULL DEFAULT '[]',
    constraints_json TEXT NOT NULL DEFAULT '{}',
    unit TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    UNIQUE(category_id,key)
);
CREATE TABLE item_field_values (
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    field_id INTEGER NOT NULL REFERENCES category_fields(id) ON DELETE RESTRICT,
    value_json TEXT NOT NULL,
    PRIMARY KEY(item_id,field_id)
);
CREATE TABLE project_requirements (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
    required_milli INTEGER NOT NULL DEFAULT 1000 CHECK(required_milli > 0),
    allocated_milli INTEGER NOT NULL DEFAULT 0 CHECK(allocated_milli >= 0),
    purchased_milli INTEGER NOT NULL DEFAULT 0 CHECK(purchased_milli >= 0),
    acquired_milli INTEGER NOT NULL DEFAULT 0 CHECK(acquired_milli >= 0),
    unit TEXT NOT NULL DEFAULT 'pcs',
    reserve INTEGER NOT NULL DEFAULT 0 CHECK(reserve IN (0,1)),
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'needed' CHECK(status IN ('needed','in_progress','satisfied','cancelled')),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX requirement_identity ON project_requirements(project_id,name,COALESCE(category_id,0));
CREATE TABLE requirement_compatibility (
    requirement_id INTEGER NOT NULL REFERENCES project_requirements(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES compatibility_targets(id) ON DELETE RESTRICT,
    PRIMARY KEY(requirement_id,target_id)
);
CREATE INDEX item_field_values_field ON item_field_values(field_id);
CREATE INDEX item_compatibility_target ON item_compatibility(target_id);
CREATE INDEX project_requirements_item ON project_requirements(item_id);
