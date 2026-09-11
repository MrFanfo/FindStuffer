-- location_id remains the indexed effective-location projection for legacy queries.
-- direct_location_id is the canonical direct assignment; contained items have none.
ALTER TABLE items ADD COLUMN container_item_id INTEGER REFERENCES items(id) ON DELETE RESTRICT;
ALTER TABLE items ADD COLUMN is_container INTEGER NOT NULL DEFAULT 0 CHECK(is_container IN (0,1));
ALTER TABLE items ADD COLUMN direct_location_id INTEGER REFERENCES locations(id) ON DELETE RESTRICT;
UPDATE items SET direct_location_id=location_id;
CREATE INDEX items_container ON items(container_item_id);
CREATE TRIGGER item_containment_insert AFTER INSERT ON items BEGIN
  UPDATE items SET container_item_id=NEW.container_item_id, direct_location_id=CASE WHEN NEW.container_item_id IS NULL THEN NEW.location_id ELSE NULL END WHERE id=NEW.id;
END;
CREATE TRIGGER item_containment_validate BEFORE UPDATE OF container_item_id,is_container,archived_at ON items BEGIN
  SELECT RAISE(ABORT,'Invalid or archived container item')
    WHERE NEW.container_item_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM items p WHERE p.id=NEW.container_item_id AND p.is_container=1 AND p.archived_at IS NULL
    );
  SELECT RAISE(ABORT,'Item containment cycle') WHERE NEW.id IN (
    WITH RECURSIVE parents(id) AS (
      SELECT NEW.container_item_id UNION SELECT i.container_item_id FROM items i JOIN parents p ON i.id=p.id
      WHERE i.container_item_id IS NOT NULL
    ) SELECT id FROM parents
  );
  SELECT RAISE(ABORT,'Move contents out before archiving or disabling their container')
    WHERE (NEW.is_container=0 OR NEW.archived_at IS NOT NULL) AND EXISTS (
      SELECT 1 FROM items WHERE container_item_id=NEW.id
    );
END;
CREATE TRIGGER item_containment_placement AFTER UPDATE OF container_item_id ON items BEGIN
  UPDATE items SET direct_location_id=CASE WHEN NEW.container_item_id IS NULL THEN location_id ELSE NULL END,
    location_id=CASE WHEN NEW.container_item_id IS NULL THEN location_id ELSE (SELECT location_id FROM items WHERE id=NEW.container_item_id) END
    WHERE id=NEW.id;
END;
CREATE TRIGGER item_effective_location AFTER UPDATE OF location_id ON items WHEN NEW.location_id != OLD.location_id BEGIN
  UPDATE items SET direct_location_id=NEW.location_id WHERE id=NEW.id AND container_item_id IS NULL;
  UPDATE items SET location_id=NEW.location_id, version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id IN (
    WITH RECURSIVE contents(id) AS (
      SELECT id FROM items WHERE container_item_id=NEW.id
      UNION SELECT i.id FROM items i JOIN contents c ON i.container_item_id=c.id
    ) SELECT id FROM contents
  );
END;
