from __future__ import annotations

import json
import sqlite3
from datetime import date
from decimal import Decimal
from typing import Any

from .category_icons import is_icon_name
from .db import transaction
from .inventory import (
    CATEGORY_DATA_FIELDS,
    ConflictError,
    NotFoundError,
    adjust_quantity,
    archive_item,
    category_data_settings,
    category_path,
    create_category,
    create_item,
    create_location,
    delete_category,
    delete_location,
    find_category_id,
    from_milli,
    get_category_row,
    get_item_row,
    get_location_row,
    hard_delete_item,
    list_location_tree,
    location_path,
    new_public_id,
    rebuild_search_index,
    restore_item,
    save_category_data_settings,
    set_item_tags,
    to_milli,
    update_category,
    update_item,
    update_location,
)
from .operations_contract import validate_item_values, validate_revision, validate_shape


def generate_low_stock_shopping(connection: sqlite3.Connection) -> int:
    from .inventory import low_stock_scope_sql

    rows = connection.execute(
        f"""
        SELECT * FROM items WHERE archived_at IS NULL AND low_stock_milli IS NOT NULL
          AND quantity_milli <= low_stock_milli{low_stock_scope_sql(connection)}
        """
    ).fetchall()
    created = 0
    with transaction(connection):
        for item in rows:
            exists = connection.execute(
                "SELECT 1 FROM shopping_list_entries WHERE item_id = ? AND checked = 0",
                (item["id"],),
            ).fetchone()
            if exists:
                continue
            desired = max(item["low_stock_milli"] - item["quantity_milli"], 1000)
            connection.execute(
                """
                INSERT INTO shopping_list_entries(
                    public_id, item_id, name, quantity_milli, unit, source
                ) VALUES (?, ?, ?, ?, ?, 'low_stock')
                """,
                (new_public_id("shop"), item["id"], item["name"], desired, item["unit"]),
            )
            created += 1
    return created


def list_shopping(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    return [
        {
            "public_id": row["public_id"],
            "item_public_id": row["item_public_id"],
            "name": row["name"],
            "quantity": from_milli(row["quantity_milli"]),
            "unit": row["unit"],
            "checked": bool(row["checked"]),
            "source": row["source"],
        }
        for row in connection.execute(
            """
            SELECT shopping_list_entries.*, items.public_id AS item_public_id
            FROM shopping_list_entries
            LEFT JOIN items ON items.id = shopping_list_entries.item_id
            ORDER BY checked, shopping_list_entries.created_at DESC
            """
        )
    ]


def add_shopping(
    connection: sqlite3.Connection,
    name: str,
    quantity: Decimal,
    unit: str,
    item_public_id: str | None = None,
) -> dict[str, Any]:
    public_id = new_public_id("shop")
    item_id = None
    source = "manual"
    if item_public_id:
        item = get_item_row(connection, item_public_id)
        item_id = item["id"]
        source = "low_stock"
        existing = connection.execute(
            "SELECT public_id FROM shopping_list_entries WHERE item_id = ? AND checked = 0",
            (item_id,),
        ).fetchone()
        if existing:
            return next(
                entry
                for entry in list_shopping(connection)
                if entry["public_id"] == existing["public_id"]
            )
    with transaction(connection):
        connection.execute(
            """
            INSERT INTO shopping_list_entries(
                public_id, item_id, name, quantity_milli, unit, source
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (public_id, item_id, name, to_milli(quantity), unit, source),
        )
    return next(entry for entry in list_shopping(connection) if entry["public_id"] == public_id)


def check_shopping(connection: sqlite3.Connection, public_id: str, checked: bool) -> None:
    with transaction(connection):
        cursor = connection.execute(
            """
            UPDATE shopping_list_entries SET checked = ?, updated_at = CURRENT_TIMESTAMP
            WHERE public_id = ?
            """,
            (int(checked), public_id),
        )
        if cursor.rowcount != 1:
            raise NotFoundError("Shopping list entry not found")


def duplicate_candidates(connection: sqlite3.Connection, public_id: str) -> list[dict[str, Any]]:
    item = get_item_row(connection, public_id)
    candidates = connection.execute(
        """
        SELECT public_id FROM items
        WHERE id != ? AND archived_at IS NULL AND category_id IS ?
        AND location_id = ? AND container_item_id IS ?
        AND trim(serial_number) = trim(?) COLLATE NOCASE AND (
            lower(trim(name)) = lower(trim(?))
            OR (serial_number != '' AND serial_number = ? COLLATE NOCASE)
            OR (barcode_override != '' AND barcode_override = ?)
        ) LIMIT 20
        """,
        (
            item["id"],
            item["category_id"],
            item["location_id"],
            item["container_item_id"],
            item["serial_number"],
            item["name"],
            item["serial_number"],
            item["barcode_override"],
        ),
    ).fetchall()
    from .inventory import get_item

    return [get_item(connection, row["public_id"]) for row in candidates]


def create_project(
    connection: sqlite3.Connection, name: str, description: str = ""
) -> dict[str, Any]:
    public_id = new_public_id("prj")
    with transaction(connection):
        connection.execute(
            "INSERT INTO projects(public_id, name, description) VALUES (?, ?, ?)",
            (public_id, name, description),
        )
    return {"public_id": public_id, "name": name, "description": description, "status": "active"}


def list_projects(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    from .projects import project_detail

    projects = connection.execute(
        "SELECT * FROM projects ORDER BY status = 'active' DESC, updated_at DESC"
    ).fetchall()
    result = []
    for project in projects:
        reservations = [
            {
                "item_public_id": row["item_public_id"],
                "item_name": row["item_name"],
                "quantity": from_milli(row["quantity_milli"]),
                "unit": row["unit"],
            }
            for row in connection.execute(
                """
                SELECT items.public_id AS item_public_id, items.name AS item_name,
                       items.unit, project_reservations.quantity_milli
                FROM project_reservations
                JOIN items ON items.id = project_reservations.item_id
                WHERE project_reservations.project_id = ? ORDER BY items.name COLLATE NOCASE
                """,
                (project["id"],),
            )
        ]
        result.append(
            {
                **project_detail(connection, project["public_id"]),
                "public_id": project["public_id"],
                "name": project["name"],
                "description": project["description"],
                "status": project["status"],
                "reservations": reservations,
            }
        )
    return result


def delete_project(connection: sqlite3.Connection, public_id: str) -> None:
    with transaction(connection):
        cursor = connection.execute(
            "UPDATE projects SET status='archived', updated_at=CURRENT_TIMESTAMP WHERE public_id=?",
            (public_id,),
        )
        if cursor.rowcount != 1:
            raise NotFoundError("Project not found")


def set_project_status(
    connection: sqlite3.Connection, public_id: str, status: str
) -> dict[str, Any]:
    with transaction(connection):
        cursor = connection.execute(
            """
            UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?
            """,
            (status, public_id),
        )
        if cursor.rowcount != 1:
            raise NotFoundError("Project not found")
    return next(
        project for project in list_projects(connection) if project["public_id"] == public_id
    )


def list_item_reservations(
    connection: sqlite3.Connection, item_public_id: str
) -> list[dict[str, Any]]:
    item = get_item_row(connection, item_public_id)
    return [
        {
            "project_public_id": row["project_public_id"],
            "project_name": row["project_name"],
            "project_status": row["project_status"],
            "quantity": from_milli(row["quantity_milli"]),
            "unit": item["unit"],
        }
        for row in connection.execute(
            """
            SELECT projects.public_id AS project_public_id,
                   projects.name AS project_name,
                   projects.status AS project_status,
                   project_reservations.quantity_milli
            FROM project_reservations
            JOIN projects ON projects.id = project_reservations.project_id
            WHERE project_reservations.item_id = ?
            ORDER BY projects.status = 'active' DESC, projects.name COLLATE NOCASE
            """,
            (item["id"],),
        )
    ]


def reserve_item(
    connection: sqlite3.Connection, project_public_id: str, item_public_id: str, quantity: Decimal
) -> None:
    from .projects import other_holds

    with transaction(connection):
        project = connection.execute(
            "SELECT id FROM projects WHERE public_id = ?", (project_public_id,)
        ).fetchone()
        if project is None:
            raise NotFoundError("Project not found")
        item = get_item_row(connection, item_public_id)
        requested = to_milli(quantity)
        if requested <= 0 or item["archived_at"]:
            raise ValueError("Reservation requires positive quantity and active inventory")
        if connection.execute(
            "SELECT 1 FROM project_requirements WHERE item_id=? AND project_id=? "
            "AND reserve=1 AND status!='cancelled'",
            (item["id"], project["id"]),
        ).fetchone():
            raise ConflictError("This project already reserves stock through a requirement")
        reserved = other_holds(connection, item["id"], project["id"])
        if reserved + requested > item["quantity_milli"]:
            raise ConflictError("Reservation exceeds available quantity")
        connection.execute(
            "INSERT INTO project_reservations(project_id,item_id,quantity_milli) VALUES(?,?,?) "
            "ON CONFLICT(project_id,item_id) DO UPDATE SET quantity_milli=excluded.quantity_milli",
            (project["id"], item["id"], requested),
        )


def remove_reservation(
    connection: sqlite3.Connection, project_public_id: str, item_public_id: str
) -> None:
    with transaction(connection):
        cursor = connection.execute(
            """
            DELETE FROM project_reservations
            WHERE project_id = (SELECT id FROM projects WHERE public_id = ?)
              AND item_id = (SELECT id FROM items WHERE public_id = ?)
            """,
            (project_public_id, item_public_id),
        )
        if cursor.rowcount != 1:
            raise NotFoundError("Reservation not found")


def create_loan(
    connection: sqlite3.Connection,
    item_public_id: str,
    direction: str,
    person: str,
    quantity: Decimal,
    due_date: date | None,
    notes: str,
) -> dict[str, Any]:
    item = get_item_row(connection, item_public_id)
    public_id = new_public_id("loan")
    with transaction(connection):
        connection.execute(
            """
            INSERT INTO loans(
                public_id, item_id, direction, person, quantity_milli, due_date, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                public_id,
                item["id"],
                direction,
                person,
                to_milli(quantity),
                due_date.isoformat() if due_date else None,
                notes,
            ),
        )
    return {
        "public_id": public_id,
        "item_public_id": item_public_id,
        "direction": direction,
        "person": person,
    }


def list_loans(
    connection: sqlite3.Connection, *, include_returned: bool = True
) -> list[dict[str, Any]]:
    where = "" if include_returned else "WHERE loans.returned_at IS NULL"
    return [
        {
            "public_id": row["public_id"],
            "item_public_id": row["item_public_id"],
            "item_name": row["item_name"],
            "unit": row["unit"],
            "direction": row["direction"],
            "person": row["person"],
            "quantity": from_milli(row["quantity_milli"]),
            "due_date": row["due_date"],
            "notes": row["notes"],
            "returned_at": row["returned_at"],
            "created_at": row["created_at"],
        }
        for row in connection.execute(
            f"""
            SELECT loans.*, items.public_id AS item_public_id, items.name AS item_name,
                   items.unit
            FROM loans JOIN items ON items.id = loans.item_id
            {where} ORDER BY loans.returned_at IS NULL DESC, loans.created_at DESC
            """
        )
    ]


def return_loan(connection: sqlite3.Connection, public_id: str) -> None:
    with transaction(connection):
        cursor = connection.execute(
            """
            UPDATE loans SET returned_at = CURRENT_TIMESTAMP
            WHERE public_id = ? AND returned_at IS NULL
            """,
            (public_id,),
        )
        if cursor.rowcount != 1:
            raise NotFoundError("Active loan not found")


def export_inventory(connection: sqlite3.Connection) -> dict[str, Any]:
    tables = [
        "locations",
        "categories",
        "products",
        "items",
        "tags",
        "item_tags",
        "photos",
        "inventory_events",
        "location_rules",
        "shopping_list_entries",
        "category_fields",
        "item_field_values",
        "compatibility_targets",
        "target_inventory_items",
        "compatibility_names",
        "item_compatibility",
        "project_compatibility",
        "project_requirements",
        "requirement_compatibility",
        "projects",
        "project_reservations",
        "project_completions",
        "project_outputs",
        "project_files",
        "loans",
    ]
    return {
        "format": "findstuff-export-v1",
        "exported_at": date.today().isoformat(),
        "tables": {
            table: [dict(row) for row in connection.execute(f"SELECT * FROM {table}")]
            for table in tables
        },
    }


OPERATION_ALIASES = {
    "add": "add",
    "create": "add",
    "modify": "modify",
    "update": "modify",
    "delete": "delete",
    "deleted": "delete",
    "remove": "delete",
    "archive": "delete",
}

TYPE_ALIASES = {
    "category": "category",
    "categories": "category",
    "location": "location",
    "locations": "location",
    "item": "item",
    "items": "item",
}


def _count_key(entity_type: str) -> str:
    return "categories" if entity_type == "category" else f"{entity_type}s"


def _operation_label(operation: dict[str, Any], index: int, op: str, entity_type: str) -> str:
    data = _operation_data(operation)
    match = _operation_match(operation)
    identity = (
        data.get("name")
        or data.get("path")
        or data.get("barcode")
        or match.get("name")
        or match.get("path")
        or match.get("barcode")
        or match.get("public_id")
        or match.get("id")
    )
    label = f"Operation #{index} ({op} {entity_type})"
    return f"{label} [{identity}]" if identity else label


def _is_operations_import(payload: dict[str, Any]) -> bool:
    return payload.get("format") == "findstuff-ops-v1" or isinstance(
        payload.get("operations"), list
    )


def _flatten_locations(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    flattened: list[dict[str, Any]] = []
    for node in nodes:
        flattened.append(node)
        flattened.extend(_flatten_locations(node.get("children", [])))
    return flattened


def _operation_parts(operation: dict[str, Any], index: int) -> tuple[str, str]:
    op = OPERATION_ALIASES.get(str(operation.get("op", "")).strip().casefold())
    entity_type = TYPE_ALIASES.get(str(operation.get("type", "")).strip().casefold())
    if op is None:
        raise ValueError(f"Operation #{index}: op must be add, modify, or delete")
    if entity_type is None:
        raise ValueError(f"Operation #{index}: type must be category, location, or item")
    return op, entity_type


def _operation_data(operation: dict[str, Any]) -> dict[str, Any]:
    data = operation.get("data", {})
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ValueError("Operation data must be an object")
    return dict(data)


def _operation_match(operation: dict[str, Any]) -> dict[str, Any]:
    match = operation.get("match", {})
    if match is None:
        return {}
    if not isinstance(match, dict):
        raise ValueError("Operation match must be an object")
    return dict(match)


def _resolve_category_id(connection: sqlite3.Connection, value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, int):
        get_category_row(connection, value)
        return value
    if isinstance(value, str) and value.strip().isdigit():
        category_id = int(value)
        get_category_row(connection, category_id)
        return category_id
    if isinstance(value, str):
        category_id = find_category_id(connection, value)
        if category_id is not None:
            return category_id
    raise ValueError(f"Category not found: {value}")


def _category_id_from_match(connection: sqlite3.Connection, match: dict[str, Any]) -> int:
    for key in ("id", "category_id", "path", "name", "category"):
        if key in match:
            category_id = _resolve_category_id(connection, match[key])
            if category_id is not None:
                return category_id
    raise ValueError("Category operation needs match.id, match.path, or match.name")


def _resolve_location_public_id(connection: sqlite3.Connection, value: Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, str):
        if connection.execute(
            "SELECT 1 FROM locations WHERE public_id = ? AND archived_at IS NULL", (value,)
        ).fetchone():
            return value
        normalized = value.strip().casefold()
        matches = [
            location
            for location in _flatten_locations(list_location_tree(connection))
            if location["path"].casefold() == normalized
            or location["name"].casefold() == normalized
        ]
        if len(matches) == 1:
            return str(matches[0]["public_id"])
        if len(matches) > 1:
            raise ConflictError(f"Location name is ambiguous: {value}")
    raise ValueError(f"Location not found: {value}")


def _location_public_id_from_match(connection: sqlite3.Connection, match: dict[str, Any]) -> str:
    for key in ("public_id", "location_public_id", "path", "name", "location"):
        if key in match:
            public_id = _resolve_location_public_id(connection, match[key])
            if public_id is not None:
                return public_id
    raise ValueError("Location operation needs match.public_id, match.path, or match.name")


def _item_public_id_from_match(connection: sqlite3.Connection, match: dict[str, Any]) -> str:
    conditions = ["items.archived_at IS NULL"]
    parameters: list[Any] = []
    identity = None
    for key in ("public_id", "id", "barcode", "name"):
        if match.get(key) is not None and match.get(key) != "":
            identity = key
            break
    if identity is None:
        raise ValueError(
            "Item operation needs match.public_id, match.id, match.barcode, or match.name"
        )
    for key in ("public_id", "id", "barcode", "name", "serial_number"):
        if key not in match:
            continue
        value = match[key]
        if key == "id":
            if isinstance(value, bool) or not str(value).isdigit():
                raise ValueError("Item match.id must be a positive integer")
            conditions.append("items.id = ?")
            parameters.append(int(value))
        elif key == "barcode":
            conditions.append(
                "COALESCE(NULLIF(items.barcode_override, ''), products.barcode, '') = ?"
            )
            parameters.append(str(value))
        else:
            conditions.append(
                f"trim(items.{key}) = ?" + (" COLLATE NOCASE" if key != "public_id" else "")
            )
            parameters.append(str(value).strip())
    for key in ("category_id", "category", "category_path", "category_name"):
        if key in match:
            conditions.append("items.category_id IS ?")
            parameters.append(_resolve_category_id(connection, match[key]))
            break
    for key in ("location_public_id", "location", "location_path", "location_name"):
        if key in match:
            conditions.append("locations.public_id = ?")
            parameters.append(_resolve_location_public_id(connection, match[key]) or "unassigned")
            break
    if "container_item_id" in match:
        from .containment import resolve_container

        conditions.append("items.container_item_id IS ?")
        parameters.append(
            resolve_container(connection, match["container_item_id"])["id"]
            if match["container_item_id"] is not None
            else None
        )
    rows = connection.execute(
        "SELECT items.public_id, items.name, items.category_id, "
        "items.location_id, items.serial_number "
        "FROM items JOIN locations ON locations.id=items.location_id "
        "LEFT JOIN products ON products.id=items.product_id WHERE "
        + " AND ".join(conditions)
        + " LIMIT 6",
        parameters,
    ).fetchall()
    if len(rows) == 1:
        return str(rows[0]["public_id"])
    if len(rows) > 1:
        candidates = "; ".join(_item_identity_description(connection, row) for row in rows)
        from .import_protocol import ImportFailure

        raise ImportFailure(
            f"Item {identity} is ambiguous: {match[identity]}. Candidates: {candidates}. "
            "Use public_id or category/location qualifiers.",
            "ambiguous_match",
            f"match.{identity}",
            candidates=[
                _preview_item_fields(connection, _item_snapshot(connection, row["public_id"]))
                for row in rows
            ],
        )
    raise ValueError(f"Item not found by {identity}: {match[identity]}")


def _parent_location_from_data(connection: sqlite3.Connection, data: dict[str, Any]) -> str | None:
    if "parent_public_id" in data:
        return _resolve_location_public_id(connection, data["parent_public_id"])
    for key in ("parent", "parent_path", "parent_name"):
        if key in data:
            return _resolve_location_public_id(connection, data[key])
    return None


def _category_parent_from_data(connection: sqlite3.Connection, data: dict[str, Any]) -> int | None:
    if "parent_id" in data:
        return _resolve_category_id(connection, data["parent_id"])
    for key in ("parent", "parent_path", "parent_name"):
        if key in data:
            return _resolve_category_id(connection, data[key])
    return None


def _existing_category_for_add(
    connection: sqlite3.Connection, name: str, parent_id: int | None
) -> dict[str, Any] | None:
    if parent_id is None:
        row = connection.execute(
            """
            SELECT id FROM categories
            WHERE parent_id IS NULL AND name = ? COLLATE NOCASE
            """,
            (name,),
        ).fetchone()
    else:
        row = connection.execute(
            """
            SELECT id FROM categories
            WHERE parent_id = ? AND name = ? COLLATE NOCASE
            """,
            (parent_id, name),
        ).fetchone()
    if row is None:
        return None
    return _category_snapshot(connection, int(row["id"]))


def _existing_location_for_add(
    connection: sqlite3.Connection, name: str, parent_public_id: str | None
) -> dict[str, Any] | None:
    parent_id = None
    if parent_public_id:
        parent = connection.execute(
            "SELECT id FROM locations WHERE public_id = ? AND archived_at IS NULL",
            (parent_public_id,),
        ).fetchone()
        if parent is None:
            raise ValueError(f"Location not found: {parent_public_id}")
        parent_id = parent["id"]
    if parent_id is None:
        row = connection.execute(
            """
            SELECT public_id FROM locations
            WHERE parent_id IS NULL AND archived_at IS NULL AND name = ? COLLATE NOCASE
            """,
            (name,),
        ).fetchone()
    else:
        row = connection.execute(
            """
            SELECT public_id FROM locations
            WHERE parent_id = ? AND archived_at IS NULL AND name = ? COLLATE NOCASE
            """,
            (parent_id, name),
        ).fetchone()
    return _location_snapshot(connection, str(row["public_id"])) if row else None


def _category_default_location_seen(data: dict[str, Any]) -> bool:
    return any(
        key in data
        for key in (
            "default_location",
            "default_location_path",
            "default_location_public_id",
        )
    )


def _category_metadata_seen(data: dict[str, Any]) -> bool:
    return any(key in data for key in ("metadata_enabled", "required_metadata", "capabilities"))


def _category_metadata_from_data(data: dict[str, Any]) -> dict[str, bool] | None:
    metadata = None
    for key in ("metadata_enabled", "required_metadata", "capabilities"):
        if key in data:
            metadata = data[key]
            break
    if metadata is None:
        return None
    if not isinstance(metadata, dict):
        raise ValueError("Category metadata_enabled must be an object of true/false fields")
    cleaned: dict[str, bool] = {}
    for field, value in metadata.items():
        if field not in CATEGORY_DATA_FIELDS:
            raise ValueError(
                f"Unknown category metadata field: {field}. "
                f"Allowed fields: {', '.join(CATEGORY_DATA_FIELDS)}"
            )
        if not isinstance(value, bool):
            raise ValueError(f"Category metadata field {field} must be true or false")
        cleaned[field] = value
    return cleaned


def _sync_category_metadata(
    connection: sqlite3.Connection, category_id: int, data: dict[str, Any]
) -> None:
    if not _category_metadata_seen(data):
        return
    overrides = dict(category_data_settings(connection)["overrides"])
    metadata = _category_metadata_from_data(data)
    if metadata:
        overrides[str(category_id)] = metadata
    else:
        overrides.pop(str(category_id), None)
    save_category_data_settings(connection, overrides)


def _category_default_location_from_data(
    connection: sqlite3.Connection, data: dict[str, Any]
) -> str | None:
    for key in ("default_location_public_id", "default_location", "default_location_path"):
        if key in data:
            return _resolve_location_public_id(connection, data[key])
    return None


def _category_default_rule_candidates(category: dict[str, Any]) -> list[str]:
    values = [str(category.get("path", "")).strip(), str(category.get("name", "")).strip()]
    return [value for index, value in enumerate(values) if value and value not in values[:index]]


def _category_default_rule_ids(
    connection: sqlite3.Connection, category: dict[str, Any]
) -> list[str]:
    candidates = _category_default_rule_candidates(category)
    if not candidates:
        return []
    placeholders = ", ".join("?" for _ in candidates)
    return [
        str(row["public_id"])
        for row in connection.execute(
            f"""
            SELECT public_id FROM location_rules
            WHERE rule_type = 'category' AND match_value COLLATE NOCASE IN ({placeholders})
            ORDER BY priority DESC, id
            """,
            tuple(candidates),
        )
    ]


def _sync_category_default_location(
    connection: sqlite3.Connection, category: dict[str, Any], location_public_id: str | None
) -> None:
    rule_ids = _category_default_rule_ids(connection, category)
    match_value = str(category["path"])
    with transaction(connection):
        if location_public_id is None:
            for public_id in rule_ids:
                connection.execute("DELETE FROM location_rules WHERE public_id = ?", (public_id,))
            return
        location = connection.execute(
            "SELECT id FROM locations WHERE public_id = ? AND archived_at IS NULL",
            (location_public_id,),
        ).fetchone()
        if location is None:
            raise ValueError(f"Location not found: {location_public_id}")
        if rule_ids:
            connection.execute(
                """
                UPDATE location_rules
                SET match_value = ?, location_id = ?, enabled = 1, priority = 100
                WHERE public_id = ?
                """,
                (match_value, location["id"], rule_ids[0]),
            )
            for public_id in rule_ids[1:]:
                connection.execute("DELETE FROM location_rules WHERE public_id = ?", (public_id,))
        else:
            connection.execute(
                """
                INSERT INTO location_rules(
                    public_id, rule_type, match_value, location_id, priority, enabled
                ) VALUES (?, 'category', ?, ?, 100, 1)
                """,
                (new_public_id("rule"), match_value, location["id"]),
            )


def _carry_category_default_rule(
    connection: sqlite3.Connection,
    before: dict[str, Any],
    after: dict[str, Any],
) -> None:
    rule_ids = _category_default_rule_ids(connection, before)
    if not rule_ids:
        return
    with transaction(connection):
        for public_id in rule_ids:
            connection.execute(
                "UPDATE location_rules SET match_value = ? WHERE public_id = ?",
                (after["path"], public_id),
            )


def _category_snapshot(connection: sqlite3.Connection, category_id: int) -> dict[str, Any]:
    row = get_category_row(connection, category_id)
    parent_path = category_path(connection, row["parent_id"]) if row["parent_id"] else None
    category = {
        "id": row["id"],
        "name": row["name"],
        "path": category_path(connection, row["id"]),
        "parent_path": parent_path,
    }
    default_rule = _category_default_rule_ids(connection, category)
    if default_rule:
        location = connection.execute(
            """
            SELECT locations.public_id FROM location_rules
            JOIN locations ON locations.id = location_rules.location_id
            WHERE location_rules.public_id = ?
            """,
            (default_rule[0],),
        ).fetchone()
        category["default_location_public_id"] = location["public_id"] if location else None
    else:
        category["default_location_public_id"] = None
    return category


def _location_snapshot(connection: sqlite3.Connection, public_id: str) -> dict[str, Any]:
    row = connection.execute(
        """
        SELECT child.*, parent.public_id AS parent_public_id
        FROM locations AS child
        LEFT JOIN locations AS parent ON parent.id = child.parent_id
        WHERE child.public_id = ?
        """,
        (public_id,),
    ).fetchone()
    if row is None:
        raise NotFoundError("Location not found")
    return {
        "public_id": row["public_id"],
        "parent_public_id": row["parent_public_id"],
        "name": row["name"],
        "path": location_path(connection, row["id"]),
        "kind": row["kind"],
        "description": row["description"],
    }


def _item_snapshot(connection: sqlite3.Connection, public_id: str) -> dict[str, Any]:
    row = get_item_row(connection, public_id)
    tags = [
        tag["name"]
        for tag in connection.execute(
            """
            SELECT tags.name FROM tags
            JOIN item_tags ON item_tags.tag_id = tags.id
            WHERE item_tags.item_id = ?
            ORDER BY tags.name COLLATE NOCASE
            """,
            (row["id"],),
        )
    ]
    from .extensions import item_extensions

    extras = item_extensions(connection, public_id)
    from .containment import item_containment

    return {
        "container_item_id": item_containment(connection, row)["container_item_id"],
        "is_container": bool(row["is_container"]),
        "custom_fields": extras["custom_fields"],
        "compatibility_targets": [
            target["public_id"] for target in extras["compatibility_targets"]
        ],
        "compatibility": [
            {key: entry[key] for key in ("target", "status", "notes", "source_url", "adapter")}
            for entry in extras["compatibility"]
        ],
        "public_id": row["public_id"],
        "name": row["name"],
        "description": row["description"],
        "notes": row["notes"],
        "category_id": row["category_id"],
        "location_public_id": row["location_public_id"],
        "quantity": from_milli(row["quantity_milli"]),
        "fullness_percent": row["fullness_percent"],
        "unit": row["unit"],
        "purchase_price_minor": row["purchase_price_minor"],
        "purchase_currency": row["purchase_currency"],
        "estimated_price_minor": row["estimated_price_minor"],
        "estimated_price_currency": row["estimated_price_currency"],
        "links": json.loads(row["links_json"] or "[]"),
        "weight_g": row["weight_g"],
        "length_mm": row["length_mm"],
        "width_mm": row["width_mm"],
        "height_mm": row["height_mm"],
        "serial_number": row["serial_number"],
        "model": row["model"],
        "brand": row["brand"],
        "expiration_date": row["expiration_date"],
        "low_stock_threshold": from_milli(row["low_stock_milli"])
        if row["low_stock_milli"] is not None
        else None,
        "barcode": row["barcode"],
        "tags": tags,
        "archived_at": row["archived_at"],
    }


def _item_identity_description(connection: sqlite3.Connection, row: sqlite3.Row) -> str:
    category = (
        category_path(connection, row["category_id"]) if row["category_id"] else "Uncategorised"
    )
    from .containment import item_containment

    full = get_item_row(connection, row["public_id"])
    place = item_containment(connection, full)["containment_path"] or location_path(
        connection, row["location_id"]
    )
    return f"{row['name']} [{row['public_id']}] · category: {category} · location: {place}" + (
        f" · serial: {row['serial_number']}" if row["serial_number"] else ""
    )


def _duplicate_item_for_add(
    connection: sqlite3.Connection, values: dict[str, Any]
) -> sqlite3.Row | None:
    from .containment import resolve_container

    container = (
        resolve_container(connection, values["container_item_id"])
        if values.get("container_item_id")
        else None
    )
    return connection.execute(
        "SELECT items.public_id, items.name, items.category_id, "
        "items.location_id, items.serial_number "
        "FROM items JOIN locations ON locations.id=items.location_id "
        "WHERE items.archived_at IS NULL AND items.category_id IS ? "
        "AND trim(items.name) = ? COLLATE NOCASE AND locations.public_id = ? "
        "AND trim(items.serial_number) = ? COLLATE NOCASE AND items.container_item_id IS ? LIMIT 1",
        (
            values.get("category_id"),
            str(values.get("name", "")).strip(),
            container["location_public_id"]
            if container
            else values.get("location_public_id") or "unassigned",
            str(values.get("serial_number", "")).strip(),
            container["id"] if container else None,
        ),
    ).fetchone()


def _record_import_batch(
    connection: sqlite3.Connection,
    *,
    mode: str,
    summary: dict[str, Any],
    undo_ops: list[dict[str, Any]],
    payload: dict[str, Any],
) -> str | None:
    if not undo_ops:
        return None
    public_id = new_public_id("imp")
    with transaction(connection):
        connection.execute(
            """
            INSERT INTO import_batches(public_id, mode, summary_json, undo_json, raw_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                public_id,
                mode,
                json.dumps(summary, separators=(",", ":")),
                json.dumps(undo_ops, separators=(",", ":")),
                json.dumps(payload, separators=(",", ":")),
            ),
        )
        connection.execute(
            """
            DELETE FROM import_batches
            WHERE public_id NOT IN (
                SELECT public_id
                FROM import_batches
                ORDER BY created_at DESC, public_id DESC
                LIMIT 5
            )
            """
        )
    return public_id


def list_import_batches(connection: sqlite3.Connection, limit: int = 5) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 5))
    with transaction(connection):
        connection.execute(
            """
            DELETE FROM import_batches
            WHERE public_id NOT IN (
                SELECT public_id
                FROM import_batches
                ORDER BY created_at DESC, public_id DESC
                LIMIT 5
            )
            """
        )
    rows = connection.execute(
        """
        SELECT public_id, mode, summary_json, undo_json, undone_at, created_at
        FROM import_batches
        ORDER BY created_at DESC, public_id DESC
        LIMIT ?
        """,
        (safe_limit,),
    ).fetchall()
    batches: list[dict[str, Any]] = []
    for row in rows:
        undo_ops = json.loads(row["undo_json"])
        batches.append(
            {
                "public_id": row["public_id"],
                "mode": row["mode"],
                "summary": json.loads(row["summary_json"]),
                "undo_count": len(undo_ops),
                "undone_at": row["undone_at"],
                "created_at": row["created_at"],
            }
        )
    return batches


def _category_id_from_undo(connection: sqlite3.Connection, operation: dict[str, Any]) -> int:
    if operation.get("id"):
        row = connection.execute(
            "SELECT id FROM categories WHERE id = ?", (operation["id"],)
        ).fetchone()
        if row:
            return int(row["id"])
    path = operation.get("path")
    if path:
        category_id = find_category_id(connection, str(path))
        if category_id is not None:
            return category_id
    raise NotFoundError("Imported category is no longer available")


def _restore_location(connection: sqlite3.Connection, snapshot: dict[str, Any]) -> None:
    row = connection.execute(
        "SELECT id FROM locations WHERE public_id = ?", (snapshot["public_id"],)
    ).fetchone()
    parent_id = None
    if snapshot.get("parent_public_id"):
        parent_id = get_location_row(connection, snapshot["parent_public_id"])["id"]
    if row:
        with transaction(connection):
            connection.execute(
                """
                UPDATE locations
                SET archived_at = NULL, parent_id = ?, name = ?, kind = ?,
                    description = ?, updated_at = CURRENT_TIMESTAMP
                WHERE public_id = ?
                """,
                (
                    parent_id,
                    snapshot["name"],
                    snapshot.get("kind", "location"),
                    snapshot.get("description", ""),
                    snapshot["public_id"],
                ),
            )
            rebuild_search_index(connection)
        return
    with transaction(connection):
        connection.execute(
            """
            INSERT INTO locations(public_id, parent_id, name, kind, description)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                snapshot["public_id"],
                parent_id,
                snapshot["name"],
                snapshot.get("kind", "location"),
                snapshot.get("description", ""),
            ),
        )


def _undo_item_update(connection: sqlite3.Connection, public_id: str, data: dict[str, Any]) -> None:
    row = get_item_row(connection, public_id)
    changes = {
        key: data[key]
        for key in (
            "name",
            "description",
            "notes",
            "category_id",
            "location_public_id",
            "quantity",
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
            "low_stock_threshold",
            "barcode",
            "links",
        )
    }
    if "container_item_id" in data:
        changes["container_item_id"] = data["container_item_id"]
        changes["is_container"] = data.get("is_container", False)
        if data["container_item_id"]:
            changes.pop("location_public_id", None)
    if "fullness_percent" in data:
        changes["fullness_percent"] = data["fullness_percent"]
    changes["expected_version"] = int(row["version"])
    update_item(connection, public_id, changes, source="import_undo")
    if "custom_fields" in data:
        from .custom_fields import restore_item_values

        restore_item_values(connection, row["id"], data["custom_fields"])
    if "compatibility_targets" in data:
        from .compatibility import set_represented_targets

        set_represented_targets(
            connection, row["id"], data["compatibility_targets"], allow_inactive=True
        )
    if "compatibility" in data:
        from .compatibility import set_item_compatibility

        set_item_compatibility(connection, row["id"], data["compatibility"], allow_inactive=True)
    current = get_item_row(connection, public_id)
    set_item_tags(connection, public_id, data.get("tags", []), int(current["version"]))


def _apply_import_undo_operation(connection: sqlite3.Connection, operation: dict[str, Any]) -> None:
    entity = operation["entity"]
    action = operation["action"]
    data = operation.get("data", {})
    from .extension_schemas import ENTITY_MODELS

    if entity in ENTITY_MODELS:
        from .extensions import undo_entity

        undo_entity(connection, operation)
        return
    if entity == "project_reservation" and action == "delete":
        connection.execute(
            "DELETE FROM project_reservations WHERE project_id=? AND item_id=?",
            (operation["project_id"], operation["item_id"]),
        )
        return
    if entity == "category":
        if action == "delete":
            delete_category(connection, _category_id_from_undo(connection, operation))
        elif action == "update":
            category_id = _category_id_from_undo(connection, operation)
            updated = update_category(
                connection,
                category_id,
                {
                    "name": data["name"],
                    "parent_id": _resolve_category_id(connection, data["parent_path"])
                    if data.get("parent_path")
                    else None,
                },
            )
            _sync_category_default_location(
                connection, updated, data.get("default_location_public_id")
            )
        elif action == "create":
            parent_id = (
                _resolve_category_id(connection, data["parent_path"])
                if data.get("parent_path")
                else None
            )
            created = create_category(connection, data["name"], parent_id)
            _sync_category_default_location(
                connection, created, data.get("default_location_public_id")
            )
        return
    if entity == "location":
        if action == "delete":
            delete_location(connection, operation["public_id"])
        elif action == "update":
            update_location(
                connection,
                operation["public_id"],
                {
                    "name": data["name"],
                    "kind": data.get("kind", "location"),
                    "description": data.get("description", ""),
                    "parent_public_id": data.get("parent_public_id"),
                },
            )
        elif action == "restore":
            _restore_location(connection, data)
        return
    if entity == "item":
        if action == "delete":
            hard_delete_item(connection, operation["public_id"])
        elif action == "update":
            _undo_item_update(connection, operation["public_id"], data)
        elif action == "restore":
            restore_item(connection, operation["public_id"])
        return
    if entity == "product" and action == "delete":
        with transaction(connection):
            connection.execute(
                "DELETE FROM products WHERE id = ? AND NOT EXISTS "
                "(SELECT 1 FROM items WHERE product_id = products.id)",
                (operation["id"],),
            )
        return
    if entity == "tag" and action == "delete":
        with transaction(connection):
            connection.execute("DELETE FROM item_tags WHERE tag_id = ?", (operation["id"],))
            connection.execute("DELETE FROM tags WHERE id = ?", (operation["id"],))


def undo_import_batch(connection: sqlite3.Connection, public_id: str) -> dict[str, Any]:
    row = connection.execute(
        "SELECT undo_json, undone_at FROM import_batches WHERE public_id = ?",
        (public_id,),
    ).fetchone()
    if row is None:
        raise NotFoundError("Import batch not found")
    if row["undone_at"]:
        return {"undone": False, "already_undone": True, "public_id": public_id}
    undo_ops = json.loads(row["undo_json"])
    with transaction(connection):
        for operation in reversed(undo_ops):
            _apply_import_undo_operation(connection, operation)
        connection.execute(
            "UPDATE import_receipts SET undone_at=CURRENT_TIMESTAMP WHERE batch_public_id=?",
            (public_id,),
        )
        connection.execute(
            "UPDATE import_batches SET undone_at = CURRENT_TIMESTAMP WHERE public_id = ?",
            (public_id,),
        )
    return {"undone": True, "public_id": public_id, "operations": len(undo_ops)}


def _normalized_item_values(
    connection: sqlite3.Connection, data: dict[str, Any], *, include_default_location: bool
) -> tuple[dict[str, Any], list[str] | None]:
    values = dict(data)
    tags = values.pop("tags", None)
    if tags is not None and not isinstance(tags, list):
        raise ValueError("Item tags must be a list")

    location_public_id = None
    location_seen = False
    for key in ("location_public_id", "location", "location_path", "location_name"):
        if key in values:
            location_seen = True
            location_public_id = _resolve_location_public_id(connection, values.pop(key))
            break
    if location_public_id is not None:
        values["location_public_id"] = location_public_id
    elif (include_default_location and not values.get("container_item_id")) or location_seen:
        values["location_public_id"] = "unassigned"

    category_id = None
    category_seen = False
    for key in ("category_id", "category", "category_path", "category_name"):
        if key in values:
            category_seen = True
            category_id = _resolve_category_id(connection, values.pop(key))
            break
    if category_seen:
        values["category_id"] = category_id

    normalized_tags = (
        [str(tag).strip() for tag in tags if str(tag).strip()] if tags is not None else None
    )
    return values, normalized_tags


def _operation_preview_detail(
    connection: sqlite3.Connection | None,
    operation: dict[str, Any],
    index: int,
    op: str,
    entity_type: str,
) -> dict[str, Any]:
    label = _operation_label(operation, index, op, entity_type)
    detail: dict[str, Any] = {
        "index": index,
        "action": op,
        "entity": entity_type,
        "label": label,
        "status": "pending",
        "message": "Will be checked during merge.",
    }
    if connection is None:
        return detail
    try:
        data = _operation_data(operation)
        match = _operation_match(operation)
        if op == "add" and entity_type == "category":
            name = str(data.get("name", "")).strip()
            if not name:
                raise ValueError("Category add needs data.name")
            _category_metadata_from_data(data)
            parent_id = _category_parent_from_data(connection, data)
            existing = _existing_category_for_add(connection, name, parent_id)
            if existing:
                detail.update(
                    {
                        "status": "skip",
                        "message": f"Category already exists: {existing['path']}",
                    }
                )
            else:
                detail.update({"status": "add", "message": "Will create category."})
        elif op == "add" and entity_type == "location":
            name = str(data.get("name", "")).strip()
            if not name:
                raise ValueError("Location add needs data.name")
            parent_public_id = _parent_location_from_data(connection, data)
            existing = _existing_location_for_add(connection, name, parent_public_id)
            if existing:
                detail.update(
                    {
                        "status": "skip",
                        "message": f"Location already exists: {existing['path']}",
                    }
                )
            else:
                detail.update({"status": "add", "message": "Will create location."})
        elif op == "add" and entity_type == "item":
            values, _tags = _normalized_item_values(connection, data, include_default_location=True)
            if not str(values.get("name", "")).strip():
                raise ValueError("Item add needs data.name")
            duplicate = _duplicate_item_for_add(connection, values)
            if duplicate:
                detail.update(
                    {
                        "status": "error",
                        "message": "Duplicate item by name and category at the same location: "
                        + _item_identity_description(connection, duplicate),
                        "duplicate_public_id": duplicate["public_id"],
                    }
                )
            else:
                detail.update({"status": "add", "message": "Will create item."})
        elif entity_type == "category":
            category_id = _category_id_from_match(connection, match)
            category = _category_snapshot(connection, category_id)
            _category_metadata_from_data(data)
            detail.update(
                {
                    "status": op,
                    "message": f"Will {op} category: {category['path']}",
                }
            )
        elif entity_type == "location":
            public_id = _location_public_id_from_match(connection, match)
            location = _location_snapshot(connection, public_id)
            detail.update(
                {
                    "status": op,
                    "message": f"Will {op} location: {location['path']}",
                }
            )
        else:
            public_id = _item_public_id_from_match(connection, match)
            item = _item_snapshot(connection, public_id)
            if op == "modify":
                quantity_delta = data.get("quantity_delta", data.get("add_quantity"))
                if quantity_delta is None and data.get("remove_quantity") is not None:
                    quantity_delta = -Decimal(str(data["remove_quantity"]))
                message = f"Will modify item: {item['name']}"
                if quantity_delta is not None:
                    message += f" ({Decimal(str(quantity_delta)):+g} quantity)"
                detail.update({"status": "modify", "message": message})
            else:
                detail.update({"status": "delete", "message": f"Will archive item: {item['name']}"})
    except (ConflictError, NotFoundError, ValueError, KeyError, TypeError) as exc:
        detail.update({"status": "error", "message": str(exc)})
    return detail


def _preview_item_fields(connection: sqlite3.Connection, item: dict[str, Any]) -> dict[str, Any]:
    location = get_location_row(connection, item["location_public_id"])
    return {
        **item,
        "category_path": category_path(connection, item["category_id"])
        if item["category_id"]
        else None,
        "location_path": location_path(connection, location["id"]),
    }


def _operations_preview(
    payload: dict[str, Any], connection: sqlite3.Connection | None = None
) -> dict[str, Any]:
    validate_revision(payload)
    operations = payload.get("operations")
    if not isinstance(operations, list):
        raise ValueError("Operations import needs an operations array")
    preview_connection = None
    if connection is not None:
        preview_connection = sqlite3.connect(":memory:")
        preview_connection.row_factory = sqlite3.Row
        preview_connection.execute("PRAGMA foreign_keys = ON")
        connection.backup(preview_connection)
    counts: dict[str, int] = {
        "operations": len(operations),
        "add": 0,
        "modify": 0,
        "delete": 0,
        "categories": 0,
        "locations": 0,
        "items": 0,
    }
    errors: list[str] = []
    details: list[dict[str, Any]] = []
    origins: dict[str, int] = {}
    try:
        for index, operation in enumerate(operations, start=1):
            if not isinstance(operation, dict):
                errors.append(f"Operation #{index}: expected an object")
                details.append(
                    {
                        "index": index,
                        "action": "unknown",
                        "entity": "unknown",
                        "label": f"Operation #{index}",
                        "status": "error",
                        "message": "Expected an object.",
                    }
                )
                continue
            try:
                op, entity_type = _operation_parts(operation, index)
                _operation_data(operation)
                _operation_match(operation)
                validate_shape(operation, op, entity_type)
            except ValueError as exc:
                errors.append(str(exc))
                details.append(
                    {
                        "index": index,
                        "action": "unknown",
                        "entity": "unknown",
                        "label": f"Operation #{index}",
                        "status": "error",
                        "message": str(exc),
                    }
                )
                continue
            counts[op] += 1
            counts[_count_key(entity_type)] += 1
            detail = _operation_preview_detail(
                preview_connection or connection, operation, index, op, entity_type
            )
            details.append(detail)
            if detail.get("duplicate_public_id") in origins:
                detail["message"] += (
                    f" (created by earlier Operation #{origins[detail['duplicate_public_id']]})"
                )
            if detail["status"] == "error":
                errors.append(f"{detail['label']}: {detail['message']}")
                continue
            if preview_connection is not None:
                try:
                    match = _operation_match(operation)
                    before = None
                    if entity_type == "item" and op != "add":
                        before = _item_snapshot(
                            preview_connection,
                            _item_public_id_from_match(preview_connection, match),
                        )
                        detail["before"] = _preview_item_fields(preview_connection, before)
                    with transaction(preview_connection):
                        if entity_type == "category":
                            applied = _apply_category_operation(preview_connection, op, operation)
                        elif entity_type == "location":
                            applied = _apply_location_operation(preview_connection, op, operation)
                        else:
                            applied = _apply_item_operation(preview_connection, op, operation)
                    if op == "add" and applied and isinstance(applied, str):
                        origins[applied] = index
                    if entity_type == "item":
                        public_id = str(applied) if op == "add" else before["public_id"]
                        after = _item_snapshot(preview_connection, public_id)
                        detail["after"] = _preview_item_fields(preview_connection, after)
                        if before and before["location_public_id"] != after["location_public_id"]:
                            detail["moved"] = True
                        detail["temporary_identity"] = op == "add"
                    elif entity_type == "location" and op != "delete":
                        place_id = (
                            str(applied)
                            if op == "add" and applied
                            else _location_public_id_from_match(preview_connection, match)
                            if op != "add"
                            else None
                        )
                        if place_id:
                            place = _location_snapshot(preview_connection, place_id)
                            detail["after"] = place
                            if place["kind"] == "room" and place["parent_public_id"]:
                                parent = _location_snapshot(
                                    preview_connection, place["parent_public_id"]
                                )
                                if parent["kind"] in ("drawer", "box", "container"):
                                    detail["warnings"] = [
                                        f"Unusual hierarchy: room {place['path']} "
                                        f"is inside a {parent['kind']}."
                                    ]
                    elif entity_type == "category" and op != "delete":
                        category_id = (
                            int(applied)
                            if op == "add" and applied
                            else _category_id_from_match(preview_connection, match)
                            if op != "add"
                            else None
                        )
                        if category_id:
                            detail["after"] = _category_snapshot(preview_connection, category_id)
                except (
                    ConflictError,
                    NotFoundError,
                    ValueError,
                    KeyError,
                    TypeError,
                    sqlite3.IntegrityError,
                ) as exc:
                    detail.update({"status": "error", "message": str(exc)})
                    errors.append(f"{detail['label']}: {detail['message']}")
        counts.update(
            {
                "items_added": sum(d["entity"] == "item" and d["status"] == "add" for d in details),
                "items_moved": sum(bool(d.get("moved")) for d in details),
                "locations_created": sum(
                    d["entity"] == "location" and d["status"] == "add" for d in details
                ),
                "categories_created": sum(
                    d["entity"] == "category" and d["status"] == "add" for d in details
                ),
                "warnings": sum(len(d.get("warnings", [])) for d in details),
                "errors": len(errors),
            }
        )
        return {
            "valid": not errors,
            "dry_run": True,
            "mode": "operations",
            "atomic": payload.get("schema_version") in (2, 3),
            "counts": counts,
            "errors": errors,
            "details": details,
            "note": (
                "Legacy non-atomic import: successful operations remain applied if another fails. "
                "Use schema_version 2 for all-or-nothing behavior. Operations apply in input order."
            ),
        }
    finally:
        if preview_connection is not None:
            preview_connection.close()



def _sync_category_icon(
    connection: sqlite3.Connection, category_id: int, data: dict[str, Any]
) -> None:
    """Sets the category's icon when the operation names one; omitted leaves it alone."""
    if "icon" in data:
        update_category(connection, category_id, {"icon": str(data["icon"] or "")})


def _apply_category_operation(
    connection: sqlite3.Connection, op: str, operation: dict[str, Any]
) -> bool | int:
    validate_shape(operation, op, "category")
    data = _operation_data(operation)
    match = _operation_match(operation)
    if op == "add":
        name = str(data.get("name", "")).strip()
        if not name:
            raise ValueError("Category add needs data.name")
        parent_id = _category_parent_from_data(connection, data)
        existing = _existing_category_for_add(connection, name, parent_id)
        if existing:
            if _category_default_location_seen(data):
                _sync_category_default_location(
                    connection,
                    existing,
                    _category_default_location_from_data(connection, data),
                )
            _sync_category_metadata(connection, int(existing["id"]), data)
            _sync_category_icon(connection, int(existing["id"]), data)
            return False
        created = create_category(connection, name, parent_id)
        _sync_category_icon(connection, int(created["id"]), data)
        if _category_default_location_seen(data):
            _sync_category_default_location(
                connection,
                created,
                _category_default_location_from_data(connection, data),
            )
        _sync_category_metadata(connection, int(created["id"]), data)
        return int(created["id"])
    category_id = _category_id_from_match(connection, match)
    before = _category_snapshot(connection, category_id)
    if op == "delete":
        delete_category(connection, category_id)
        _sync_category_default_location(connection, before, None)
        return True
    changes: dict[str, Any] = {}
    if "name" in data:
        changes["name"] = data["name"]
    if any(key in data for key in ("parent_id", "parent", "parent_path", "parent_name")):
        changes["parent_id"] = _category_parent_from_data(connection, data)
    if "icon" in data:
        changes["icon"] = str(data["icon"] or "")
    updated = update_category(connection, category_id, changes)
    if _category_default_location_seen(data):
        _sync_category_default_location(
            connection,
            updated,
            _category_default_location_from_data(connection, data),
        )
    else:
        _carry_category_default_rule(connection, before, updated)
    _sync_category_metadata(connection, category_id, data)
    return True


def _apply_location_operation(
    connection: sqlite3.Connection, op: str, operation: dict[str, Any]
) -> bool | str:
    validate_shape(operation, op, "location")
    data = _operation_data(operation)
    match = _operation_match(operation)
    if op == "add":
        name = str(data.get("name", "")).strip()
        if not name:
            raise ValueError("Location add needs data.name")
        parent_public_id = _parent_location_from_data(connection, data)
        if _existing_location_for_add(connection, name, parent_public_id):
            return False
        created = create_location(
            connection,
            {
                "name": name,
                "kind": data.get("kind", "location"),
                "description": data.get("description", ""),
                "parent_public_id": parent_public_id,
            },
        )
        if "icon" in data:
            update_location(connection, created["public_id"], {"icon": str(data["icon"] or "")})
        return str(created["public_id"])
    public_id = _location_public_id_from_match(connection, match)
    if op == "delete":
        delete_location(connection, public_id)
        return True
    changes = {key: data[key] for key in ("name", "kind", "description") if key in data}
    if "icon" in data:
        changes["icon"] = str(data["icon"] or "")
    if any(key in data for key in ("parent_public_id", "parent", "parent_path", "parent_name")):
        changes["parent_public_id"] = _parent_location_from_data(connection, data)
    update_location(connection, public_id, changes)
    return True


def _apply_item_operation(
    connection: sqlite3.Connection, op: str, operation: dict[str, Any]
) -> bool | str:
    validate_shape(operation, op, "item")
    data = _operation_data(operation)
    match = _operation_match(operation)
    if op == "add":
        values, tags = _normalized_item_values(connection, data, include_default_location=True)
        if not str(values.get("name", "")).strip():
            raise ValueError("Item add needs data.name")
        duplicate = _duplicate_item_for_add(connection, values)
        if duplicate:
            raise ConflictError(
                "Item already exists with this name and category at the same location: "
                + _item_identity_description(connection, duplicate)
            )
        values = validate_item_values(values, adding=True)
        item = create_item(connection, values, source="import")
        if tags is not None:
            set_item_tags(connection, item["public_id"], tags, item["version"])
        return str(item["public_id"])
    public_id = _item_public_id_from_match(connection, match)
    if op == "delete":
        archive_item(connection, public_id)
        return True
    values, tags = _normalized_item_values(connection, data, include_default_location=False)
    values = validate_item_values(values, adding=False)
    values.pop("quantity_delta", None)
    values.pop("add_quantity", None)
    values.pop("remove_quantity", None)
    quantity_delta = data.get("quantity_delta", data.get("add_quantity"))
    if quantity_delta is None and data.get("remove_quantity") is not None:
        quantity_delta = -Decimal(str(data["remove_quantity"]))
    if quantity_delta is not None:
        row = get_item_row(connection, public_id)
        adjust_quantity(
            connection,
            public_id,
            Decimal(str(quantity_delta)),
            int(row["version"]),
            source="import",
        )
        values.pop("quantity", None)
    if values:
        row = get_item_row(connection, public_id)
        values["expected_version"] = int(row["version"])
        update_item(connection, public_id, values, source="import")
    if tags is not None:
        current = get_item_row(connection, public_id)
        set_item_tags(connection, public_id, tags, int(current["version"]))
    return True


def _apply_operations_import(
    connection: sqlite3.Connection, payload: dict[str, Any]
) -> dict[str, Any]:
    preview = _operations_preview(payload)
    if not preview["valid"]:
        raise ValueError("; ".join(preview["errors"]))
    result = {
        "operations": 0,
        "add": 0,
        "modify": 0,
        "delete": 0,
        "skipped": 0,
        "categories": 0,
        "locations": 0,
        "items": 0,
    }
    errors: list[str] = []
    undo_ops: list[dict[str, Any]] = []
    details = []
    for index, operation in enumerate(payload["operations"], start=1):
        op, entity_type = _operation_parts(operation, index)
        label = _operation_label(operation, index, op, entity_type)
        try:
            before: dict[str, Any] | None = None
            if op != "add":
                match = _operation_match(operation)
                if entity_type == "category":
                    before = _category_snapshot(
                        connection, _category_id_from_match(connection, match)
                    )
                elif entity_type == "location":
                    before = _location_snapshot(
                        connection, _location_public_id_from_match(connection, match)
                    )
                else:
                    before = _item_snapshot(
                        connection, _item_public_id_from_match(connection, match)
                    )
            with transaction(connection):
                if entity_type == "category":
                    applied = _apply_category_operation(connection, op, operation)
                elif entity_type == "location":
                    applied = _apply_location_operation(connection, op, operation)
                else:
                    applied = _apply_item_operation(connection, op, operation)
            if applied:
                if op == "add" and entity_type == "category":
                    category = _category_snapshot(connection, int(applied))
                    undo_ops.append(
                        {
                            "entity": "category",
                            "action": "delete",
                            "id": category["id"],
                            "path": category["path"],
                        }
                    )
                elif op == "add" and entity_type == "location":
                    undo_ops.append(
                        {
                            "entity": "location",
                            "action": "delete",
                            "public_id": str(applied),
                        }
                    )
                elif op == "add" and entity_type == "item":
                    undo_ops.append(
                        {"entity": "item", "action": "delete", "public_id": str(applied)}
                    )
                elif op == "modify" and before is not None:
                    if entity_type == "category":
                        undo_ops.append(
                            {
                                "entity": "category",
                                "action": "update",
                                "id": before["id"],
                                "path": before["path"],
                                "data": before,
                            }
                        )
                    elif entity_type == "location":
                        undo_ops.append(
                            {
                                "entity": "location",
                                "action": "update",
                                "public_id": before["public_id"],
                                "data": before,
                            }
                        )
                    else:
                        undo_ops.append(
                            {
                                "entity": "item",
                                "action": "update",
                                "public_id": before["public_id"],
                                "data": before,
                            }
                        )
                elif op == "delete" and before is not None:
                    if entity_type == "category":
                        undo_ops.append({"entity": "category", "action": "create", "data": before})
                    elif entity_type == "location":
                        undo_ops.append({"entity": "location", "action": "restore", "data": before})
                    else:
                        undo_ops.append(
                            {
                                "entity": "item",
                                "action": "restore",
                                "public_id": before["public_id"],
                            }
                        )
        except (ConflictError, NotFoundError, ValueError, KeyError, TypeError) as exc:
            errors.append(f"{label}: {exc}")
            details.append(
                {
                    "operation_index": index,
                    "status": "failed",
                    "committed": False,
                    "message": str(exc),
                }
            )
            continue
        details.append(
            {
                "operation_index": index,
                "status": "committed" if applied else "skipped",
                "committed": bool(applied),
            }
        )
        result["operations"] += 1
        if applied:
            result[op] += 1
            result[_count_key(entity_type)] += 1
        else:
            result["skipped"] += 1
    response = {
        "valid": not errors,
        "mode": "operations",
        "created": result,
        "errors": errors,
        "atomic": False,
        "details": details,
    }
    batch_id = _record_import_batch(
        connection, mode="operations", summary=result, undo_ops=undo_ops, payload=payload
    )
    if batch_id:
        response["import_public_id"] = batch_id
    return response


def import_preview(
    payload: dict[str, Any], connection: sqlite3.Connection | None = None
) -> dict[str, Any]:
    if connection is not None:
        from .import_protocol import receipt, validate_envelope

        if _is_operations_import(payload):
            validate_envelope(payload)
        previous = receipt(connection, payload)
        if previous:
            return {
                "valid": True,
                "dry_run": True,
                "replayed": True,
                "counts": {"changes": 0},
                "details": [],
                "errors": [],
                "note": (
                    "This batch was already processed. "
                    "Retry returns its receipt without new writes."
                )
                + (" It has since been undone." if previous.get("undone") else ""),
            }
    if _is_operations_import(payload):
        if payload.get("schema_version") in (2, 3) and connection is not None:
            from .import_protocol import preview_v2

            return preview_v2(connection, payload)
        return _operations_preview(payload, connection)
    if payload.get("format") != "findstuff-export-v1" or not isinstance(
        payload.get("tables"), dict
    ):
        raise ValueError("Unsupported Findstuff export format")
    from .extension_exports import TABLES

    allowed = {"locations", "categories", "products", "items", "tags", "item_tags", *TABLES}
    counts = {
        table: len(rows)
        for table, rows in payload["tables"].items()
        if table in allowed and isinstance(rows, list)
    }
    errors = []
    for table, rows in payload["tables"].items():
        if table not in allowed:
            continue  # Full exports contain auxiliary tables not supported by merge.
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            errors.append(f"{table}: expected an array of record objects")
    if errors:
        return {"valid": False, "dry_run": True, "counts": counts, "details": [], "errors": errors}
    if connection is not None:
        return _raw_import_preview(connection, payload, counts)
    return {
        "valid": True,
        "dry_run": True,
        "counts": counts,
        "details": [
            {
                "index": index,
                "action": "merge",
                "entity": table,
                "label": table,
                "status": "pending",
                "message": f"Will examine {count} {table} record(s).",
            }
            for index, (table, count) in enumerate(counts.items(), start=1)
        ],
        "note": "Merge keeps local records that have the same public ID, slug, or barcode.",
    }


def _raw_import_preview(
    connection: sqlite3.Connection, payload: dict[str, Any], counts: dict[str, int]
) -> dict[str, Any]:
    clone = sqlite3.connect(":memory:")
    clone.row_factory = sqlite3.Row
    clone.execute("PRAGMA foreign_keys = ON")
    connection.backup(clone)
    details = []
    errors = []
    try:
        result = _apply_import_merge_untracked(clone, payload)
        for table, rows in payload["tables"].items():
            if table not in counts:
                continue
            for row_index, row in enumerate(rows):
                field = {"categories": "slug", "products": "barcode", "tags": "name"}.get(
                    table, "public_id"
                )
                exists = (
                    table
                    in {
                        "item_tags",
                        "item_field_values",
                        "compatibility_names",
                        "target_inventory_items",
                        "item_compatibility",
                        "project_compatibility",
                        "requirement_compatibility",
                        "project_reservations",
                    }
                    or connection.execute(
                        f"SELECT 1 FROM {table} WHERE {field} = ?", (row.get(field),)
                    ).fetchone()
                )
                detail = {
                    "index": len(details) + 1,
                    "table": table,
                    "row_index": row_index,
                    "entity": table,
                    "action": "merge",
                    "label": row.get("name", table),
                    "status": "skip" if exists else "add",
                    "message": "Existing identity: kept locally." if exists else "Will add record.",
                }
                if table == "items":
                    detail["after"] = _preview_item_fields(
                        clone, _item_snapshot(clone, row["public_id"])
                    )
                elif table == "locations":
                    detail["after"] = _location_snapshot(clone, row["public_id"])
                details.append(detail)
        counts = {**counts, **{f"{key}_created": value for key, value in result["created"].items()}}
    except (ConflictError, NotFoundError, ValueError, KeyError, TypeError, sqlite3.Error) as exc:
        errors.append(f"Export merge: {exc}")
    finally:
        clone.close()
    return {
        "valid": not errors,
        "dry_run": True,
        "counts": counts,
        "details": details,
        "errors": errors,
        "note": "Preview simulated this entire merge without changing your inventory.",
    }


def _apply_import_merge_untracked(
    connection: sqlite3.Connection, payload: dict[str, Any]
) -> dict[str, Any]:
    if _is_operations_import(payload):
        validate_revision(payload)
        if payload.get("schema_version") in (2, 3):
            from .import_protocol import apply_v2

            return apply_v2(connection, payload)
        return _apply_operations_import(connection, payload)
    preview = import_preview(payload)
    if not preview["valid"]:
        raise ValueError("; ".join(preview["errors"]))
    tables = payload["tables"]
    result = {"categories": 0, "locations": 0, "products": 0, "items": 0, "tags": 0}
    category_ids: dict[int, int] = {}
    location_ids: dict[int, int] = {}
    product_ids: dict[int, int] = {}
    item_ids: dict[int, int] = {}
    tag_ids: dict[int, int] = {}
    undo_ops: list[dict[str, Any]] = []

    with transaction(connection):
        pending_categories = list(tables.get("categories", []))
        while pending_categories:
            progress = False
            for row in pending_categories[:]:
                parent_old = row.get("parent_id")
                if parent_old is not None and parent_old not in category_ids:
                    continue
                existing = connection.execute(
                    "SELECT id FROM categories WHERE slug = ?", (row["slug"],)
                ).fetchone()
                exported_icon = str(row.get("icon") or "")
                if exported_icon and not is_icon_name(exported_icon):
                    exported_icon = ""
                if existing:
                    local_id = existing["id"]
                    # An icon chosen here is kept; one missing here is filled from the file.
                    if exported_icon:
                        connection.execute(
                            "UPDATE categories SET icon = ? WHERE id = ? AND icon = ''",
                            (exported_icon, local_id),
                        )
                else:
                    cursor = connection.execute(
                        """
                        INSERT INTO categories(parent_id, name, slug, sort_order, icon)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            category_ids.get(parent_old),
                            row["name"],
                            row["slug"],
                            row.get("sort_order", 0),
                            exported_icon,
                        ),
                    )
                    local_id = cursor.lastrowid
                    result["categories"] += 1
                    category = _category_snapshot(connection, int(local_id))
                    undo_ops.append(
                        {
                            "entity": "category",
                            "action": "delete",
                            "id": category["id"],
                            "path": category["path"],
                        }
                    )
                category_ids[row["id"]] = local_id
                pending_categories.remove(row)
                progress = True
            if not progress:
                raise ValueError("Category hierarchy contains missing parents or a cycle")

        pending = list(tables.get("locations", []))
        while pending:
            progress = False
            for row in pending[:]:
                parent_old = row.get("parent_id")
                if parent_old is not None and parent_old not in location_ids:
                    continue
                existing = connection.execute(
                    "SELECT id FROM locations WHERE public_id = ?", (row["public_id"],)
                ).fetchone()
                exported_icon = str(row.get("icon") or "")
                if exported_icon and not is_icon_name(exported_icon):
                    exported_icon = ""
                if existing:
                    local_id = existing["id"]
                    # An icon chosen here is kept; one missing here is filled from the file.
                    if exported_icon:
                        connection.execute(
                            "UPDATE locations SET icon = ? WHERE id = ? AND icon = ''",
                            (exported_icon, local_id),
                        )
                else:
                    cursor = connection.execute(
                        """
                        INSERT INTO locations(public_id, parent_id, name, kind, description, icon)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            row["public_id"],
                            location_ids.get(parent_old),
                            row["name"],
                            row.get("kind", "location"),
                            row.get("description", ""),
                            exported_icon,
                        ),
                    )
                    local_id = cursor.lastrowid
                    result["locations"] += 1
                    undo_ops.append(
                        {
                            "entity": "location",
                            "action": "delete",
                            "public_id": row["public_id"],
                        }
                    )
                location_ids[row["id"]] = local_id
                pending.remove(row)
                progress = True
            if not progress:
                raise ValueError("Location hierarchy contains missing parents or a cycle")

        for row in tables.get("products", []):
            existing = connection.execute(
                "SELECT id FROM products WHERE barcode = ?", (row["barcode"],)
            ).fetchone()
            if existing:
                local_id = existing["id"]
            else:
                cursor = connection.execute(
                    """
                    INSERT INTO products(barcode, name, brand, net_quantity_text, image_url, source)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        row["barcode"],
                        row.get("name", ""),
                        row.get("brand", ""),
                        row.get("net_quantity_text", ""),
                        row.get("image_url"),
                        row.get("source", "import"),
                    ),
                )
                local_id = cursor.lastrowid
                result["products"] += 1
                undo_ops.append({"entity": "product", "action": "delete", "id": local_id})
            product_ids[row["id"]] = local_id

        item_columns = [
            "public_id",
            "name",
            "description",
            "notes",
            "quantity_milli",
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
            "low_stock_milli",
            "fullness_percent",
            "barcode_override",
            "links_json",
        ]
        for row in tables.get("items", []):
            existing = connection.execute(
                "SELECT id FROM items WHERE public_id = ?", (row["public_id"],)
            ).fetchone()
            if existing:
                item_ids[row["id"]] = existing["id"]
                continue
            mapped_location = location_ids.get(row["location_id"])
            if mapped_location is None:
                raise ValueError(f"Item {row['name']} references a missing location")
            for field, mapping in (("category_id", category_ids), ("product_id", product_ids)):
                if row.get(field) is not None and row[field] not in mapping:
                    raise ValueError(f"Item {row['name']} references a missing {field}")
            values = [row.get(column) for column in item_columns]
            cursor = connection.execute(
                f"""
                INSERT INTO items(
                    {", ".join(item_columns)}, category_id, product_id, location_id
                ) VALUES ({", ".join("?" for _ in item_columns)}, ?, ?, ?)
                """,
                (
                    *values,
                    category_ids.get(row.get("category_id")),
                    product_ids.get(row.get("product_id")),
                    mapped_location,
                ),
            )
            item_ids[row["id"]] = cursor.lastrowid
            result["items"] += 1
            undo_ops.append({"entity": "item", "action": "delete", "public_id": row["public_id"]})

        # Restore canonical containment after every item ID has been remapped.
        from .containment import apply_placement, validate_parent

        created_ids = {
            entry["public_id"]
            for entry in undo_ops
            if entry.get("entity") == "item" and entry.get("action") == "delete"
        }
        pending = [row for row in tables.get("items", []) if row["public_id"] in created_ids]
        for row in pending:
            connection.execute(
                "UPDATE items SET is_container=? WHERE id=?",
                (bool(row.get("is_container", False)), item_ids[row["id"]]),
            )
        remaining = {row["id"]: row for row in pending if row.get("container_item_id") is not None}
        while remaining:
            ready = [row for row in remaining.values() if row["container_item_id"] not in remaining]
            if not ready:
                raise ValueError("Item containment cycle in export")
            for row in ready:
                parent_id = item_ids.get(row["container_item_id"])
                parent = connection.execute(
                    "SELECT * FROM items WHERE id=?", (parent_id,)
                ).fetchone()
                if parent is None:
                    raise ValueError(f"Container missing for {row['name']}")
                validate_parent(connection, parent, item_ids[row["id"]])
                apply_placement(
                    connection, item_ids[row["id"]], parent_id, bool(row.get("is_container"))
                )
                del remaining[row["id"]]

        for row in tables.get("tags", []):
            cursor = connection.execute(
                "INSERT OR IGNORE INTO tags(name) VALUES (?)", (row["name"],)
            )
            local_id = connection.execute(
                "SELECT id FROM tags WHERE name = ? COLLATE NOCASE", (row["name"],)
            ).fetchone()["id"]
            tag_ids[row["id"]] = local_id
            result["tags"] += cursor.rowcount
            if cursor.rowcount:
                undo_ops.append({"entity": "tag", "action": "delete", "id": local_id})
        for row in tables.get("item_tags", []):
            if row["item_id"] in item_ids and row["tag_id"] in tag_ids:
                connection.execute(
                    "INSERT OR IGNORE INTO item_tags(item_id, tag_id) VALUES (?, ?)",
                    (item_ids[row["item_id"]], tag_ids[row["tag_id"]]),
                )

        from .extension_exports import merge_extensions

        checkpoint = len(undo_ops)
        merge_extensions(connection, tables, category_ids, item_ids, undo_ops)
        for entry in undo_ops[checkpoint:]:
            if entry["action"] == "erase":
                key = entry["entity"] + "s"
                result[key] = result.get(key, 0) + 1

    with transaction(connection):
        rebuild_search_index(connection)
    # Undo runs in reverse: erase descendants before containers even for unordered exports.
    from .containment import item_containment

    item_positions = [
        index
        for index, entry in enumerate(undo_ops)
        if entry.get("entity") == "item" and entry.get("action") == "delete"
    ]
    ordered_items = sorted(
        (undo_ops[index] for index in item_positions),
        key=lambda entry: len(
            item_containment(connection, get_item_row(connection, entry["public_id"]))[
                "container_chain"
            ]
        ),
    )
    for index, entry in zip(item_positions, ordered_items, strict=True):
        undo_ops[index] = entry
    response = {"valid": preview["valid"], "mode": "merge", "created": result}
    batch_id = _record_import_batch(
        connection, mode="merge", summary=result, undo_ops=undo_ops, payload=payload
    )
    if batch_id:
        response["import_public_id"] = batch_id
    return response


def apply_import_merge(connection: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    from .import_protocol import identity, receipt, validate_envelope

    if _is_operations_import(payload):
        validate_envelope(payload)
        if payload.get("schema_version") in (2, 3):
            return _apply_import_merge_untracked(connection, payload)
        if (
            payload.get("duplicate_policy", "error") != "error"
            or payload.get("ordering", "input") != "input"
        ):
            raise ValueError(
                "Duplicate policies and dependency ordering require schema_version 2 or 3"
            )
    with transaction(connection):
        previous = receipt(connection, payload)
        if previous:
            return previous
        result = _apply_import_merge_untracked(connection, payload)
        import_id, digest = identity(payload)
        result.update(import_id=import_id, replayed=False)
        connection.execute(
            "INSERT INTO import_receipts(import_id,payload_hash,batch_public_id,result_json) "
            "VALUES(?,?,?,?)",
            (import_id, digest, result.get("import_public_id"), json.dumps(result)),
        )
        return result
