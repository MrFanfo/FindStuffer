from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from findstuff.db import connect, migrate
from findstuff.extended import apply_import_merge, export_inventory, import_preview
from findstuff.inventory import list_categories, list_location_tree, update_location
from findstuff.operations_contract import operations_template


def _database(path: Path) -> sqlite3.Connection:
    migrate(path)
    return connect(path)


@pytest.fixture
def database(tmp_path: Path) -> sqlite3.Connection:
    connection = _database(tmp_path / "icons.sqlite3")
    yield connection
    connection.close()


def batch(*operations):
    return {"format": "findstuff-ops-v1", "schema_version": 3, "operations": list(operations)}


def _category_icon(connection: sqlite3.Connection, name: str) -> str:
    return next(c["icon"] for c in list_categories(connection) if c["name"] == name)


def _place(connection: sqlite3.Connection, name: str) -> dict:
    return next(node for node in list_location_tree(connection) if node["name"] == name)


def test_operations_set_and_change_icons_for_categories_and_places(database) -> None:
    apply_import_merge(
        database,
        batch(
            {"op": "add", "type": "category", "data": {"name": "Boards", "icon": "chip"}},
            {"op": "add", "type": "location", "data": {"name": "Kitchen", "icon": "home"}},
        ),
    )
    assert _category_icon(database, "Boards") == "chip"
    assert _place(database, "Kitchen")["icon"] == "home"

    apply_import_merge(
        database,
        batch(
            {
                "op": "modify",
                "type": "category",
                "match": {"name": "Boards"},
                "data": {"icon": "plug"},
            },
            {
                "op": "modify",
                "type": "location",
                "match": {"name": "Kitchen"},
                "data": {"icon": ""},
            },
        ),
    )
    assert _category_icon(database, "Boards") == "plug"
    assert _place(database, "Kitchen")["icon"] == "", "an empty icon clears it"


def test_an_icon_the_app_cannot_draw_is_refused(database) -> None:
    preview = import_preview(
        batch({"op": "add", "type": "category", "data": {"name": "Odd", "icon": "<svg>"}}),
        database,
    )
    assert not preview["valid"]


def test_the_template_offers_icons_for_categories_and_places(database) -> None:
    template = operations_template(database)
    assert "icon" in template["_field_definitions"]["category"]
    assert "icon" in template["_field_definitions"]["location"]
    assert "icon" in template["_schemas"]["location"]["modify"]["allowed_fields"]
    assert "_available_category_icons" in template


def test_a_full_export_brings_the_icons_back(database, tmp_path: Path) -> None:
    apply_import_merge(
        database,
        batch(
            {"op": "add", "type": "category", "data": {"name": "Boards", "icon": "chip"}},
            {"op": "add", "type": "location", "data": {"name": "Garage", "icon": "car"}},
        ),
    )
    exported = export_inventory(database)
    fresh = _database(tmp_path / "fresh.sqlite3")
    try:
        apply_import_merge(fresh, exported)
        assert _category_icon(fresh, "Boards") == "chip"
        assert _place(fresh, "Garage")["icon"] == "car"
    finally:
        fresh.close()


def test_an_icon_chosen_here_is_not_overwritten_by_an_import(database, tmp_path: Path) -> None:
    apply_import_merge(
        database,
        batch({"op": "add", "type": "location", "data": {"name": "Garage", "icon": "car"}}),
    )
    exported = export_inventory(database)
    garage = _place(database, "Garage")
    update_location(database, garage["public_id"], {"icon": "wrench"})
    apply_import_merge(database, exported)
    assert _place(database, "Garage")["icon"] == "wrench"
