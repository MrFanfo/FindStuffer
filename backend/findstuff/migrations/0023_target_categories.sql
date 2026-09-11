ALTER TABLE compatibility_targets ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;

CREATE INDEX compatibility_target_category ON compatibility_targets(category_id);
