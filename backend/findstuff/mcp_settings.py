"""Non-secret inventory settings and product-category mappings for MCP."""

from __future__ import annotations

import asyncio
import sqlite3
from typing import Any

from .inventory import save_category_data_settings
from .off_categories import (
    import_mappings,
    set_mapping,
)
from .schemas import (
    CategoryDataSettingsUpdate,
    InventoryDisplaySettingsUpdate,
    OffCategoryMappingUpdate,
    UnitSettingsUpdate,
)

JsonObject = dict[str, Any]


def public_settings(connection: sqlite3.Connection) -> JsonObject:
    from .app import get_application_settings

    return asyncio.run(get_application_settings(connection))


def units(connection: sqlite3.Connection) -> JsonObject:
    from .app import inventory_units

    return {"units": inventory_units(connection)}


def save_units(connection: sqlite3.Connection, args: JsonObject) -> JsonObject:
    from .app import save_inventory_units

    values = UnitSettingsUpdate.model_validate(args)
    return {"units": save_inventory_units(connection, values.units)}


def save_category_data(connection: sqlite3.Connection, args: JsonObject) -> JsonObject:
    values = CategoryDataSettingsUpdate.model_validate(args)
    return save_category_data_settings(connection, values.overrides)


def save_inventory_display(connection: sqlite3.Connection, args: JsonObject) -> JsonObject:
    from .app import save_inventory_display_settings

    values = InventoryDisplaySettingsUpdate.model_validate(args)
    return save_inventory_display_settings(connection, values.model_dump())


def set_off_mapping(connection: sqlite3.Connection, tag: str, args: JsonObject) -> JsonObject:
    values = OffCategoryMappingUpdate.model_validate({"category_id": args["category_id"]})
    return set_mapping(connection, tag, values.category_id)


def import_off_mappings(
    connection: sqlite3.Connection, payload: JsonObject, apply: bool
) -> JsonObject:
    return import_mappings(connection, payload, apply=apply)
