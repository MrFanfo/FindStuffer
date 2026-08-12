from __future__ import annotations

import base64
import json
import re
import secrets
import sqlite3
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from .config import get_settings
from .db import transaction
from .network_security import validate_http_url


class InventoryError(Exception):
    status_code = 400


class NotFoundError(InventoryError):
    status_code = 404


class ConflictError(InventoryError):
    status_code = 409


def new_public_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(12)}"


def to_milli(value: Decimal | str | int) -> int:
    return int(Decimal(str(value)) * 1000)


def from_milli(value: int | None) -> str | None:
    if value is None:
        return None
    rendered = f"{Decimal(value) / 1000:f}"
    return rendered.rstrip("0").rstrip(".") if "." in rendered else rendered


def _validated_links(value: Any) -> list[dict[str, str]]:
    if value in (None, ""):
        return []
    if not isinstance(value, list) or len(value) > 20:
        raise ValueError("Links must be a list of at most 20 entries")
    links: list[dict[str, str]] = []
    for entry in value:
        if not isinstance(entry, dict):
            raise ValueError("Every link must contain a label and URL")
        label = str(entry.get("label") or "").strip()
        url = validate_http_url(str(entry.get("url") or ""))
        if not label or len(label) > 240 or len(url) > 2000:
            raise ValueError("Every link must contain a valid label and URL")
        links.append({"label": label, "url": url})
    return links


def get_location_row(connection: sqlite3.Connection, public_id: str) -> sqlite3.Row:
    row = connection.execute(
        "SELECT * FROM locations WHERE public_id = ? AND archived_at IS NULL", (public_id,)
    ).fetchone()
    if row is None:
        raise NotFoundError("Location not found")
    return row


def location_path(connection: sqlite3.Connection, location_id: int) -> str:
    row = connection.execute(
        """
        WITH RECURSIVE ancestors(id, parent_id, path) AS (
            SELECT id, parent_id, name FROM locations WHERE id = ?
            UNION ALL
            SELECT parent.id, parent.parent_id, parent.name || ' > ' || ancestors.path
            FROM locations AS parent
            JOIN ancestors ON ancestors.parent_id = parent.id
        )
        SELECT path FROM ancestors WHERE parent_id IS NULL
        """,
        (location_id,),
    ).fetchone()
    return row["path"] if row else "Unknown"


def location_paths(connection: sqlite3.Connection, location_ids: set[int]) -> dict[int, str]:
    if not location_ids:
        return {}
    placeholders = ", ".join("?" for _ in location_ids)
    rows = connection.execute(
        f"""
        WITH RECURSIVE ancestors(origin_id, id, parent_id, path) AS (
            SELECT id, id, parent_id, name FROM locations WHERE id IN ({placeholders})
            UNION ALL
            SELECT ancestors.origin_id, parent.id, parent.parent_id,
                   parent.name || ' > ' || ancestors.path
            FROM locations AS parent
            JOIN ancestors ON ancestors.parent_id = parent.id
        )
        SELECT origin_id, path FROM ancestors WHERE parent_id IS NULL
        """,
        tuple(location_ids),
    ).fetchall()
    paths = {row["origin_id"]: row["path"] for row in rows}
    return {location_id: paths.get(location_id, "Unknown") for location_id in location_ids}


def get_category_row(connection: sqlite3.Connection, category_id: int) -> sqlite3.Row:
    row = connection.execute("SELECT * FROM categories WHERE id = ?", (category_id,)).fetchone()
    if row is None:
        raise NotFoundError("Category not found")
    return row


def category_path(connection: sqlite3.Connection, category_id: int) -> str:
    row = connection.execute(
        """
        WITH RECURSIVE ancestors(id, parent_id, path) AS (
            SELECT id, parent_id, name FROM categories WHERE id = ?
            UNION ALL
            SELECT parent.id, parent.parent_id, parent.name || ' > ' || ancestors.path
            FROM categories AS parent
            JOIN ancestors ON ancestors.parent_id = parent.id
        )
        SELECT path FROM ancestors WHERE parent_id IS NULL
        """,
        (category_id,),
    ).fetchone()
    return row["path"] if row else "Uncategorised"


def category_paths(connection: sqlite3.Connection, category_ids: set[int]) -> dict[int, str]:
    if not category_ids:
        return {}
    placeholders = ", ".join("?" for _ in category_ids)
    rows = connection.execute(
        f"""
        WITH RECURSIVE ancestors(origin_id, id, parent_id, path) AS (
            SELECT id, id, parent_id, name FROM categories WHERE id IN ({placeholders})
            UNION ALL
            SELECT ancestors.origin_id, parent.id, parent.parent_id,
                   parent.name || ' > ' || ancestors.path
            FROM categories AS parent
            JOIN ancestors ON ancestors.parent_id = parent.id
        )
        SELECT origin_id, path FROM ancestors WHERE parent_id IS NULL
        """,
        tuple(category_ids),
    ).fetchall()
    paths = {row["origin_id"]: row["path"] for row in rows}
    return {category_id: paths.get(category_id, "Uncategorised") for category_id in category_ids}


def category_descendant_ids(connection: sqlite3.Connection, category_id: int) -> list[int]:
    get_category_row(connection, category_id)
    return [
        row["id"]
        for row in connection.execute(
            """
            WITH RECURSIVE descendants(id) AS (
                SELECT id FROM categories WHERE id = ?
                UNION ALL
                SELECT categories.id FROM categories
                JOIN descendants ON categories.parent_id = descendants.id
            )
            SELECT id FROM descendants
            """,
            (category_id,),
        )
    ]


def location_descendant_ids(connection: sqlite3.Connection, location_id: int) -> list[int]:
    return [
        row["id"]
        for row in connection.execute(
            """
            WITH RECURSIVE descendants(id) AS (
                SELECT id FROM locations WHERE id = ?
                UNION ALL
                SELECT locations.id FROM locations
                JOIN descendants ON locations.parent_id = descendants.id
                WHERE locations.archived_at IS NULL
            )
            SELECT id FROM descendants
            """,
            (location_id,),
        )
    ]


def list_location_tree(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT id, public_id, parent_id, name, kind, description, sort_order
        FROM locations
        WHERE archived_at IS NULL
        ORDER BY sort_order, name COLLATE NOCASE
        """
    ).fetchall()
    nodes = {
        row["id"]: {
            "id": row["id"],
            "public_id": row["public_id"],
            "parent_id": row["parent_id"],
            "name": row["name"],
            "kind": row["kind"],
            "description": row["description"],
            "children": [],
        }
        for row in rows
    }
    direct_counts = {
        row["location_id"]: row["count"]
        for row in connection.execute(
            """
            SELECT location_id, count(*) AS count
            FROM items
            WHERE archived_at IS NULL
            GROUP BY location_id
            """
        )
    }
    roots: list[dict[str, Any]] = []
    for node in nodes.values():
        parent = nodes.get(node["parent_id"])
        if parent:
            parent["children"].append(node)
        else:
            roots.append(node)

    def clean(node: dict[str, Any], prefix: str = "") -> dict[str, Any]:
        path = f"{prefix} > {node['name']}" if prefix else node["name"]
        children = [clean(child, path) for child in node["children"]]
        item_count = direct_counts.get(node["id"], 0)
        return {
            "public_id": node["public_id"],
            "name": node["name"],
            "kind": node["kind"],
            "description": node["description"],
            "path": path,
            "item_count": item_count,
            "total_item_count": item_count + sum(child["total_item_count"] for child in children),
            "children": children,
        }

    return [clean(root) for root in roots]


def _location_sibling_exists(
    connection: sqlite3.Connection,
    name: str,
    parent_id: int | None,
    *,
    exclude_id: int | None = None,
) -> bool:
    return (
        connection.execute(
            """
            SELECT 1 FROM locations
            WHERE ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)
              AND name = ? COLLATE NOCASE
              AND (? IS NULL OR id != ?)
            """,
            (parent_id, parent_id, name.strip(), exclude_id, exclude_id),
        ).fetchone()
        is not None
    )


def create_location(connection: sqlite3.Connection, values: dict[str, Any]) -> dict[str, Any]:
    parent_id = None
    if values.get("parent_public_id"):
        parent_id = get_location_row(connection, values["parent_public_id"])["id"]
    ensure_location_type(connection, values.get("kind", "location"))
    if _location_sibling_exists(connection, values["name"], parent_id):
        raise ConflictError("A location with that name already exists here")
    public_id = new_public_id("loc")
    try:
        with transaction(connection):
            connection.execute(
                """
                INSERT INTO locations(public_id, parent_id, name, kind, description)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    public_id,
                    parent_id,
                    values["name"],
                    values.get("kind", "location"),
                    values.get("description", ""),
                ),
            )
    except sqlite3.IntegrityError as exc:
        raise ConflictError("A location with that name already exists here") from exc
    row = get_location_row(connection, public_id)
    return serialize_location(connection, row)


def serialize_location(connection: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    parent_public_id = None
    if row["parent_id"] is not None:
        parent = connection.execute(
            "SELECT public_id FROM locations WHERE id = ?", (row["parent_id"],)
        ).fetchone()
        parent_public_id = parent["public_id"] if parent else None
    item_count = connection.execute(
        "SELECT count(*) AS count FROM items WHERE location_id = ? AND archived_at IS NULL",
        (row["id"],),
    ).fetchone()["count"]
    return {
        "public_id": row["public_id"],
        "parent_public_id": parent_public_id,
        "name": row["name"],
        "kind": row["kind"],
        "description": row["description"],
        "path": location_path(connection, row["id"]),
        "item_count": item_count,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def update_location(
    connection: sqlite3.Connection, public_id: str, changes: dict[str, Any]
) -> dict[str, Any]:
    row = get_location_row(connection, public_id)
    if public_id == "unassigned" and "parent_public_id" in changes:
        raise ConflictError("The Unassigned system location cannot be moved")
    assignments: list[str] = []
    parameters: list[Any] = []
    next_name = row["name"]
    next_parent_id = row["parent_id"]
    for field in ("name", "kind", "description"):
        if field in changes:
            assignments.append(f"{field} = ?")
            parameters.append(changes[field])
            if field == "name":
                next_name = changes[field]
    if "parent_public_id" in changes:
        parent_id = None
        parent_public_id = changes["parent_public_id"]
        if parent_public_id:
            parent_id = get_location_row(connection, parent_public_id)["id"]
            cycle = connection.execute(
                """
                WITH RECURSIVE descendants(id) AS (
                    SELECT id FROM locations WHERE id = ?
                    UNION ALL
                    SELECT locations.id FROM locations
                    JOIN descendants ON locations.parent_id = descendants.id
                )
                SELECT 1 FROM descendants WHERE id = ?
                """,
                (row["id"], parent_id),
            ).fetchone()
            if cycle:
                raise ConflictError("A location cannot be moved inside itself")
        assignments.append("parent_id = ?")
        parameters.append(parent_id)
        next_parent_id = parent_id
    if not assignments:
        return serialize_location(connection, row)
    if ("name" in changes or "parent_public_id" in changes) and _location_sibling_exists(
        connection,
        next_name,
        next_parent_id,
        exclude_id=int(row["id"]),
    ):
        raise ConflictError("A location with that name already exists here")
    parameters.append(row["id"])
    try:
        with transaction(connection):
            connection.execute(
                f"UPDATE locations SET {', '.join(assignments)}, "
                "updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                parameters,
            )
            rebuild_search_index(connection)
    except sqlite3.IntegrityError as exc:
        raise ConflictError("A location with that name already exists here") from exc
    return serialize_location(connection, get_location_row(connection, public_id))


def delete_location(connection: sqlite3.Connection, public_id: str) -> None:
    row = get_location_row(connection, public_id)
    if public_id == "unassigned":
        raise ConflictError("The Unassigned system location cannot be deleted")
    has_children = connection.execute(
        "SELECT 1 FROM locations WHERE parent_id = ? AND archived_at IS NULL", (row["id"],)
    ).fetchone()
    has_items = connection.execute(
        "SELECT 1 FROM items WHERE location_id = ? AND archived_at IS NULL", (row["id"],)
    ).fetchone()
    if has_children or has_items:
        raise ConflictError("Move contained locations and items before deleting this location")
    with transaction(connection):
        connection.execute(
            "UPDATE locations SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP "
            "WHERE id = ?",
            (row["id"],),
        )


def delete_location_tree(connection: sqlite3.Connection, public_id: str) -> None:
    row = get_location_row(connection, public_id)
    if public_id == "unassigned":
        raise ConflictError("The Unassigned system location cannot be deleted")
    location_ids = location_descendant_ids(connection, row["id"])
    placeholders = ", ".join("?" for _ in location_ids)
    with transaction(connection):
        archived_items = connection.execute(
            f"""
            UPDATE items
            SET archived_at = CURRENT_TIMESTAMP,
                version = version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE archived_at IS NULL AND location_id IN ({placeholders})
            """,
            tuple(location_ids),
        )
        connection.execute(
            f"""
            UPDATE locations
            SET archived_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id IN ({placeholders})
            """,
            tuple(location_ids),
        )
        if archived_items.rowcount:
            rebuild_search_index(connection)


ITEM_SELECT = """
SELECT items.*, locations.public_id AS location_public_id,
       locations.name AS location_name, categories.name AS category_name,
       categories.slug AS category_slug, categories.parent_id AS category_parent_id,
       COALESCE(NULLIF(items.barcode_override, ''), products.barcode, '') AS barcode
FROM items
JOIN locations ON locations.id = items.location_id
LEFT JOIN categories ON categories.id = items.category_id
LEFT JOIN products ON products.id = items.product_id
"""


def get_item_row(connection: sqlite3.Connection, public_id: str) -> sqlite3.Row:
    row = connection.execute(ITEM_SELECT + " WHERE items.public_id = ?", (public_id,)).fetchone()
    if row is None:
        raise NotFoundError("Item not found")
    return row


def serialize_item(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
    *,
    tags: list[str] | None = None,
    item_location_path: str | None = None,
    item_category_path: str | None = None,
    primary_photo_url: str | None = None,
) -> dict[str, Any]:
    if tags is None:
        tags = [
            tag["name"]
            for tag in connection.execute(
                """
                SELECT tags.name FROM tags
                JOIN item_tags ON item_tags.tag_id = tags.id
                WHERE item_tags.item_id = ? ORDER BY tags.name COLLATE NOCASE
                """,
                (row["id"],),
            )
        ]
    try:
        links = json.loads(row["links_json"] or "[]")
    except (json.JSONDecodeError, KeyError):
        links = []
    if not isinstance(links, list):
        links = []
    return {
        "public_id": row["public_id"],
        "version": row["version"],
        "name": row["name"],
        "description": row["description"],
        "notes": row["notes"],
        "category_id": row["category_id"],
        "category_name": row["category_name"],
        "category_slug": row["category_slug"],
        "category_parent_id": row["category_parent_id"],
        "category_path": item_category_path
        if item_category_path is not None
        else category_path(connection, row["category_id"])
        if row["category_id"] is not None
        else None,
        "location_public_id": row["location_public_id"],
        "location_name": row["location_name"],
        "location_path": item_location_path
        if item_location_path is not None
        else location_path(connection, row["location_id"]),
        "quantity": from_milli(row["quantity_milli"]),
        "unit": row["unit"],
        "purchase_price_minor": row["purchase_price_minor"],
        "purchase_currency": row["purchase_currency"],
        "estimated_price_minor": row["estimated_price_minor"],
        "estimated_price_currency": row["estimated_price_currency"],
        "estimated_price_at": row["estimated_price_at"],
        "weight_g": row["weight_g"],
        "length_mm": row["length_mm"],
        "width_mm": row["width_mm"],
        "height_mm": row["height_mm"],
        "serial_number": row["serial_number"],
        "model": row["model"],
        "brand": row["brand"],
        "expiration_date": row["expiration_date"],
        "low_stock_threshold": from_milli(row["low_stock_milli"]),
        "barcode": row["barcode"],
        "links": links,
        "tags": tags,
        "archived_at": row["archived_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "primary_photo_url": primary_photo_url,
    }


def serialize_item_rows(
    connection: sqlite3.Connection, rows: list[sqlite3.Row]
) -> list[dict[str, Any]]:
    if not rows:
        return []
    item_ids = [row["id"] for row in rows]
    item_placeholders = ", ".join("?" for _ in item_ids)
    tags_by_item: dict[int, list[str]] = {item_id: [] for item_id in item_ids}
    for tag in connection.execute(
        f"""
        SELECT item_tags.item_id, tags.name FROM item_tags
        JOIN tags ON tags.id = item_tags.tag_id
        WHERE item_tags.item_id IN ({item_placeholders})
        ORDER BY tags.name COLLATE NOCASE
        """,
        item_ids,
    ):
        tags_by_item[tag["item_id"]].append(tag["name"])

    paths_by_location = location_paths(connection, {row["location_id"] for row in rows})
    paths_by_category = category_paths(
        connection, {row["category_id"] for row in rows if row["category_id"] is not None}
    )
    primary_photos = {
        row["item_id"]: row["public_id"]
        for row in connection.execute(
            f"""
            SELECT item_id, public_id FROM (
                SELECT item_id, public_id,
                       row_number() OVER (
                           PARTITION BY item_id ORDER BY sort_order, id
                       ) AS rank
                FROM photos WHERE item_id IN ({item_placeholders})
            ) WHERE rank = 1
            """,
            item_ids,
        )
    }
    return [
        serialize_item(
            connection,
            row,
            tags=tags_by_item[row["id"]],
            item_location_path=paths_by_location[row["location_id"]],
            item_category_path=paths_by_category.get(row["category_id"])
            if row["category_id"] is not None
            else None,
            primary_photo_url=(
                f"/api/v1/photos/{primary_photos[row['id']]}/content"
                if row["id"] in primary_photos
                else None
            ),
        )
        for row in rows
    ]


def serialize_item_lot(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "public_id": row["public_id"],
        "quantity": from_milli(row["quantity_milli"]),
        "expiration_date": row["expiration_date"],
        "note": row["note"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_item_lots(connection: sqlite3.Connection, item_public_id: str) -> list[dict[str, Any]]:
    item = get_item_row(connection, item_public_id)
    rows = connection.execute(
        """
        SELECT * FROM item_lots
        WHERE item_id = ? AND quantity_milli > 0
        ORDER BY expiration_date IS NULL, expiration_date, id
        """,
        (item["id"],),
    ).fetchall()
    return [serialize_item_lot(row) for row in rows]


def _next_lot_expiration(connection: sqlite3.Connection, item_id: int) -> str | None:
    row = connection.execute(
        """
        SELECT expiration_date FROM item_lots
        WHERE item_id = ? AND quantity_milli > 0 AND expiration_date IS NOT NULL
        ORDER BY expiration_date LIMIT 1
        """,
        (item_id,),
    ).fetchone()
    return row["expiration_date"] if row else None


def _sync_item_from_lots(connection: sqlite3.Connection, item_id: int) -> None:
    row = connection.execute(
        """
        SELECT count(*) AS lot_count, COALESCE(sum(quantity_milli), 0) AS total
        FROM item_lots WHERE item_id = ?
        """,
        (item_id,),
    ).fetchone()
    if row["lot_count"] == 0:
        return
    connection.execute(
        """
        UPDATE items SET quantity_milli = ?, expiration_date = ?, version = version + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (row["total"], _next_lot_expiration(connection, item_id), item_id),
    )


def create_item_lot(
    connection: sqlite3.Connection, item_public_id: str, values: dict[str, Any]
) -> dict[str, Any]:
    item = get_item_row(connection, item_public_id)
    public_id = new_public_id("lot")
    expiration = values.get("expiration_date")
    if expiration is not None:
        expiration = expiration.isoformat() if hasattr(expiration, "isoformat") else str(expiration)
    before = serialize_item(connection, item)
    with transaction(connection):
        connection.execute(
            """
            INSERT INTO item_lots(public_id, item_id, quantity_milli, expiration_date, note)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                public_id,
                item["id"],
                to_milli(values["quantity"]),
                expiration,
                values.get("note", ""),
            ),
        )
        _sync_item_from_lots(connection, item["id"])
        after = serialize_item(connection, get_item_row(connection, item_public_id))
        record_event(connection, item["id"], "update_lots", before, after, source="manual")
        reindex_item(connection, item["id"])
    row = connection.execute("SELECT * FROM item_lots WHERE public_id = ?", (public_id,)).fetchone()
    return serialize_item_lot(row)


def update_item_lot(
    connection: sqlite3.Connection, item_public_id: str, lot_public_id: str, changes: dict[str, Any]
) -> dict[str, Any]:
    item = get_item_row(connection, item_public_id)
    lot = connection.execute(
        "SELECT * FROM item_lots WHERE public_id = ? AND item_id = ?",
        (lot_public_id, item["id"]),
    ).fetchone()
    if lot is None:
        raise NotFoundError("Item lot not found")
    assignments: list[str] = []
    parameters: list[Any] = []
    for field, value in changes.items():
        if field == "quantity" and value is not None:
            value = to_milli(value)
            field = "quantity_milli"
        if field == "expiration_date" and value is not None:
            value = value.isoformat() if hasattr(value, "isoformat") else str(value)
        assignments.append(f"{field} = ?")
        parameters.append(value)
    if not assignments:
        return serialize_item_lot(lot)
    before = serialize_item(connection, item)
    parameters.append(lot["id"])
    with transaction(connection):
        assignment_sql = ", ".join(assignments)
        connection.execute(
            f"""
            UPDATE item_lots
            SET {assignment_sql}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            parameters,
        )
        _sync_item_from_lots(connection, item["id"])
        after = serialize_item(connection, get_item_row(connection, item_public_id))
        record_event(connection, item["id"], "update_lots", before, after, source="manual")
        reindex_item(connection, item["id"])
    row = connection.execute("SELECT * FROM item_lots WHERE id = ?", (lot["id"],)).fetchone()
    return serialize_item_lot(row)


def delete_item_lot(
    connection: sqlite3.Connection, item_public_id: str, lot_public_id: str
) -> None:
    item = get_item_row(connection, item_public_id)
    lot = connection.execute(
        "SELECT * FROM item_lots WHERE public_id = ? AND item_id = ?",
        (lot_public_id, item["id"]),
    ).fetchone()
    if lot is None:
        raise NotFoundError("Item lot not found")
    before = serialize_item(connection, item)
    with transaction(connection):
        connection.execute("DELETE FROM item_lots WHERE id = ?", (lot["id"],))
        _sync_item_from_lots(connection, item["id"])
        after = serialize_item(connection, get_item_row(connection, item_public_id))
        record_event(connection, item["id"], "update_lots", before, after, source="manual")
        reindex_item(connection, item["id"])


def serialize_maintenance_task(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "public_id": row["public_id"],
        "title": row["title"],
        "notes": row["notes"],
        "interval_days": row["interval_days"],
        "last_completed_at": row["last_completed_at"],
        "next_due_at": row["next_due_at"],
        "archived_at": row["archived_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_maintenance_tasks(
    connection: sqlite3.Connection, item_public_id: str
) -> list[dict[str, Any]]:
    item = get_item_row(connection, item_public_id)
    rows = connection.execute(
        """
        SELECT * FROM maintenance_tasks
        WHERE item_id = ? AND archived_at IS NULL
        ORDER BY next_due_at, title COLLATE NOCASE
        """,
        (item["id"],),
    ).fetchall()
    return [serialize_maintenance_task(row) for row in rows]


def create_maintenance_task(
    connection: sqlite3.Connection, item_public_id: str, values: dict[str, Any]
) -> dict[str, Any]:
    item = get_item_row(connection, item_public_id)
    public_id = new_public_id("mnt")
    with transaction(connection):
        connection.execute(
            """
            INSERT INTO maintenance_tasks(
                public_id, item_id, title, notes, interval_days, last_completed_at, next_due_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                public_id,
                item["id"],
                values["title"],
                values.get("notes", ""),
                values["interval_days"],
                values.get("last_completed_at").isoformat()
                if values.get("last_completed_at") is not None
                else None,
                values["next_due_at"].isoformat()
                if hasattr(values["next_due_at"], "isoformat")
                else str(values["next_due_at"]),
            ),
        )
        record_event(connection, item["id"], "create_maintenance_task", None, values)
    row = connection.execute(
        "SELECT * FROM maintenance_tasks WHERE public_id = ?", (public_id,)
    ).fetchone()
    return serialize_maintenance_task(row)


def complete_maintenance_task(
    connection: sqlite3.Connection, item_public_id: str, task_public_id: str
) -> dict[str, Any]:
    item = get_item_row(connection, item_public_id)
    task = connection.execute(
        """
        SELECT * FROM maintenance_tasks
        WHERE public_id = ? AND item_id = ? AND archived_at IS NULL
        """,
        (task_public_id, item["id"]),
    ).fetchone()
    if task is None:
        raise NotFoundError("Maintenance task not found")
    completed = date.today()
    next_due = completed + timedelta(days=int(task["interval_days"]))
    before = serialize_maintenance_task(task)
    with transaction(connection):
        connection.execute(
            """
            UPDATE maintenance_tasks
            SET last_completed_at = ?, next_due_at = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (completed.isoformat(), next_due.isoformat(), task["id"]),
        )
        after = {
            **before,
            "last_completed_at": completed.isoformat(),
            "next_due_at": next_due.isoformat(),
        }
        record_event(connection, item["id"], "complete_maintenance_task", before, after)
    row = connection.execute(
        "SELECT * FROM maintenance_tasks WHERE id = ?", (task["id"],)
    ).fetchone()
    return serialize_maintenance_task(row)


def record_event(
    connection: sqlite3.Connection,
    item_id: int,
    action: str,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    *,
    quantity_delta_milli: int | None = None,
    from_location_id: int | None = None,
    to_location_id: int | None = None,
    source: str = "manual",
) -> None:
    connection.execute(
        """
        INSERT INTO inventory_events(
            public_id, item_id, action, quantity_delta_milli,
            from_location_id, to_location_id, before_json, after_json, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_public_id("evt"),
            item_id,
            action,
            quantity_delta_milli,
            from_location_id,
            to_location_id,
            json.dumps(before, default=str, separators=(",", ":")) if before else None,
            json.dumps(after, default=str, separators=(",", ":")) if after else None,
            source,
        ),
    )


def reindex_item(connection: sqlite3.Connection, item_id: int) -> None:
    row = connection.execute(
        """
        SELECT items.*, categories.name AS category_name,
               COALESCE(NULLIF(items.barcode_override, ''), products.barcode, '') AS barcode,
               COALESCE(group_concat(tags.name, ' '), '') AS tag_names
        FROM items
        LEFT JOIN categories ON categories.id = items.category_id
        LEFT JOIN products ON products.id = items.product_id
        LEFT JOIN item_tags ON item_tags.item_id = items.id
        LEFT JOIN tags ON tags.id = item_tags.tag_id
        WHERE items.id = ?
        GROUP BY items.id
        """,
        (item_id,),
    ).fetchone()
    connection.execute("DELETE FROM item_fts WHERE item_id = ?", (item_id,))
    if row is None or row["archived_at"] is not None:
        return
    category_text = category_path(connection, row["category_id"]) if row["category_id"] else ""
    connection.execute(
        """
        INSERT INTO item_fts(
            item_id, name, description, notes, category, tags, location_path,
            brand, model, serial_number, barcode
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            item_id,
            row["name"],
            row["description"],
            row["notes"],
            category_text,
            row["tag_names"],
            location_path(connection, row["location_id"]),
            row["brand"],
            row["model"],
            row["serial_number"],
            row["barcode"],
        ),
    )


def rebuild_search_index(connection: sqlite3.Connection) -> None:
    connection.execute("DELETE FROM item_fts")
    item_ids = connection.execute(
        "SELECT id FROM items WHERE archived_at IS NULL ORDER BY id"
    ).fetchall()
    for item in item_ids:
        reindex_item(connection, item["id"])


def create_item(
    connection: sqlite3.Connection, values: dict[str, Any], *, source: str = "manual"
) -> dict[str, Any]:
    location = get_location_row(connection, values.pop("location_public_id", "unassigned"))
    if values.get("category_id") is not None:
        get_category_row(connection, int(values["category_id"]))
    public_id = new_public_id("itm")
    quantity_milli = to_milli(values.pop("quantity", 1))
    low_stock = values.pop("low_stock_threshold", None)
    barcode = values.pop("barcode", "")
    product_id = None
    if barcode:
        product_id = ensure_product(
            connection,
            barcode,
            values.get("name", ""),
            values.get("brand", ""),
        )
    expiration = values.get("expiration_date")
    if expiration is not None:
        values["expiration_date"] = (
            expiration.isoformat() if hasattr(expiration, "isoformat") else str(expiration)
        )
    columns = [
        "name",
        "description",
        "notes",
        "category_id",
        "unit",
        "purchase_price_minor",
        "purchase_currency",
        "estimated_price_minor",
        "estimated_price_currency",
        "weight_g",
        "length_mm",
        "width_mm",
        "height_mm",
        "serial_number",
        "model",
        "brand",
        "expiration_date",
        "links_json",
    ]
    defaults: dict[str, Any] = {
        "description": "",
        "notes": "",
        "unit": "pcs",
        "serial_number": "",
        "model": "",
        "brand": "",
        "links_json": "[]",
    }
    if "links" in values:
        values["links_json"] = json.dumps(
            _validated_links(values.pop("links")),
            separators=(",", ":"),
        )
    parameters = [values.get(column, defaults.get(column)) for column in columns]
    with transaction(connection):
        cursor = connection.execute(
            f"""
            INSERT INTO items(
                public_id, location_id, product_id, quantity_milli,
                low_stock_milli, barcode_override,
                {", ".join(columns)}
            ) VALUES (?, ?, ?, ?, ?, ?, {", ".join("?" for _ in columns)})
            """,
            (
                public_id,
                location["id"],
                product_id,
                quantity_milli,
                to_milli(low_stock) if low_stock is not None else None,
                barcode,
                *parameters,
            ),
        )
        item_id = cursor.lastrowid
        row = get_item_row(connection, public_id)
        after = serialize_item(connection, row)
        record_event(
            connection,
            item_id,
            "create",
            None,
            after,
            quantity_delta_milli=quantity_milli,
            to_location_id=location["id"],
            source=source,
        )
        if quantity_milli > 0:
            connection.execute(
                """
                INSERT INTO item_lots(
                    public_id, item_id, quantity_milli, expiration_date, note
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    new_public_id("lot"),
                    item_id,
                    quantity_milli,
                    values.get("expiration_date"),
                    "Initial quantity",
                ),
            )
        reindex_item(connection, item_id)
    return serialize_item(connection, get_item_row(connection, public_id))


def get_item(connection: sqlite3.Connection, public_id: str) -> dict[str, Any]:
    return serialize_item(connection, get_item_row(connection, public_id))


def _fts_expression(query: str) -> str:
    tokens = re.findall(r"[\w-]+", query, flags=re.UNICODE)
    return " ".join(f'"{token.replace(chr(34), chr(34) * 2)}"*' for token in tokens[:12])


def _encode_item_cursor(updated_at: str, item_id: int) -> str:
    payload = json.dumps([updated_at, item_id], separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _decode_item_cursor(cursor: str) -> tuple[str, int]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        value = json.loads(base64.urlsafe_b64decode(padded).decode())
        if (
            not isinstance(value, list)
            or len(value) != 2
            or not isinstance(value[0], str)
            or not isinstance(value[1], int)
        ):
            raise ValueError
        return value[0], value[1]
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid inventory cursor") from exc


def _item_rows(
    connection: sqlite3.Connection,
    *,
    query: str = "",
    location_public_id: str | None = None,
    category_id: int | None = None,
    low_stock: bool = False,
    needs_details: bool = False,
    include_archived: bool = False,
    archived_only: bool = False,
    include_zero: bool = False,
    limit: int = 100,
    cursor: str | None = None,
) -> list[sqlite3.Row]:
    parameters: list[Any] = []
    conditions: list[str] = []
    prefix = ITEM_SELECT
    if query.strip() and _fts_expression(query):
        prefix += " JOIN item_fts ON item_fts.item_id = items.id"
        conditions.append("item_fts MATCH ?")
        parameters.append(_fts_expression(query))
    if archived_only:
        conditions.append("items.archived_at IS NOT NULL")
    elif not include_archived:
        conditions.append("items.archived_at IS NULL")
    if not include_zero:
        conditions.append("items.quantity_milli > 0")
    if location_public_id:
        location = get_location_row(connection, location_public_id)
        conditions.append("items.location_id = ?")
        parameters.append(location["id"])
    if category_id is not None:
        category_ids = category_descendant_ids(connection, category_id)
        placeholders = ", ".join("?" for _ in category_ids)
        conditions.append(f"items.category_id IN ({placeholders})")
        parameters.extend(category_ids)
    if low_stock:
        conditions.append(
            "items.low_stock_milli IS NOT NULL AND items.quantity_milli <= items.low_stock_milli"
        )
    if needs_details:
        conditions.append("locations.public_id = 'unassigned'")
    if cursor:
        updated_at, item_id = _decode_item_cursor(cursor)
        conditions.append("(items.updated_at < ? OR (items.updated_at = ? AND items.id < ?))")
        parameters.extend((updated_at, updated_at, item_id))
    sql = prefix
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY items.updated_at DESC, items.id DESC, items.name COLLATE NOCASE LIMIT ?"
    parameters.append(min(max(limit, 1), 2000))
    return connection.execute(sql, parameters).fetchall()


def list_items(
    connection: sqlite3.Connection,
    *,
    query: str = "",
    location_public_id: str | None = None,
    category_id: int | None = None,
    low_stock: bool = False,
    needs_details: bool = False,
    include_archived: bool = False,
    archived_only: bool = False,
    include_zero: bool = False,
    limit: int = 100,
    cursor: str | None = None,
) -> list[dict[str, Any]]:
    rows = _item_rows(
        connection,
        query=query,
        location_public_id=location_public_id,
        category_id=category_id,
        low_stock=low_stock,
        needs_details=needs_details,
        include_archived=include_archived,
        archived_only=archived_only,
        include_zero=include_zero,
        limit=limit,
        cursor=cursor,
    )
    return serialize_item_rows(connection, rows)


def list_items_page(
    connection: sqlite3.Connection,
    *,
    query: str = "",
    location_public_id: str | None = None,
    category_id: int | None = None,
    low_stock: bool = False,
    needs_details: bool = False,
    include_archived: bool = False,
    archived_only: bool = False,
    include_zero: bool = False,
    limit: int = 100,
    cursor: str | None = None,
) -> dict[str, Any]:
    page_limit = min(max(limit, 1), 250)
    rows = _item_rows(
        connection,
        query=query,
        location_public_id=location_public_id,
        category_id=category_id,
        low_stock=low_stock,
        needs_details=needs_details,
        include_archived=include_archived,
        archived_only=archived_only,
        include_zero=include_zero,
        limit=page_limit + 1,
        cursor=cursor,
    )
    has_more = len(rows) > page_limit
    page_rows = rows[:page_limit]
    next_cursor = (
        _encode_item_cursor(page_rows[-1]["updated_at"], int(page_rows[-1]["id"]))
        if has_more and page_rows
        else None
    )
    return {
        "items": serialize_item_rows(connection, page_rows),
        "next_cursor": next_cursor,
        "has_more": has_more,
    }


def update_item(
    connection: sqlite3.Connection,
    public_id: str,
    changes: dict[str, Any],
    *,
    source: str = "manual",
) -> dict[str, Any]:
    allowed_fields = {
        "barcode",
        "brand",
        "category_id",
        "description",
        "estimated_price_currency",
        "estimated_price_minor",
        "expiration_date",
        "height_mm",
        "length_mm",
        "links",
        "location_public_id",
        "low_stock_threshold",
        "model",
        "name",
        "notes",
        "purchase_currency",
        "purchase_price_minor",
        "quantity",
        "serial_number",
        "unit",
        "weight_g",
        "width_mm",
    }
    unknown_fields = set(changes) - allowed_fields - {"expected_version"}
    if unknown_fields:
        raise ValueError(
            "Unsupported item update field(s): " + ", ".join(sorted(unknown_fields))
        )
    row = get_item_row(connection, public_id)
    expected_version = changes.pop("expected_version")
    if row["version"] != expected_version:
        raise ConflictError("Item changed since it was opened; reload and try again")
    before = serialize_item(connection, row)
    assignments: list[str] = []
    parameters: list[Any] = []
    renamed = {
        "quantity": "quantity_milli",
        "low_stock_threshold": "low_stock_milli",
        "barcode": "barcode_override",
        "links": "links_json",
    }
    old_location_id = row["location_id"]
    new_location_id = old_location_id
    lot_quantity_milli: int | None = None
    lot_expiration_marker = object()
    lot_expiration: Any = lot_expiration_marker
    for field, value in changes.items():
        if field == "location_public_id":
            new_location_id = get_location_row(connection, value)["id"]
            assignments.append("location_id = ?")
            parameters.append(new_location_id)
            continue
        if field == "category_id" and value is not None:
            get_category_row(connection, int(value))
        column = renamed.get(field, field)
        if field in {"quantity", "low_stock_threshold"} and value is not None:
            value = to_milli(value)
            if field == "quantity":
                lot_quantity_milli = value
        if field == "expiration_date" and value is not None:
            value = value.isoformat() if hasattr(value, "isoformat") else str(value)
        if field == "expiration_date":
            lot_expiration = value
        if field == "links":
            value = json.dumps(_validated_links(value), separators=(",", ":"))
        assignments.append(f"{column} = ?")
        parameters.append(value)
    if not assignments:
        return before
    parameters.extend([row["id"], expected_version])
    with transaction(connection):
        cursor = connection.execute(
            f"""
            UPDATE items SET {", ".join(assignments)}, version = version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND version = ?
            """,
            parameters,
        )
        if cursor.rowcount != 1:
            raise ConflictError("Item changed since it was opened; reload and try again")
        lot_count = connection.execute(
            "SELECT count(*) AS count FROM item_lots WHERE item_id = ?", (row["id"],)
        ).fetchone()["count"]
        should_sync_single_lot = lot_count == 1 and (
            lot_quantity_milli is not None or lot_expiration is not lot_expiration_marker
        )
        if should_sync_single_lot:
            lot_assignments: list[str] = []
            lot_parameters: list[Any] = []
            if lot_quantity_milli is not None:
                lot_assignments.append("quantity_milli = ?")
                lot_parameters.append(lot_quantity_milli)
            if lot_expiration is not lot_expiration_marker:
                lot_assignments.append("expiration_date = ?")
                lot_parameters.append(lot_expiration)
            lot_parameters.append(row["id"])
            connection.execute(
                f"UPDATE item_lots SET {', '.join(lot_assignments)}, "
                "updated_at = CURRENT_TIMESTAMP WHERE item_id = ?",
                lot_parameters,
            )
        updated_row = get_item_row(connection, public_id)
        after = serialize_item(connection, updated_row)
        quantity_delta = updated_row["quantity_milli"] - row["quantity_milli"]
        action = (
            "move" if old_location_id != new_location_id and len(assignments) == 1 else "update"
        )
        record_event(
            connection,
            row["id"],
            action,
            before,
            after,
            quantity_delta_milli=quantity_delta or None,
            from_location_id=old_location_id if old_location_id != new_location_id else None,
            to_location_id=new_location_id if old_location_id != new_location_id else None,
            source=source,
        )
        reindex_item(connection, row["id"])
    return serialize_item(connection, get_item_row(connection, public_id))


def adjust_quantity(
    connection: sqlite3.Connection,
    public_id: str,
    delta: Decimal,
    expected_version: int,
    *,
    source: str = "manual",
) -> dict[str, Any]:
    row = get_item_row(connection, public_id)
    if row["version"] != expected_version:
        raise ConflictError("Item changed since it was opened; reload and try again")
    delta_milli = to_milli(delta)
    new_quantity = row["quantity_milli"] + delta_milli
    if new_quantity < 0:
        raise ConflictError("Quantity cannot become negative")
    before = serialize_item(connection, row)
    with transaction(connection):
        if delta_milli < 0:
            remaining = -delta_milli
            lots = connection.execute(
                """
                SELECT * FROM item_lots
                WHERE item_id = ? AND quantity_milli > 0
                ORDER BY expiration_date IS NULL, expiration_date, id
                """,
                (row["id"],),
            ).fetchall()
            for lot in lots:
                if remaining <= 0:
                    break
                used = min(remaining, lot["quantity_milli"])
                connection.execute(
                    """
                    UPDATE item_lots
                    SET quantity_milli = quantity_milli - ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (used, lot["id"]),
                )
                remaining -= used
        elif delta_milli > 0:
            lot = connection.execute(
                """
                SELECT id FROM item_lots
                WHERE item_id = ? AND expiration_date IS NULL
                ORDER BY id DESC LIMIT 1
                """,
                (row["id"],),
            ).fetchone()
            if lot:
                connection.execute(
                    """
                    UPDATE item_lots
                    SET quantity_milli = quantity_milli + ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (delta_milli, lot["id"]),
                )
            elif connection.execute(
                "SELECT 1 FROM item_lots WHERE item_id = ? LIMIT 1", (row["id"],)
            ).fetchone():
                connection.execute(
                    """
                    INSERT INTO item_lots(public_id, item_id, quantity_milli, note)
                    VALUES (?, ?, ?, ?)
                    """,
                    (new_public_id("lot"), row["id"], delta_milli, "Manual quantity increase"),
                )
        cursor = connection.execute(
            """
            UPDATE items SET quantity_milli = ?, expiration_date = ?, version = version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND version = ?
            """,
            (
                new_quantity,
                _next_lot_expiration(connection, row["id"])
                if connection.execute(
                    "SELECT 1 FROM item_lots WHERE item_id = ? LIMIT 1", (row["id"],)
                ).fetchone()
                else row["expiration_date"],
                row["id"],
                expected_version,
            ),
        )
        if cursor.rowcount != 1:
            raise ConflictError("Item changed since it was opened; reload and try again")
        after = serialize_item(connection, get_item_row(connection, public_id))
        record_event(
            connection,
            row["id"],
            "adjust_quantity",
            before,
            after,
            quantity_delta_milli=delta_milli,
            source=source,
        )
        reindex_item(connection, row["id"])
    return serialize_item(connection, get_item_row(connection, public_id))


def move_item(
    connection: sqlite3.Connection,
    public_id: str,
    destination_public_id: str,
    expected_version: int,
    *,
    source: str = "manual",
) -> dict[str, Any]:
    return update_item(
        connection,
        public_id,
        {
            "location_public_id": destination_public_id,
            "expected_version": expected_version,
        },
        source=source,
    )


def archive_item(connection: sqlite3.Connection, public_id: str) -> None:
    row = get_item_row(connection, public_id)
    if row["archived_at"] is not None:
        return
    before = serialize_item(connection, row)
    with transaction(connection):
        connection.execute(
            """
            UPDATE items SET archived_at = CURRENT_TIMESTAMP, version = version + 1,
                updated_at = CURRENT_TIMESTAMP WHERE id = ?
            """,
            (row["id"],),
        )
        after = serialize_item(connection, get_item_row(connection, public_id))
        record_event(connection, row["id"], "archive", before, after)
        reindex_item(connection, row["id"])


def hard_delete_item(connection: sqlite3.Connection, public_id: str) -> None:
    row = get_item_row(connection, public_id)
    photo_paths = [
        photo["file_path"]
        for photo in connection.execute(
            "SELECT file_path FROM photos WHERE item_id = ?", (row["id"],)
        )
    ]
    with transaction(connection):
        connection.execute("DELETE FROM item_fts WHERE item_id = ?", (row["id"],))
        connection.execute("DELETE FROM inventory_events WHERE item_id = ?", (row["id"],))
        connection.execute("DELETE FROM loans WHERE item_id = ?", (row["id"],))
        cursor = connection.execute("DELETE FROM items WHERE id = ?", (row["id"],))
        if cursor.rowcount != 1:
            raise NotFoundError("Item not found")
    base = get_settings().data_dir.resolve()
    for relative in photo_paths:
        absolute = (base / relative).resolve()
        if base in absolute.parents:
            absolute.unlink(missing_ok=True)


def restore_item(connection: sqlite3.Connection, public_id: str) -> dict[str, Any]:
    row = get_item_row(connection, public_id)
    if row["archived_at"] is None:
        return serialize_item(connection, row)
    before = serialize_item(connection, row)
    with transaction(connection):
        connection.execute(
            """
            UPDATE items SET archived_at = NULL, version = version + 1,
                updated_at = CURRENT_TIMESTAMP WHERE id = ?
            """,
            (row["id"],),
        )
        after = serialize_item(connection, get_item_row(connection, public_id))
        record_event(connection, row["id"], "restore", before, after)
        reindex_item(connection, row["id"])
    return serialize_item(connection, get_item_row(connection, public_id))


def item_history(connection: sqlite3.Connection, public_id: str) -> list[dict[str, Any]]:
    item = get_item_row(connection, public_id)
    rows = connection.execute(
        """
        SELECT inventory_events.*, from_location.name AS from_location,
               to_location.name AS to_location
        FROM inventory_events
        LEFT JOIN locations AS from_location ON from_location.id = inventory_events.from_location_id
        LEFT JOIN locations AS to_location ON to_location.id = inventory_events.to_location_id
        WHERE item_id = ? ORDER BY inventory_events.id DESC
        """,
        (item["id"],),
    ).fetchall()
    return [
        {
            "public_id": row["public_id"],
            "action": row["action"],
            "quantity_delta": from_milli(row["quantity_delta_milli"]),
            "from_location": row["from_location"],
            "to_location": row["to_location"],
            "source": row["source"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def list_item_relationships(
    connection: sqlite3.Connection, item_public_id: str
) -> list[dict[str, Any]]:
    item = get_item_row(connection, item_public_id)
    rows = connection.execute(
        """
        SELECT item_relationships.public_id AS relationship_public_id,
               item_relationships.relation_type,
               item_relationships.note,
               item_relationships.created_at,
               related.public_id AS related_public_id
        FROM item_relationships
        JOIN items AS related
          ON related.id = CASE
            WHEN item_relationships.item_a_id = ? THEN item_relationships.item_b_id
            ELSE item_relationships.item_a_id
          END
        WHERE (item_relationships.item_a_id = ? OR item_relationships.item_b_id = ?)
          AND related.archived_at IS NULL
        ORDER BY item_relationships.created_at DESC, item_relationships.id DESC
        """,
        (item["id"], item["id"], item["id"]),
    ).fetchall()
    related: list[dict[str, Any]] = []
    for row in rows:
        serialized = get_item(connection, row["related_public_id"])
        serialized["relationship_public_id"] = row["relationship_public_id"]
        serialized["relationship_type"] = row["relation_type"]
        serialized["relationship_note"] = row["note"]
        serialized["relationship_created_at"] = row["created_at"]
        related.append(serialized)
    return related


def add_item_relationship(
    connection: sqlite3.Connection,
    item_public_id: str,
    related_public_id: str,
    relation_type: str = "related",
    note: str = "",
) -> dict[str, Any]:
    item = get_item_row(connection, item_public_id)
    related = get_item_row(connection, related_public_id)
    if item["id"] == related["id"]:
        raise ConflictError("An item cannot be related to itself")
    item_a_id, item_b_id = sorted((item["id"], related["id"]))
    relation_type = relation_type.strip() or "related"
    note = note.strip()
    existing = connection.execute(
        """
        SELECT public_id FROM item_relationships
        WHERE item_a_id = ? AND item_b_id = ? AND relation_type = ?
        """,
        (item_a_id, item_b_id, relation_type),
    ).fetchone()
    if existing:
        return next(
            entry
            for entry in list_item_relationships(connection, item_public_id)
            if entry["relationship_public_id"] == existing["public_id"]
        )
    public_id = new_public_id("rel")
    with transaction(connection):
        connection.execute(
            """
            INSERT INTO item_relationships(
                public_id, item_a_id, item_b_id, relation_type, note
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (public_id, item_a_id, item_b_id, relation_type, note),
        )
    return next(
        entry
        for entry in list_item_relationships(connection, item_public_id)
        if entry["relationship_public_id"] == public_id
    )


def delete_item_relationship(
    connection: sqlite3.Connection, item_public_id: str, relationship_public_id: str
) -> None:
    item = get_item_row(connection, item_public_id)
    with transaction(connection):
        cursor = connection.execute(
            """
            DELETE FROM item_relationships
            WHERE public_id = ? AND (item_a_id = ? OR item_b_id = ?)
            """,
            (relationship_public_id, item["id"], item["id"]),
        )
        if cursor.rowcount != 1:
            raise NotFoundError("Item relationship not found")


def _category_slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")


def _unique_category_slug(connection: sqlite3.Connection, base: str) -> str:
    slug = base
    suffix = 2
    while connection.execute("SELECT 1 FROM categories WHERE slug = ?", (slug,)).fetchone():
        slug = f"{base}-{suffix}"
        suffix += 1
    return slug


CATEGORY_DATA_FIELDS = (
    "expiration",
    "batches",
    "maintenance",
    "reservation",
    "enrichment",
    "photos",
    "identity",
    "specs",
    "price",
    "links",
    "shopping_list",
)


def _category_capability_defaults(category: dict[str, Any]) -> dict[str, bool]:
    searchable = " ".join(str(category.get(key, "")) for key in ("slug", "name", "path")).casefold()
    food_like = any(
        term in searchable
        for term in (
            "grocer",
            "food",
            "pantry",
            "fridge",
            "freezer",
            "beverage",
            "drink",
            "water",
            "consumable",
        )
    )
    durable_like = any(
        term in searchable for term in ("tool", "electronics", "machine", "appliance", "printer")
    )
    return {
        "expiration": food_like,
        "batches": food_like,
        "maintenance": durable_like and not food_like,
        "reservation": durable_like,
        "enrichment": food_like,
        "photos": True,
        "identity": True,
        "specs": durable_like and not food_like,
        "price": True,
        "links": True,
        "shopping_list": food_like,
    }


def _read_category_data_overrides(connection: sqlite3.Connection) -> dict[str, dict[str, bool]]:
    row = connection.execute(
        "SELECT value_json FROM app_settings WHERE key = 'category_data_capabilities'"
    ).fetchone()
    if row is None:
        return {}
    try:
        loaded = json.loads(row["value_json"])
    except json.JSONDecodeError:
        return {}
    if not isinstance(loaded, dict):
        return {}
    overrides: dict[str, dict[str, bool]] = {}
    for category_id, values in loaded.items():
        if not isinstance(values, dict):
            continue
        cleaned = {
            field: bool(values[field])
            for field in CATEGORY_DATA_FIELDS
            if field in values and isinstance(values[field], bool)
        }
        if cleaned:
            overrides[str(category_id)] = cleaned
    return overrides


def _resolve_category_capabilities(
    categories: list[dict[str, Any]],
    overrides: dict[str, dict[str, bool]],
) -> dict[int, dict[str, Any]]:
    by_id = {int(category["id"]): category for category in categories}
    resolved: dict[int, dict[str, Any]] = {}

    def resolve(category_id: int, seen: set[int] | None = None) -> dict[str, Any]:
        if category_id in resolved:
            return resolved[category_id]
        seen = seen or set()
        category = by_id[category_id]
        parent_id = category.get("parent_id")
        if parent_id in by_id and category_id not in seen:
            parent = resolve(int(parent_id), seen | {category_id})
            base = {field: bool(parent[field]) for field in CATEGORY_DATA_FIELDS}
            inherited_from = int(parent_id)
            inherited_label = by_id[int(parent_id)]["path"]
        else:
            base = _category_capability_defaults(category)
            inherited_from = None
            inherited_label = "category defaults"
        override = overrides.get(str(category_id), {})
        effective = {**base, **override}
        resolved[category_id] = {
            **effective,
            "override": bool(override),
            "inherited_from": inherited_from,
            "inherited_label": inherited_label,
        }
        return resolved[category_id]

    for category in categories:
        resolve(int(category["id"]))
    return resolved


def category_data_settings(connection: sqlite3.Connection) -> dict[str, Any]:
    categories = list_categories(connection)
    overrides = _read_category_data_overrides(connection)
    return {
        "fields": list(CATEGORY_DATA_FIELDS),
        "overrides": overrides,
        "resolved": {str(category["id"]): category["capabilities"] for category in categories},
    }


def save_category_data_settings(
    connection: sqlite3.Connection, overrides: dict[str, dict[str, bool]]
) -> dict[str, Any]:
    category_ids = {
        str(row["id"]) for row in connection.execute("SELECT id FROM categories").fetchall()
    }
    cleaned: dict[str, dict[str, bool]] = {}
    for category_id, values in overrides.items():
        if str(category_id) not in category_ids or not isinstance(values, dict):
            continue
        entry = {
            field: bool(values[field])
            for field in CATEGORY_DATA_FIELDS
            if field in values and isinstance(values[field], bool)
        }
        if entry:
            cleaned[str(category_id)] = entry
    with transaction(connection):
        connection.execute(
            """
            INSERT INTO app_settings(key, value_json)
            VALUES ('category_data_capabilities', ?)
            ON CONFLICT(key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (json.dumps(cleaned, separators=(",", ":")),),
        )
    return category_data_settings(connection)


def list_categories(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = [
        dict(row)
        for row in connection.execute(
            """
            SELECT id, parent_id, name, slug, sort_order, created_at
            FROM categories
            ORDER BY sort_order, name COLLATE NOCASE
            """
        )
    ]
    nodes = {row["id"]: {**row, "children": []} for row in rows}
    for node in nodes.values():
        parent = nodes.get(node["parent_id"])
        if parent:
            parent["children"].append(node["id"])
    direct_counts = {
        row["category_id"]: row["count"]
        for row in connection.execute(
            """
            SELECT category_id, count(*) AS count
            FROM items
            WHERE archived_at IS NULL AND category_id IS NOT NULL
            GROUP BY category_id
            """
        )
    }
    total_counts: dict[int, int] = {category_id: 0 for category_id in nodes}
    for category_id, count in direct_counts.items():
        current_id = category_id
        seen: set[int] = set()
        while current_id in nodes and current_id not in seen:
            seen.add(current_id)
            total_counts[current_id] += count
            current_id = nodes[current_id]["parent_id"]

    def path_for(category_id: int, seen: set[int] | None = None) -> str:
        seen = seen or set()
        node = nodes[category_id]
        if node["parent_id"] not in nodes or category_id in seen:
            return node["name"]
        return f"{path_for(node['parent_id'], seen | {category_id})} > {node['name']}"

    categories = []
    for category_id, node in nodes.items():
        path = path_for(category_id)
        categories.append(
            {
                "id": node["id"],
                "parent_id": node["parent_id"],
                "name": node["name"],
                "slug": node["slug"],
                "path": path,
                "depth": max(0, path.count(" > ")),
                "sort_order": node["sort_order"],
                "item_count": direct_counts.get(category_id, 0),
                "total_item_count": total_counts.get(category_id, 0),
            }
        )
    categories = sorted(categories, key=lambda category: category["path"].casefold())
    category_rules = [
        dict(row)
        for row in connection.execute(
            """
            SELECT location_rules.match_value, location_rules.priority,
                   locations.public_id, locations.name
            FROM location_rules
            JOIN locations ON locations.id = location_rules.location_id
            WHERE location_rules.enabled = 1
              AND location_rules.rule_type = 'category'
              AND locations.archived_at IS NULL
            ORDER BY location_rules.priority DESC, location_rules.id
            """
        )
    ]
    capabilities = _resolve_category_capabilities(
        categories,
        _read_category_data_overrides(connection),
    )
    for category in categories:
        category["capabilities"] = capabilities[int(category["id"])]
        matching_rules = [
            rule
            for rule in category_rules
            if _category_default_rule_matches(str(rule["match_value"]), category)
        ]
        default_rule = max(
            matching_rules,
            key=lambda rule: (
                _category_rule_granularity(str(rule["match_value"]), category),
                int(rule.get("priority", 0)),
            ),
            default=None,
        )
        category["default_location"] = (
            {
                "public_id": default_rule["public_id"],
                "name": default_rule["name"],
            }
            if default_rule
            else None
        )
    return categories


def _category_default_rule_matches(match_value: str, category: dict[str, Any]) -> bool:
    match = match_value.strip().casefold()
    if not match:
        return False
    path = str(category["path"]).casefold()
    name = str(category["name"]).casefold()
    slug = str(category["slug"]).casefold()
    if match in {path, name, slug}:
        return True
    return path.startswith(f"{match} > ")


def _category_rule_granularity(match_value: str, category: dict[str, Any]) -> int:
    match = match_value.strip().casefold()
    parts = str(category["path"]).casefold().split(" > ")
    if " > " in match:
        return match.count(" > ") + 1
    return parts.index(match) + 1 if match in parts else 0


def find_category_id(connection: sqlite3.Connection, label: str) -> int | None:
    normalized = label.strip().casefold()
    if not normalized:
        return None
    categories = list_categories(connection)
    name_matches = [
        category for category in categories if category["name"].casefold() == normalized
    ]
    if " > " not in normalized:
        if len(name_matches) == 1:
            return int(name_matches[0]["id"])
        if len(name_matches) > 1:
            raise ConflictError(f"Category name is ambiguous: {label}; use the full path or id")
        return None
    path_matches = [
        category for category in categories if category["path"].casefold() == normalized
    ]
    if len(path_matches) == 1:
        return int(path_matches[0]["id"])
    return None


def create_category(
    connection: sqlite3.Connection, name: str, parent_id: int | None = None
) -> dict[str, Any]:
    normalized_name = name.strip()
    base_slug = _category_slug(normalized_name)
    if not base_slug:
        raise ConflictError("Category name must contain letters or numbers")
    parent = get_category_row(connection, parent_id) if parent_id is not None else None
    if parent_id is None:
        sibling = connection.execute(
            """
            SELECT 1 FROM categories
            WHERE parent_id IS NULL AND name = ? COLLATE NOCASE
            """,
            (normalized_name,),
        ).fetchone()
    else:
        sibling = connection.execute(
            """
            SELECT 1 FROM categories
            WHERE parent_id = ? AND name = ? COLLATE NOCASE
            """,
            (parent_id, normalized_name),
        ).fetchone()
    if sibling:
        raise ConflictError("A category with that name already exists here")
    slug_base = f"{parent['slug']}-{base_slug}" if parent else base_slug
    slug = _unique_category_slug(connection, slug_base)
    try:
        with transaction(connection):
            sort_order = connection.execute(
                """
                SELECT COALESCE(max(sort_order), 0) + 10 FROM categories
                WHERE (parent_id IS NULL AND ? IS NULL) OR parent_id = ?
                """,
                (parent_id, parent_id),
            ).fetchone()[0]
            cursor = connection.execute(
                """
                INSERT INTO categories(parent_id, name, slug, sort_order)
                VALUES (?, ?, ?, ?)
                """,
                (parent_id, normalized_name, slug, sort_order),
            )
            rebuild_search_index(connection)
    except sqlite3.IntegrityError as exc:
        raise ConflictError("Category already exists") from exc
    return next(
        category for category in list_categories(connection) if category["id"] == cursor.lastrowid
    )


def update_category(
    connection: sqlite3.Connection, category_id: int, changes: dict[str, Any]
) -> dict[str, Any]:
    row = get_category_row(connection, category_id)
    previous_paths = {
        category["id"]: category["path"]
        for category in list_categories(connection)
        if category["id"] in category_descendant_ids(connection, row["id"])
    }
    assignments: list[str] = []
    parameters: list[Any] = []
    next_name = row["name"]
    next_parent_id = row["parent_id"]
    if "name" in changes and changes["name"] is not None:
        next_name = changes["name"].strip()
        if not _category_slug(next_name):
            raise ConflictError("Category name must contain letters or numbers")
        assignments.append("name = ?")
        parameters.append(next_name)
    if "parent_id" in changes:
        next_parent_id = changes["parent_id"]
        if next_parent_id == row["id"]:
            raise ConflictError("A category cannot be moved inside itself")
        if next_parent_id is not None:
            get_category_row(connection, int(next_parent_id))
            if int(next_parent_id) in category_descendant_ids(connection, row["id"]):
                raise ConflictError("A category cannot be moved inside itself")
        assignments.append("parent_id = ?")
        parameters.append(next_parent_id)
    if not assignments:
        return next(
            category for category in list_categories(connection) if category["id"] == row["id"]
        )

    if next_parent_id is None:
        sibling = connection.execute(
            """
            SELECT 1 FROM categories
            WHERE parent_id IS NULL AND id != ? AND name = ? COLLATE NOCASE
            """,
            (row["id"], next_name),
        ).fetchone()
    else:
        sibling = connection.execute(
            """
            SELECT 1 FROM categories
            WHERE parent_id = ? AND id != ? AND name = ? COLLATE NOCASE
            """,
            (next_parent_id, row["id"], next_name),
        ).fetchone()
    if sibling:
        raise ConflictError("A category with that name already exists here")

    parameters.append(row["id"])
    try:
        with transaction(connection):
            connection.execute(
                f"UPDATE categories SET {', '.join(assignments)} WHERE id = ?", parameters
            )
            next_paths = {
                category["id"]: category["path"]
                for category in list_categories(connection)
                if category["id"] in previous_paths
            }
            for changed_id, previous_path in previous_paths.items():
                next_path = next_paths.get(changed_id)
                if next_path and next_path != previous_path:
                    connection.execute(
                        """
                        UPDATE location_rules
                        SET match_value = ?
                        WHERE rule_type = 'category' AND match_value = ?
                        """,
                        (next_path, previous_path),
                    )
            rebuild_search_index(connection)
    except sqlite3.IntegrityError as exc:
        raise ConflictError("Category already exists") from exc
    return next(category for category in list_categories(connection) if category["id"] == row["id"])


def delete_category(connection: sqlite3.Connection, category_id: int) -> None:
    row = get_category_row(connection, category_id)
    has_children = connection.execute(
        "SELECT 1 FROM categories WHERE parent_id = ?", (row["id"],)
    ).fetchone()
    if has_children:
        raise ConflictError("Move or delete subcategories before deleting this category")
    has_items = connection.execute(
        "SELECT 1 FROM items WHERE category_id = ? AND archived_at IS NULL", (row["id"],)
    ).fetchone()
    if has_items:
        raise ConflictError("Move items out of this category before deleting it")
    with transaction(connection):
        connection.execute("DELETE FROM categories WHERE id = ?", (row["id"],))


def delete_category_tree(connection: sqlite3.Connection, category_id: int) -> None:
    row = get_category_row(connection, category_id)
    category_ids = category_descendant_ids(connection, row["id"])
    categories = list_categories(connection)
    category_paths = {
        category["id"]: category["path"]
        for category in categories
        if category["id"] in category_ids
    }
    placeholders = ", ".join("?" for _ in category_ids)
    with transaction(connection):
        connection.execute(
            f"""
            UPDATE items
            SET category_id = NULL,
                version = version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE category_id IN ({placeholders})
            """,
            tuple(category_ids),
        )
        if category_paths:
            path_placeholders = ", ".join("?" for _ in category_paths)
            connection.execute(
                f"""
                DELETE FROM location_rules
                WHERE rule_type = 'category' AND match_value IN ({path_placeholders})
                """,
                tuple(category_paths.values()),
            )
        existing_overrides = _read_category_data_overrides(connection)
        for removed_id in category_ids:
            existing_overrides.pop(str(removed_id), None)
        connection.execute(
            """
            INSERT INTO app_settings(key, value_json)
            VALUES ('category_data_capabilities', ?)
            ON CONFLICT(key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (json.dumps(existing_overrides, separators=(",", ":")),),
        )
        delete_order = sorted(
            (category for category in categories if category["id"] in category_ids),
            key=lambda category: category["depth"],
            reverse=True,
        )
        for category in delete_order:
            connection.execute("DELETE FROM categories WHERE id = ?", (category["id"],))
        rebuild_search_index(connection)


def category_contents(
    connection: sqlite3.Connection, category_id: int, *, recursive: bool = True
) -> dict[str, Any]:
    get_category_row(connection, category_id)
    categories = list_categories(connection)
    category = next(entry for entry in categories if entry["id"] == category_id)
    category_ids = category_descendant_ids(connection, category_id) if recursive else [category_id]
    placeholders = ", ".join("?" for _ in category_ids)
    item_rows = connection.execute(
        f"{ITEM_SELECT} WHERE items.archived_at IS NULL "
        f"AND items.category_id IN ({placeholders}) "
        "ORDER BY items.category_id = ? DESC, items.name COLLATE NOCASE",
        (*category_ids, category_id),
    ).fetchall()
    return {
        "category": category,
        "children": [entry for entry in categories if entry["parent_id"] == category_id],
        "items": serialize_item_rows(connection, item_rows),
        "recursive": recursive,
    }


def set_category_default_location(
    connection: sqlite3.Connection, category_id: int, location_public_id: str | None
) -> dict[str, Any]:
    category = next(entry for entry in list_categories(connection) if entry["id"] == category_id)
    location_id = None
    if location_public_id:
        location_id = get_location_row(connection, location_public_id)["id"]
    priority = 1000 + int(category["depth"])
    with transaction(connection):
        connection.execute(
            """
            DELETE FROM location_rules
            WHERE rule_type = 'category' AND match_value = ?
            """,
            (category["path"],),
        )
        if location_id is not None:
            connection.execute(
                """
                INSERT INTO location_rules(
                    public_id, rule_type, match_value, location_id, priority, enabled
                )
                VALUES (?, 'category', ?, ?, ?, 1)
                """,
                (new_public_id("rule"), category["path"], location_id, priority),
            )
    return category_contents(connection, category_id)["category"]


def ensure_product(
    connection: sqlite3.Connection, barcode: str, name: str = "", brand: str = ""
) -> int:
    existing = connection.execute(
        "SELECT id FROM products WHERE barcode = ?", (barcode,)
    ).fetchone()
    if existing:
        return int(existing["id"])
    cursor = connection.execute(
        """
        INSERT INTO products(barcode, name, brand, source)
        VALUES (?, ?, ?, 'Manual')
        """,
        (barcode, name, brand),
    )
    return int(cursor.lastrowid)


def list_location_types(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    return [
        dict(row)
        for row in connection.execute(
            """
            SELECT name, icon, sort_order FROM location_types
            ORDER BY sort_order, name COLLATE NOCASE
            """
        )
    ]


def ensure_location_type(
    connection: sqlite3.Connection, name: str, icon: str = "pin"
) -> dict[str, Any]:
    normalized = name.strip().casefold()
    if not normalized:
        raise ConflictError("Location type cannot be empty")
    existing = connection.execute(
        "SELECT name, icon, sort_order FROM location_types WHERE name = ? COLLATE NOCASE",
        (normalized,),
    ).fetchone()
    if existing:
        return dict(existing)
    with transaction(connection):
        sort_order = connection.execute(
            "SELECT COALESCE(max(sort_order), 0) + 10 FROM location_types"
        ).fetchone()[0]
        connection.execute(
            "INSERT INTO location_types(name, icon, sort_order) VALUES (?, ?, ?)",
            (normalized, icon, sort_order),
        )
    return {"name": normalized, "icon": icon, "sort_order": sort_order}


def location_contents(
    connection: sqlite3.Connection, public_id: str, *, recursive: bool = True
) -> dict[str, Any]:
    location = get_location_row(connection, public_id)
    if recursive:
        location_ids = [
            row["id"]
            for row in connection.execute(
                """
                WITH RECURSIVE descendants(id) AS (
                    SELECT id FROM locations WHERE id = ?
                    UNION ALL
                    SELECT locations.id FROM locations
                    JOIN descendants ON locations.parent_id = descendants.id
                    WHERE locations.archived_at IS NULL
                )
                SELECT id FROM descendants
                """,
                (location["id"],),
            )
        ]
    else:
        location_ids = [location["id"]]
    placeholders = ", ".join("?" for _ in location_ids)
    item_rows = connection.execute(
        f"{ITEM_SELECT} WHERE items.archived_at IS NULL "
        f"AND items.location_id IN ({placeholders}) "
        "ORDER BY items.location_id = ? DESC, items.name COLLATE NOCASE",
        (*location_ids, location["id"]),
    ).fetchall()
    items = serialize_item_rows(connection, item_rows)
    children = [
        serialize_location(connection, child)
        for child in connection.execute(
            """
            SELECT * FROM locations WHERE parent_id = ? AND archived_at IS NULL
            ORDER BY sort_order, name COLLATE NOCASE
            """,
            (location["id"],),
        )
    ]
    return {
        "location": serialize_location(connection, location),
        "children": children,
        "items": items,
        "recursive": recursive,
    }


def list_location_rules(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    return [
        dict(row)
        for row in connection.execute(
            """
            SELECT location_rules.public_id, location_rules.rule_type,
                   location_rules.match_value, location_rules.priority,
                   location_rules.enabled, locations.public_id AS location_public_id,
                   locations.name AS location_name
            FROM location_rules
            JOIN locations ON locations.id = location_rules.location_id
            ORDER BY location_rules.priority DESC, location_rules.id
            """
        )
    ]


def serialize_location_rule(connection: sqlite3.Connection, public_id: str) -> dict[str, Any]:
    row = connection.execute(
        """
        SELECT location_rules.public_id, location_rules.rule_type,
               location_rules.match_value, location_rules.priority,
               location_rules.enabled, locations.public_id AS location_public_id,
               locations.name AS location_name
        FROM location_rules
        JOIN locations ON locations.id = location_rules.location_id
        WHERE location_rules.public_id = ?
        """,
        (public_id,),
    ).fetchone()
    if row is None:
        raise NotFoundError("Location rule not found")
    return dict(row)


def sync_barcode_rule_default_location(
    connection: sqlite3.Connection, rule_type: str, match_value: str, location_id: int
) -> None:
    if rule_type != "barcode":
        return
    product = connection.execute(
        "SELECT id FROM products WHERE barcode = ?", (match_value,)
    ).fetchone()
    if product:
        connection.execute(
            "UPDATE products SET default_location_id = ? WHERE id = ?",
            (location_id, product["id"]),
        )


def create_location_rule(connection: sqlite3.Connection, values: dict[str, Any]) -> dict[str, Any]:
    location = get_location_row(connection, values["location_public_id"])
    public_id = new_public_id("rule")
    with transaction(connection):
        connection.execute(
            """
            INSERT INTO location_rules(
                public_id, rule_type, match_value, location_id, priority, enabled
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                public_id,
                values.get("rule_type", "name"),
                values["match_value"],
                location["id"],
                values.get("priority", 100),
                1 if values.get("enabled", True) else 0,
            ),
        )
        sync_barcode_rule_default_location(
            connection, values.get("rule_type", "name"), values["match_value"], location["id"]
        )
    return serialize_location_rule(connection, public_id)


def update_location_rule(
    connection: sqlite3.Connection, public_id: str, values: dict[str, Any]
) -> dict[str, Any]:
    existing = connection.execute(
        "SELECT * FROM location_rules WHERE public_id = ?", (public_id,)
    ).fetchone()
    if existing is None:
        raise NotFoundError("Location rule not found")
    location_id = existing["location_id"]
    if values.get("location_public_id") is not None:
        location_id = get_location_row(connection, values["location_public_id"])["id"]
    rule_type = values.get("rule_type") or existing["rule_type"]
    match_value = values.get("match_value") or existing["match_value"]
    priority = (
        values.get("priority") if values.get("priority") is not None else existing["priority"]
    )
    enabled = (
        values.get("enabled") if values.get("enabled") is not None else bool(existing["enabled"])
    )
    with transaction(connection):
        connection.execute(
            """
            UPDATE location_rules
            SET rule_type = ?, match_value = ?, location_id = ?, priority = ?, enabled = ?
            WHERE public_id = ?
            """,
            (rule_type, match_value, location_id, priority, 1 if enabled else 0, public_id),
        )
        sync_barcode_rule_default_location(connection, rule_type, match_value, location_id)
    return serialize_location_rule(connection, public_id)


def set_item_default_location(
    connection: sqlite3.Connection, item_public_id: str, location_public_id: str
) -> dict[str, Any]:
    item = get_item_row(connection, item_public_id)
    location = get_location_row(connection, location_public_id)
    barcode = item["barcode"] or item["barcode_override"]
    rule_type = "barcode" if barcode else "name"
    match_value = barcode if barcode else item["name"]
    existing = connection.execute(
        """
        SELECT public_id FROM location_rules
        WHERE rule_type = ? AND match_value = ? COLLATE NOCASE
        ORDER BY priority DESC, id LIMIT 1
        """,
        (rule_type, match_value),
    ).fetchone()
    if existing:
        with transaction(connection):
            connection.execute(
                """
                UPDATE location_rules SET location_id = ?, enabled = 1, priority = 500
                WHERE public_id = ?
                """,
                (location["id"], existing["public_id"]),
            )
    else:
        create_location_rule(
            connection,
            {
                "rule_type": rule_type,
                "match_value": match_value,
                "location_public_id": location_public_id,
                "priority": 500,
                "enabled": True,
            },
        )
    if barcode:
        product = connection.execute(
            "SELECT id FROM products WHERE barcode = ?", (barcode,)
        ).fetchone()
        if product:
            with transaction(connection):
                connection.execute(
                    "UPDATE products SET default_location_id = ? WHERE id = ?",
                    (location["id"], product["id"]),
                )
    suggestion = suggest_default_location(
        connection,
        name=item["name"],
        barcode=barcode,
        category=(
            serialize_item(connection, item).get("category_path") or item["category_name"] or ""
        ),
    )
    return {"item": serialize_item(connection, item), "suggestion": suggestion}


def delete_location_rule(connection: sqlite3.Connection, public_id: str) -> None:
    with transaction(connection):
        connection.execute("DELETE FROM location_rules WHERE public_id = ?", (public_id,))


def suggest_default_location(
    connection: sqlite3.Connection,
    *,
    name: str = "",
    barcode: str = "",
    category: str = "",
) -> dict[str, Any] | None:
    product = None
    if barcode:
        product = connection.execute(
            """
            SELECT locations.public_id, locations.name
            FROM products JOIN locations ON locations.id = products.default_location_id
            WHERE products.barcode = ? AND locations.archived_at IS NULL
            """,
            (barcode,),
        ).fetchone()
        if product:
            return {
                "public_id": product["public_id"],
                "name": product["name"],
                "reason": "Product default location",
            }
    normalized_name = name.strip().casefold()
    normalized_barcode = barcode.strip().casefold()
    normalized_category = category.strip().casefold()
    rules = connection.execute(
        """
        SELECT location_rules.rule_type, location_rules.match_value,
               location_rules.priority, location_rules.id,
               locations.public_id, locations.name
        FROM location_rules JOIN locations ON locations.id = location_rules.location_id
        WHERE location_rules.enabled = 1 AND locations.archived_at IS NULL
        """
    ).fetchall()
    matches: list[tuple[tuple[int, int, int, int], sqlite3.Row]] = []
    for rule in rules:
        match = rule["match_value"].strip().casefold()
        if not match:
            continue
        specificity = 0
        granularity = 0
        if rule["rule_type"] == "barcode":
            if normalized_barcode and match == normalized_barcode:
                specificity = 400
        elif rule["rule_type"] == "name":
            if normalized_name and match in normalized_name:
                specificity = 300
                granularity = len(match)
        elif rule["rule_type"] == "category" and normalized_category:
            if normalized_category == match or normalized_category.startswith(f"{match} > "):
                specificity = 200
                granularity = match.count(" > ") + 1
            elif " > " not in match and match in normalized_category.split(" > "):
                specificity = 200
                granularity = normalized_category.split(" > ").index(match) + 1
        if specificity:
            matches.append(
                (
                    (specificity, granularity, int(rule["priority"]), -int(rule["id"])),
                    rule,
                )
            )
    if matches:
        _, rule = max(matches, key=lambda entry: entry[0])
        return {
            "public_id": rule["public_id"],
            "name": rule["name"],
            "reason": f"{rule['rule_type'].title()} rule matched '{rule['match_value']}'",
        }
    return None


def set_item_tags(
    connection: sqlite3.Connection,
    public_id: str,
    tags: list[str],
    expected_version: int,
) -> dict[str, Any]:
    item = get_item_row(connection, public_id)
    if item["version"] != expected_version:
        raise ConflictError("Item changed since it was opened; reload and try again")
    normalized = sorted({tag.strip() for tag in tags if tag.strip()}, key=str.casefold)[:50]
    before = serialize_item(connection, item)
    with transaction(connection):
        connection.execute("DELETE FROM item_tags WHERE item_id = ?", (item["id"],))
        for tag in normalized:
            connection.execute("INSERT OR IGNORE INTO tags(name) VALUES (?)", (tag,))
            tag_id = connection.execute(
                "SELECT id FROM tags WHERE name = ? COLLATE NOCASE", (tag,)
            ).fetchone()["id"]
            connection.execute(
                "INSERT INTO item_tags(item_id, tag_id) VALUES (?, ?)", (item["id"], tag_id)
            )
        connection.execute(
            "UPDATE items SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (item["id"],),
        )
        after = serialize_item(connection, get_item_row(connection, public_id))
        record_event(connection, item["id"], "update_tags", before, after)
        reindex_item(connection, item["id"])
    return serialize_item(connection, get_item_row(connection, public_id))


def dashboard(connection: sqlite3.Connection) -> dict[str, Any]:
    today = date.today()
    horizon = today + timedelta(days=14)
    counts = connection.execute(
        """
        SELECT count(*) AS item_count,
               COALESCE(sum(CASE WHEN low_stock_milli IS NOT NULL
                                      AND quantity_milli <= low_stock_milli
                                 THEN 1 ELSE 0 END), 0) AS low_stock_count,
               COALESCE(sum(CASE WHEN (
                    (expiration_date IS NOT NULL AND expiration_date <= ?)
                    OR EXISTS (
                        SELECT 1 FROM item_lots
                        WHERE item_lots.item_id = items.id
                          AND item_lots.quantity_milli > 0
                          AND item_lots.expiration_date IS NOT NULL
                          AND item_lots.expiration_date <= ?
                    )
                ) THEN 1 ELSE 0 END), 0) AS expiring_count,
               COALESCE(sum(CASE WHEN locations.public_id = 'unassigned'
                                 THEN 1 ELSE 0 END), 0) AS needs_details_count
        FROM items
        JOIN locations ON locations.id = items.location_id
        WHERE items.archived_at IS NULL
        """,
        (horizon.isoformat(), horizon.isoformat()),
    ).fetchone()
    recent = connection.execute(
        """
        SELECT inventory_events.action, inventory_events.created_at,
               items.public_id AS item_public_id, items.name AS item_name
        FROM inventory_events JOIN items ON items.id = inventory_events.item_id
        ORDER BY inventory_events.id DESC LIMIT 10
        """
    ).fetchall()
    return {
        "item_count": counts["item_count"],
        "location_count": connection.execute(
            "SELECT count(*) FROM locations WHERE archived_at IS NULL"
        ).fetchone()[0],
        "low_stock_count": counts["low_stock_count"],
        "expiring_count": counts["expiring_count"],
        "needs_details_count": counts["needs_details_count"],
        "recent_events": [dict(row) for row in recent],
    }


def analytics(connection: sqlite3.Connection, days: int = 90) -> dict[str, Any]:
    safe_days = max(7, min(int(days), 3650))
    item_rows = connection.execute(
        ITEM_SELECT + " WHERE items.archived_at IS NULL ORDER BY items.id"
    ).fetchall()
    items = serialize_item_rows(connection, item_rows)
    archived_count = connection.execute(
        "SELECT count(*) FROM items WHERE archived_at IS NOT NULL"
    ).fetchone()[0]
    today = date.today()
    expiration_week = today + timedelta(days=7)
    expiration_horizon = today + timedelta(days=30)
    expiration_quarter = today + timedelta(days=90)
    category_counts: dict[tuple[int | None, str], int] = defaultdict(int)
    location_counts: dict[tuple[str, str], int] = defaultdict(int)
    values: dict[str, dict[str, int]] = defaultdict(
        lambda: {"purchase_minor": 0, "estimated_minor": 0}
    )
    low_stock = 0
    zero_stock = 0
    expired = 0
    expiring_week = 0
    expiring = 0
    unassigned = 0
    missing_photo = 0
    missing_category = 0
    priced_items = 0
    stock_counts = {"In stock": 0, "Low": 0, "Empty": 0}
    age_counts = {
        "Added this month": 0,
        "1–3 months": 0,
        "3–12 months": 0,
        "Older": 0,
    }
    completeness_counts = {
        "location": 0,
        "category": 0,
        "photo": 0,
        "details": 0,
    }
    expiration_counts = {
        "Expired": 0,
        "Next 7 days": 0,
        "8–30 days": 0,
        "31–90 days": 0,
        "Later": 0,
        "No expiry": 0,
    }
    for item in items:
        category_counts[
            (item.get("category_id"), item.get("category_path") or "Uncategorised")
        ] += 1
        location_counts[
            (
                str(item.get("location_public_id") or "unassigned"),
                item.get("location_path") or "Unassigned",
            )
        ] += 1
        if item.get("location_public_id") == "unassigned":
            unassigned += 1
        else:
            completeness_counts["location"] += 1
        if item.get("category_id") is None:
            missing_category += 1
        else:
            completeness_counts["category"] += 1
        quantity = Decimal(str(item.get("quantity") or "0"))
        if quantity <= 0:
            zero_stock += 1
            stock_counts["Empty"] += 1
        elif item.get("low_stock_threshold") is not None and quantity <= Decimal(
            str(item["low_stock_threshold"])
        ):
            stock_counts["Low"] += 1
        else:
            stock_counts["In stock"] += 1
        if item.get("low_stock_threshold") is not None and Decimal(
            str(item["quantity"])
        ) <= Decimal(str(item["low_stock_threshold"])):
            low_stock += 1
        expiration_date = item.get("expiration_date")
        if not expiration_date:
            expiration_counts["No expiry"] += 1
        elif expiration_date < today.isoformat():
            expired += 1
            expiration_counts["Expired"] += 1
        elif expiration_date <= expiration_week.isoformat():
            expiring_week += 1
            expiring += 1
            expiration_counts["Next 7 days"] += 1
        elif expiration_date <= expiration_horizon.isoformat():
            expiring += 1
            expiration_counts["8–30 days"] += 1
        elif expiration_date <= expiration_quarter.isoformat():
            expiration_counts["31–90 days"] += 1
        else:
            expiration_counts["Later"] += 1
        if item.get("primary_photo_url"):
            completeness_counts["photo"] += 1
        else:
            missing_photo += 1
        if item.get("description") or item.get("notes"):
            completeness_counts["details"] += 1
        if item.get("purchase_price_minor") is not None or item.get(
            "estimated_price_minor"
        ) is not None:
            priced_items += 1
        created_on = date.fromisoformat(str(item["created_at"])[:10])
        age_days = (today - created_on).days
        if age_days <= 30:
            age_counts["Added this month"] += 1
        elif age_days <= 90:
            age_counts["1–3 months"] += 1
        elif age_days <= 365:
            age_counts["3–12 months"] += 1
        else:
            age_counts["Older"] += 1
        purchase_currency = item.get("purchase_currency")
        if purchase_currency and item.get("purchase_price_minor") is not None:
            values[str(purchase_currency)]["purchase_minor"] += int(
                Decimal(int(item["purchase_price_minor"])) * quantity
            )
        estimated_currency = item.get("estimated_price_currency")
        if estimated_currency and item.get("estimated_price_minor") is not None:
            values[str(estimated_currency)]["estimated_minor"] += int(
                Decimal(int(item["estimated_price_minor"])) * quantity
            )

    start = today - timedelta(days=safe_days - 1)
    activity_rows = connection.execute(
        """
        SELECT date(created_at) AS day,
               count(*) AS changes,
               sum(CASE WHEN action = 'create' THEN 1 ELSE 0 END) AS created,
               sum(CASE WHEN quantity_delta_milli > 0 AND action != 'create'
                        THEN 1 ELSE 0 END) AS quantity_in,
               sum(CASE WHEN quantity_delta_milli < 0 THEN 1 ELSE 0 END) AS quantity_out,
               sum(CASE WHEN action = 'move' THEN 1 ELSE 0 END) AS moved
        FROM inventory_events
        WHERE date(created_at) >= ?
        GROUP BY date(created_at)
        ORDER BY day
        """,
        (start.isoformat(),),
    ).fetchall()
    activity_by_day = {row["day"]: row for row in activity_rows}
    activity = [
        {
            "date": (start + timedelta(days=offset)).isoformat(),
            **{
                key: int(activity_by_day[day][key] or 0) if day in activity_by_day else 0
                for key in ("changes", "created", "quantity_in", "quantity_out", "moved")
            },
        }
        for offset in range(safe_days)
        for day in [(start + timedelta(days=offset)).isoformat()]
    ]
    current_events = sum(entry["changes"] for entry in activity)
    active_days = sum(1 for entry in activity if entry["changes"])
    prior_start = start - timedelta(days=safe_days)
    prior_events = int(
        connection.execute(
            """
            SELECT count(*) FROM inventory_events
            WHERE date(created_at) >= ? AND date(created_at) < ?
            """,
            (prior_start.isoformat(), start.isoformat()),
        ).fetchone()[0]
    )
    busiest = max(activity, key=lambda entry: entry["changes"], default=None)
    action_mix_rows = connection.execute(
        """
        SELECT CASE
                 WHEN action = 'create' THEN 'created'
                 WHEN quantity_delta_milli > 0 THEN 'stock_in'
                 WHEN quantity_delta_milli < 0 THEN 'consumed'
                 WHEN action = 'move' THEN 'moved'
                 ELSE 'other'
               END AS action_group,
               count(*) AS event_count
        FROM inventory_events
        WHERE date(created_at) >= ?
        GROUP BY action_group
        ORDER BY event_count DESC, action_group
        """,
        (start.isoformat(),),
    ).fetchall()
    action_labels = {
        "created": "Items created",
        "stock_in": "Stock added",
        "consumed": "Stock removed",
        "moved": "Items moved",
        "other": "Other edits",
    }
    source_rows = connection.execute(
        """
        SELECT source, count(*) AS event_count
        FROM inventory_events
        WHERE date(created_at) >= ?
        GROUP BY source
        ORDER BY event_count DESC, source COLLATE NOCASE
        LIMIT 8
        """,
        (start.isoformat(),),
    ).fetchall()
    source_names = [str(row["source"] or "unknown") for row in source_rows]
    source_activity: list[dict[str, Any]] = []
    if source_names:
        source_placeholders = ", ".join("?" for _ in source_names)
        source_activity = [
            {
                "date": row["day"],
                "source": row["source"] or "unknown",
                "changes": int(row["event_count"]),
            }
            for row in connection.execute(
                f"""
                SELECT date(created_at) AS day, COALESCE(source, 'unknown') AS source,
                       count(*) AS event_count
                FROM inventory_events
                WHERE date(created_at) >= ?
                  AND COALESCE(source, 'unknown') IN ({source_placeholders})
                GROUP BY day, COALESCE(source, 'unknown')
                ORDER BY day, source
                """,
                (start.isoformat(), *source_names),
            )
        ]
    consumed = connection.execute(
        """
        SELECT items.public_id, items.name, items.unit,
               -sum(inventory_events.quantity_delta_milli) AS consumed_milli
        FROM inventory_events
        JOIN items ON items.id = inventory_events.item_id
        WHERE inventory_events.quantity_delta_milli < 0
          AND date(inventory_events.created_at) >= ?
        GROUP BY items.id
        ORDER BY consumed_milli DESC, items.name COLLATE NOCASE
        LIMIT 8
        """,
        (start.isoformat(),),
    ).fetchall()
    changed = connection.execute(
        """
        SELECT items.public_id, items.name, count(*) AS event_count,
               max(inventory_events.created_at) AS last_changed_at
        FROM inventory_events
        JOIN items ON items.id = inventory_events.item_id
        WHERE date(inventory_events.created_at) >= ?
        GROUP BY items.id
        ORDER BY event_count DESC, last_changed_at DESC, items.name COLLATE NOCASE
        LIMIT 8
        """,
        (start.isoformat(),),
    ).fetchall()
    item_count = len(items)
    completeness = [
        {
            "key": key,
            "label": label,
            "complete": completeness_counts[key],
            "total": item_count,
            "percent": round(completeness_counts[key] / item_count * 100)
            if item_count
            else 100,
        }
        for key, label in (
            ("location", "Assigned to a place"),
            ("category", "Categorised"),
            ("photo", "Has a photo"),
            ("details", "Has notes or description"),
        )
    ]
    health_score = (
        round(sum(entry["percent"] for entry in completeness) / len(completeness))
        if completeness
        else 100
    )
    return {
        "generated_at": datetime.now(UTC).replace(microsecond=0).isoformat(),
        "days": safe_days,
        "summary": {
            "active_items": item_count,
            "archived_items": int(archived_count),
            "locations": connection.execute(
                "SELECT count(*) FROM locations WHERE archived_at IS NULL"
            ).fetchone()[0],
            "categories": connection.execute("SELECT count(*) FROM categories").fetchone()[0],
            "low_stock": low_stock,
            "zero_stock": zero_stock,
            "expired": expired,
            "expiring_7_days": expiring_week,
            "expiring_30_days": expiring,
            "unassigned": unassigned,
            "missing_category": missing_category,
            "missing_photo": missing_photo,
            "missing_details": item_count - completeness_counts["details"],
            "priced_items": priced_items,
            "health_score": health_score,
        },
        "activity_summary": {
            "current_events": current_events,
            "prior_events": prior_events,
            "percent_change": round((current_events - prior_events) / prior_events * 100)
            if prior_events
            else None,
            "active_days": active_days,
            "average_daily": round(current_events / safe_days, 1),
            "busiest_day": busiest["date"] if busiest and busiest["changes"] else None,
            "busiest_day_events": busiest["changes"] if busiest else 0,
        },
        "values": [
            {"currency": currency, **totals}
            for currency, totals in sorted(values.items())
        ],
        "categories": [
            {"category_id": category_id, "label": label, "item_count": count}
            for (category_id, label), count in sorted(
                category_counts.items(),
                key=lambda entry: (-entry[1], entry[0][1].casefold()),
            )[:10]
        ],
        "locations": [
            {
                "location_public_id": location_public_id,
                "label": label,
                "item_count": count,
            }
            for (location_public_id, label), count in sorted(
                location_counts.items(),
                key=lambda entry: (-entry[1], entry[0][1].casefold()),
            )[:10]
        ],
        "activity": activity,
        "action_mix": [
            {
                "key": row["action_group"],
                "label": action_labels[row["action_group"]],
                "count": int(row["event_count"]),
            }
            for row in action_mix_rows
        ],
        "source_mix": [
            {
                "source": row["source"] or "unknown",
                "count": int(row["event_count"]),
            }
            for row in source_rows
        ],
        "source_activity": source_activity,
        "stock": [
            {"label": label, "count": count}
            for label, count in stock_counts.items()
        ],
        "inventory_age": [
            {"label": label, "count": count}
            for label, count in age_counts.items()
        ],
        "completeness": completeness,
        "expiration": [
            {"label": label, "count": count}
            for label, count in expiration_counts.items()
        ],
        "top_consumed": [
            {
                "public_id": row["public_id"],
                "name": row["name"],
                "unit": row["unit"],
                "quantity": from_milli(row["consumed_milli"]),
            }
            for row in consumed
        ],
        "top_changed": [
            {
                "public_id": row["public_id"],
                "name": row["name"],
                "event_count": int(row["event_count"]),
                "last_changed_at": row["last_changed_at"],
            }
            for row in changed
        ],
    }


def expiring_items(connection: sqlite3.Connection, days: int = 14) -> list[dict[str, Any]]:
    horizon = date.today() + timedelta(days=max(0, days))
    return [
        item
        for item in list_items(connection, limit=250)
        if item["expiration_date"] and item["expiration_date"] <= horizon.isoformat()
    ]
