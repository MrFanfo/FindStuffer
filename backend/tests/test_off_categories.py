from __future__ import annotations

from pathlib import Path

from findstuff.db import connect, migrate
from findstuff.inventory import (
    create_category,
    create_item,
    create_location,
    list_categories,
    set_category_default_location,
)
from findstuff.off_categories import (
    FORMAT,
    export_mappings,
    import_mappings,
    items_for_category,
    list_mappings,
    observe_categories,
    resolve_category,
    set_mapping,
)


def test_observed_off_categories_can_be_explicitly_mapped(tmp_path: Path) -> None:
    path = tmp_path / "off.sqlite3"
    migrate(path)
    connection = connect(path)
    try:
        groceries = next(
            category for category in list_categories(connection) if category["slug"] == "groceries"
        )
        nuts = create_category(connection, "Nuts", groceries["id"])
        pecans = create_category(connection, "Pecan nuts", nuts["id"])
        shelf = create_location(connection, {"name": "Nut shelf", "kind": "shelf"})
        set_category_default_location(connection, pecans["id"], shelf["public_id"])

        observe_categories(connection, ["en:nuts", "en:pecan-nuts"], "8000000000000")
        item = create_item(
            connection,
            {"name": "Pecan nuts", "barcode": "8000000000000", "category_id": pecans["id"]},
        )
        automatic = resolve_category(connection, ["en:nuts", "en:pecan-nuts"])
        assert automatic is not None
        assert automatic["id"] == pecans["id"]
        assert automatic["default_location"]["public_id"] == shelf["public_id"]

        set_mapping(connection, "en:pecan-nuts", nuts["id"])
        explicit = resolve_category(connection, ["en:nuts", "en:pecan-nuts"])
        assert explicit is not None
        assert explicit["source"] == "explicit"
        assert explicit["id"] == nuts["id"]

        listed = list_mappings(connection)["mappings"]
        pecan_mapping = next(entry for entry in listed if entry["off_tag"] == "en:pecan-nuts")
        assert pecan_mapping["mapping_source"] == "explicit"
        assert pecan_mapping["scan_count"] == 1
        item_ids = [
            entry["public_id"] for entry in items_for_category(connection, "en:pecan-nuts")
        ]
        assert item_ids == [item["public_id"]]
        assert all(entry["off_tag"] != "en:nuts" for entry in listed)
    finally:
        connection.close()


def test_off_category_mapping_export_preview_and_import(tmp_path: Path) -> None:
    path = tmp_path / "off-import.sqlite3"
    migrate(path)
    connection = connect(path)
    try:
        groceries = next(
            category for category in list_categories(connection) if category["slug"] == "groceries"
        )
        nuts = create_category(connection, "Nuts", groceries["id"])
        observe_categories(connection, ["en:nuts", "en:pecan-nuts"], "8000000000000")
        exported = export_mappings(connection)
        assert exported["format"] == FORMAT
        assert any(category["path"] == nuts["path"] for category in exported["our_categories"])

        for mapping in exported["mappings"]:
            if mapping["off_tag"] == "en:pecan-nuts":
                mapping["assigned_category_path"] = nuts["path"]
        preview = import_mappings(connection, exported)
        assert preview["errors"] == 0
        assert preview["applied"] == 0
        applied = import_mappings(connection, exported, apply=True)
        assert applied["applied"] == 1
        resolved = resolve_category(connection, ["en:pecan-nuts"])
        assert resolved is not None
        assert resolved["id"] == nuts["id"]
    finally:
        connection.close()
