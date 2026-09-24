-- An icon per place, chosen from the same set as category icons. Empty means "not
-- chosen yet", which the interface resolves from the place's name or its parent.
ALTER TABLE locations ADD COLUMN icon TEXT NOT NULL DEFAULT '';
