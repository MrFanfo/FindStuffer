"""Category and location metadata operations for MCP."""

from __future__ import annotations

import sqlite3
from typing import Any

from .category_consolidation import consolidate, preview
from .inventory import (
    category_contents,
    create_location_rule,
    delete_location_rule,
    ensure_location_type,
    get_location_row,
    serialize_location,
    suggest_default_location,
    update_location_rule,
)
from .schemas import LocationRuleCreate, LocationRulePatch, LocationTypeCreate

JsonObject = dict[str, Any]


def get_location(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    return serialize_location(connection, get_location_row(connection, public_id))


def get_category_contents(
    connection: sqlite3.Connection, category_id: int, recursive: bool
) -> JsonObject:
    return category_contents(connection, category_id, recursive=recursive)


def create_type(connection: sqlite3.Connection, args: JsonObject) -> JsonObject:
    values = LocationTypeCreate.model_validate(args)
    return ensure_location_type(connection, values.name, values.icon)


def create_rule(connection: sqlite3.Connection, args: JsonObject) -> JsonObject:
    values = LocationRuleCreate.model_validate(args)
    return create_location_rule(connection, values.model_dump())


def patch_rule(connection: sqlite3.Connection, public_id: str, args: JsonObject) -> JsonObject:
    values = LocationRulePatch.model_validate(args).model_dump(exclude_unset=True)
    return update_location_rule(connection, public_id, values)


def delete_rule(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    delete_location_rule(connection, public_id)
    return {"deleted": True}


def suggest_location(connection: sqlite3.Connection, args: JsonObject) -> JsonObject:
    suggestion = suggest_default_location(
        connection,
        name=str(args.get("name") or ""),
        barcode=str(args.get("barcode") or ""),
        category=str(args.get("category") or ""),
    )
    return {"suggestion": suggestion}


def preview_consolidation(connection: sqlite3.Connection, source: int, target: int) -> JsonObject:
    return preview(connection, source, target)


def apply_consolidation(
    connection: sqlite3.Connection, source: int, target: int, token: str
) -> JsonObject:
    return consolidate(connection, source, target, token)
