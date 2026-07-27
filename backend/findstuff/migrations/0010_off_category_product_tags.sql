CREATE TABLE off_category_product_tags (
    barcode TEXT NOT NULL,
    off_tag TEXT NOT NULL REFERENCES off_category_observations(off_tag) ON DELETE CASCADE,
    is_leaf INTEGER NOT NULL DEFAULT 0,
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(barcode, off_tag)
);

CREATE INDEX idx_off_category_product_tags_leaf
ON off_category_product_tags(off_tag, is_leaf, barcode);
