-- findstuff: foreign_keys=off
-- Replace the legacy global category-name constraint with path-safe sibling
-- uniqueness. Foreign keys are disabled only for this atomic table rebuild;
-- the guard at the end aborts the migration if any reference was damaged.

CREATE TABLE categories_rebuilt (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE,
    slug TEXT NOT NULL UNIQUE,
    default_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    default_low_stock_milli INTEGER CHECK (
        default_low_stock_milli IS NULL OR default_low_stock_milli >= 0
    ),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    parent_id INTEGER REFERENCES categories_rebuilt(id) ON DELETE RESTRICT,
    sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO categories_rebuilt(
    id, name, slug, default_location_id, default_low_stock_milli,
    created_at, parent_id, sort_order
)
SELECT
    id, name, slug, default_location_id, default_low_stock_milli,
    created_at, parent_id, sort_order
FROM categories;

DROP TABLE categories;
ALTER TABLE categories_rebuilt RENAME TO categories;

CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE UNIQUE INDEX idx_categories_sibling_name
ON categories(IFNULL(parent_id, -1), name COLLATE NOCASE);

CREATE TEMP TABLE hierarchy_migration_fk_guard (
    violation_count INTEGER NOT NULL CHECK (violation_count = 0)
);
INSERT INTO hierarchy_migration_fk_guard
SELECT count(*) FROM pragma_foreign_key_check;
DROP TABLE hierarchy_migration_fk_guard;
