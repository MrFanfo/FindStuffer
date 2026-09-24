-- A mark per category, chosen from the app's icon set. Empty means "not chosen
-- yet", which the interface resolves from the nearest ancestor that has one.
ALTER TABLE categories ADD COLUMN icon TEXT NOT NULL DEFAULT '';
