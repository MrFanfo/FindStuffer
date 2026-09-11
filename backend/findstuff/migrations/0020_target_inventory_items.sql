-- Physical instances are optional; abstract targets survive their sale or deletion.
CREATE TABLE target_inventory_items (
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES compatibility_targets(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, target_id)
);
CREATE INDEX target_inventory_items_target ON target_inventory_items(target_id, item_id);
