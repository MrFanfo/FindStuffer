ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT;
ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_categories_parent ON categories(parent_id);

INSERT INTO categories(parent_id, name, slug, sort_order)
SELECT id, 'Components', 'electronics-components', 10
FROM categories
WHERE slug = 'electronics'
  AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Components' COLLATE NOCASE)
  AND NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'electronics-components');

INSERT INTO categories(parent_id, name, slug, sort_order)
SELECT id, 'Cables', 'electronics-cables', 20
FROM categories
WHERE slug = 'electronics'
  AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Cables' COLLATE NOCASE)
  AND NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'electronics-cables');

INSERT INTO categories(parent_id, name, slug, sort_order)
SELECT id, 'Microcontrollers', 'electronics-microcontrollers', 30
FROM categories
WHERE slug = 'electronics'
  AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Microcontrollers' COLLATE NOCASE)
  AND NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'electronics-microcontrollers');

INSERT INTO categories(parent_id, name, slug, sort_order)
SELECT id, 'Resistors', 'electronics-components-resistors', 10
FROM categories
WHERE slug = 'electronics-components'
  AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Resistors' COLLATE NOCASE)
  AND NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'electronics-components-resistors');

INSERT INTO categories(parent_id, name, slug, sort_order)
SELECT id, 'Capacitors', 'electronics-components-capacitors', 20
FROM categories
WHERE slug = 'electronics-components'
  AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Capacitors' COLLATE NOCASE)
  AND NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'electronics-components-capacitors');

INSERT INTO categories(parent_id, name, slug, sort_order)
SELECT id, 'Hand tools', 'tools-hand-tools', 10
FROM categories
WHERE slug = 'tools'
  AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Hand tools' COLLATE NOCASE)
  AND NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'tools-hand-tools');

INSERT INTO categories(parent_id, name, slug, sort_order)
SELECT id, 'Power tools', 'tools-power-tools', 20
FROM categories
WHERE slug = 'tools'
  AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Power tools' COLLATE NOCASE)
  AND NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'tools-power-tools');

INSERT INTO categories(parent_id, name, slug, sort_order)
SELECT id, 'Fasteners', 'tools-fasteners', 30
FROM categories
WHERE slug = 'tools'
  AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Fasteners' COLLATE NOCASE)
  AND NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'tools-fasteners');

INSERT INTO categories(parent_id, name, slug, sort_order)
SELECT id, 'Pantry', 'groceries-pantry', 10
FROM categories
WHERE slug = 'groceries'
  AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Pantry' COLLATE NOCASE)
  AND NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'groceries-pantry');

INSERT INTO categories(parent_id, name, slug, sort_order)
SELECT id, 'Fridge', 'groceries-fridge', 20
FROM categories
WHERE slug = 'groceries'
  AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Fridge' COLLATE NOCASE)
  AND NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'groceries-fridge');

INSERT INTO categories(parent_id, name, slug, sort_order)
SELECT id, 'Freezer', 'groceries-freezer', 30
FROM categories
WHERE slug = 'groceries'
  AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Freezer' COLLATE NOCASE)
  AND NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'groceries-freezer');
