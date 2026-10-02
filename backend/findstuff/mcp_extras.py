"""Additional read and category-appearance operations for MCP."""

from __future__ import annotations

import sqlite3
from typing import Any

from .category_icons import import_set as import_category_icons
from .category_icons import suggest_all as suggest_category_icons
from .category_marks import (
    delete_mark,
    import_marks,
    list_marks,
    read_mark,
    save_mark,
)
from .inventory import list_items

JsonObject = dict[str, Any]


def owned(connection: sqlite3.Connection, query: str) -> JsonObject:
    if not 1 <= len(query) <= 300:
        raise ValueError("query must be 1-300 characters")
    items = list_items(connection, query=query, limit=50)
    return {"query": query, "owned": bool(items), "items": items}


def import_provenance(connection: sqlite3.Connection, public_id: str) -> list[JsonObject]:
    return [
        dict(row)
        for row in connection.execute(
            "SELECT p.import_id,p.operation_index,p.action,r.created_at,r.undone_at "
            "FROM import_provenance p JOIN import_receipts r USING(import_id) "
            "WHERE p.entity='item' AND p.object_id=? ORDER BY p.id DESC LIMIT 100",
            (public_id,),
        )
    ]


def get_category_marks() -> JsonObject:
    return {"marks": list_marks()}


def get_category_mark(name: str) -> JsonObject:
    svg = read_mark(name)
    if svg is None:
        raise ValueError("Category mark not found")
    return {"name": name, "svg": svg}


def put_category_mark(name: str, svg: str) -> JsonObject:
    return {"name": name, "svg": save_mark(name, svg)}


def remove_category_mark(name: str) -> JsonObject:
    if not delete_mark(name):
        raise ValueError("Category mark not found")
    return {"deleted": True}


def import_category_mark_set(payload: JsonObject, apply: bool) -> JsonObject:
    return import_marks(payload, apply=apply)


def import_category_icon_set(
    connection: sqlite3.Connection, payload: JsonObject, apply: bool
) -> JsonObject:
    return import_category_icons(connection, payload, apply=apply)


def suggest_icons(connection: sqlite3.Connection, overwrite: bool) -> JsonObject:
    return suggest_category_icons(connection, overwrite=overwrite)
