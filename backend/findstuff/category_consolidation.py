"""Reviewable category reassignment; source taxonomy and rules remain available."""

import hashlib
import json
import sqlite3
from typing import Any

from .db import transaction
from .inventory import _category_default_rule_matches, list_categories, update_item


def preview(connection: sqlite3.Connection, source: int, target: int) -> dict[str, Any]:
    categories = {entry["id"]: entry for entry in list_categories(connection)}
    if source == target or source not in categories or target not in categories:
        raise ValueError("Choose two different existing categories")
    ids = {
        row[0]
        for row in connection.execute(
            "WITH RECURSIVE tree(id) AS (SELECT id FROM categories WHERE id=? UNION ALL "
            "SELECT c.id FROM categories c JOIN tree t ON c.parent_id=t.id) SELECT id FROM tree",
            (source,),
        )
    }
    if target in ids:
        raise ValueError("Choose a destination outside the source branch")
    items = [
        dict(row)
        for row in connection.execute(
            "SELECT public_id,name,version,archived_at FROM items WHERE category_id IN "
            "(SELECT value FROM json_each(?)) ORDER BY id",
            (json.dumps(sorted(ids)),),
        )
    ]
    rules = [
        dict(row)
        for row in connection.execute(
            "SELECT public_id, match_value, enabled FROM location_rules WHERE rule_type='category'"
        )
        if any(
            _category_default_rule_matches(row["match_value"], categories[category])
            for category in ids
        )
    ]
    result = {
        "source": categories[source]["path"],
        "target": categories[target]["path"],
        "items": items,
        "item_count": len(items),
        "source_rules": rules,
        "target_defaults": categories[target]["default_location"],
        "target_capabilities": categories[target]["capabilities"],
        "categories_retained": len(ids),
    }
    result["token"] = hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()
    return result


def consolidate(connection: sqlite3.Connection, source: int, target: int, token: str):
    with transaction(connection):
        result = preview(connection, source, target)
        if result["token"] != token:
            raise ValueError("Inventory or category rules changed. Preview again before applying.")
        for item in result["items"]:
            update_item(
                connection,
                item["public_id"],
                {"category_id": target, "expected_version": item["version"]},
                source="category_consolidation",
            )
    return {"updated": result["item_count"]}
