from __future__ import annotations

import sqlite3
from decimal import Decimal
from pathlib import Path

import pytest

from findstuff.db import connect, migrate
from findstuff.extended import (
    apply_import_merge,
    export_inventory,
    import_preview,
    list_import_batches,
    undo_import_batch,
)
from findstuff.inventory import (
    ConflictError,
    adjust_quantity,
    archive_item,
    category_contents,
    category_data_settings,
    complete_maintenance_task,
    create_category,
    create_item,
    create_item_lot,
    create_location,
    create_location_rule,
    create_maintenance_task,
    delete_category,
    delete_category_tree,
    delete_location_tree,
    find_category_id,
    item_history,
    list_categories,
    list_item_lots,
    list_items,
    list_location_tree,
    list_maintenance_tasks,
    move_item,
    save_category_data_settings,
    set_category_default_location,
    suggest_default_location,
    update_category,
    update_item,
    update_location,
)


@pytest.fixture
def database(tmp_path: Path) -> sqlite3.Connection:
    path = tmp_path / "test.sqlite3"
    migrate(path)
    connection = connect(path)
    yield connection
    connection.close()


def test_item_update_rejects_unknown_sql_columns(database: sqlite3.Connection) -> None:
    item = create_item(database, {"name": "Safe item", "quantity": Decimal("1")})
    with pytest.raises(ValueError, match="Unsupported item update field"):
        update_item(
            database,
            item["public_id"],
            {
                "name = 'changed', notes": "injected",
                "expected_version": item["version"],
            },
        )
    stored = database.execute(
        "SELECT name, notes FROM items WHERE public_id = ?", (item["public_id"],)
    ).fetchone()
    assert dict(stored) == {"name": "Safe item", "notes": ""}


def test_archived_only_lists_archived_items_including_zero_quantity(
    database: sqlite3.Connection,
) -> None:
    archived = create_item(database, {"name": "Archived cable", "quantity": Decimal("0")})
    create_item(database, {"name": "Active cable", "quantity": Decimal("1")})
    archive_item(database, archived["public_id"])

    items = list_items(database, archived_only=True, include_zero=True)

    assert [item["name"] for item in items] == ["Archived cable"]
    assert items[0]["archived_at"] is not None


def test_inventory_flow_and_search(database: sqlite3.Connection) -> None:
    home = create_location(database, {"name": "Home", "kind": "home"})
    studio = create_location(
        database,
        {"name": "Studio", "kind": "room", "parent_public_id": home["public_id"]},
    )
    drawer = create_location(
        database,
        {"name": "Drawer A", "kind": "drawer", "parent_public_id": studio["public_id"]},
    )
    item = create_item(
        database,
        {
            "name": "ESP32-C3 board",
            "description": "Tiny RISC-V development board",
            "location_public_id": drawer["public_id"],
            "quantity": Decimal("3"),
            "unit": "pcs",
            "low_stock_threshold": Decimal("1"),
            "brand": "Espressif",
        },
    )

    assert item["quantity"] == "3"
    assert item["location_path"] == "Home > Studio > Drawer A"
    assert [result["public_id"] for result in list_items(database, query="risc-v")] == [
        item["public_id"]
    ]
    assert [result["public_id"] for result in list_items(database, query="Drawer")] == [
        item["public_id"]
    ]

    adjusted = adjust_quantity(database, item["public_id"], Decimal("-1"), item["version"])
    assert adjusted["quantity"] == "2"
    moved = move_item(database, adjusted["public_id"], studio["public_id"], adjusted["version"])
    assert moved["location_path"] == "Home > Studio"
    assert [event["action"] for event in item_history(database, item["public_id"])] == [
        "move",
        "adjust_quantity",
        "create",
    ]


def test_zero_quantity_items_are_hidden_unless_requested(database: sqlite3.Connection) -> None:
    item = create_item(database, {"name": "Last fuse", "quantity": 1})
    adjusted = adjust_quantity(database, item["public_id"], Decimal("-1"), item["version"])

    assert adjusted["quantity"] == "0"
    assert list_items(database, query="Last fuse") == []
    assert [
        entry["public_id"] for entry in list_items(database, query="Last fuse", include_zero=True)
    ] == [item["public_id"]]


def test_location_cycles_and_negative_quantity_are_rejected(
    database: sqlite3.Connection,
) -> None:
    parent = create_location(database, {"name": "Parent"})
    child = create_location(database, {"name": "Child", "parent_public_id": parent["public_id"]})
    with pytest.raises(ConflictError):
        update_location(database, parent["public_id"], {"parent_public_id": child["public_id"]})

    item = create_item(
        database,
        {"name": "One thing", "location_public_id": child["public_id"], "quantity": 1},
    )
    with pytest.raises(ConflictError):
        adjust_quantity(database, item["public_id"], Decimal("-2"), item["version"])


def test_location_tree_includes_direct_and_nested_item_counts(database: sqlite3.Connection) -> None:
    room = create_location(database, {"name": "Count room"})
    shelf = create_location(
        database, {"name": "Count shelf", "parent_public_id": room["public_id"]}
    )
    create_item(database, {"name": "Room item", "location_public_id": room["public_id"]})
    create_item(database, {"name": "Shelf item", "location_public_id": shelf["public_id"]})

    tree = list_location_tree(database)
    room_node = next(node for node in tree if node["public_id"] == room["public_id"])
    shelf_node = room_node["children"][0]

    assert room_node["item_count"] == 1
    assert room_node["total_item_count"] == 2
    assert shelf_node["item_count"] == 1
    assert shelf_node["total_item_count"] == 1


def test_category_hierarchy_paths_search_and_default_rules(database: sqlite3.Connection) -> None:
    categories = list_categories(database)
    components = next(
        category for category in categories if category["slug"] == "electronics-components"
    )
    sensors = create_category(database, "Sensors", components["id"])
    drawer = create_location(database, {"name": "Parts drawer", "kind": "drawer"})
    create_location_rule(
        database,
        {
            "rule_type": "category",
            "match_value": "Electronics",
            "location_public_id": drawer["public_id"],
            "priority": 200,
        },
    )
    item = create_item(
        database,
        {
            "name": "Hall sensor",
            "category_id": sensors["id"],
            "location_public_id": "unassigned",
            "quantity": 5,
        },
    )

    assert sensors["path"] == "Electronics > Components > Sensors"
    assert item["category_path"] == sensors["path"]
    assert find_category_id(database, sensors["path"]) == sensors["id"]
    assert [result["public_id"] for result in list_items(database, query="Components")] == [
        item["public_id"]
    ]
    suggestion = suggest_default_location(
        database, name=item["name"], category=item["category_path"]
    )
    assert suggestion is not None
    assert suggestion["public_id"] == drawer["public_id"]

    refreshed_categories = {category["slug"]: category for category in list_categories(database)}
    assert refreshed_categories["electronics"]["default_location"] == {
        "public_id": drawer["public_id"],
        "name": "Parts drawer",
    }
    assert refreshed_categories["electronics"]["total_item_count"] == 1
    assert refreshed_categories["electronics-components"]["total_item_count"] == 1
    assert refreshed_categories[sensors["slug"]]["item_count"] == 1


def test_default_location_rules_use_most_specific_match(database: sqlite3.Connection) -> None:
    groceries = next(
        category for category in list_categories(database) if category["slug"] == "groceries"
    )
    nuts = create_category(database, "Nuts", groceries["id"])
    pecans = create_category(database, "Pecans", nuts["id"])
    pantry = create_location(database, {"name": "Pantry", "kind": "cabinet"})
    nut_drawer = create_location(database, {"name": "Nut drawer", "kind": "drawer"})
    pecan_box = create_location(database, {"name": "Pecan box", "kind": "box"})
    named_box = create_location(database, {"name": "Named item box", "kind": "box"})
    for match, location, priority in (
        ("Groceries", pantry, 999),
        ("Groceries > Nuts", nut_drawer, 10),
        ("Groceries > Nuts > Pecans", pecan_box, 1),
    ):
        create_location_rule(
            database,
            {
                "rule_type": "category",
                "match_value": match,
                "location_public_id": location["public_id"],
                "priority": priority,
            },
        )

    suggestion = suggest_default_location(database, name="Plain pecans", category=pecans["path"])
    assert suggestion is not None
    assert suggestion["public_id"] == pecan_box["public_id"]

    create_location_rule(
        database,
        {
            "rule_type": "name",
            "match_value": "roasted pecans",
            "location_public_id": named_box["public_id"],
            "priority": 1,
        },
    )
    suggestion = suggest_default_location(database, name="Roasted pecans", category=pecans["path"])
    assert suggestion is not None
    assert suggestion["public_id"] == named_box["public_id"]


def test_category_data_capabilities_defaults_and_overrides(
    database: sqlite3.Connection,
) -> None:
    categories = list_categories(database)
    groceries = next(category for category in categories if category["slug"] == "groceries")
    tools = next(category for category in categories if category["slug"] == "tools")

    assert groceries["capabilities"]["expiration"] is True
    assert groceries["capabilities"]["maintenance"] is False
    assert groceries["capabilities"]["reservation"] is False
    assert tools["capabilities"]["maintenance"] is True
    assert tools["capabilities"]["reservation"] is True

    saved = save_category_data_settings(
        database,
        {str(groceries["id"]): {"maintenance": True, "reservation": True, "specs": True}},
    )

    assert saved["overrides"][str(groceries["id"])] == {
        "maintenance": True,
        "reservation": True,
        "specs": True,
    }
    refreshed = category_data_settings(database)
    assert refreshed["resolved"][str(groceries["id"])]["maintenance"] is True
    assert refreshed["resolved"][str(groceries["id"])]["specs"] is True


def test_category_move_delete_and_subtree_filter(database: sqlite3.Connection) -> None:
    parent = create_category(database, "Lab")
    sibling = create_category(database, "Workshop supplies")
    child = create_category(database, "Sensors", parent["id"])
    empty_child = create_category(database, "Adapters", parent["id"])
    item = create_item(
        database,
        {
            "name": "IR distance sensor",
            "category_id": child["id"],
            "location_public_id": "unassigned",
            "quantity": 2,
        },
    )

    renamed = update_category(
        database,
        child["id"],
        {"name": "Distance sensors", "parent_id": sibling["id"]},
    )

    assert renamed["path"] == "Workshop supplies > Distance sensors"
    assert [result["public_id"] for result in list_items(database, category_id=sibling["id"])] == [
        item["public_id"]
    ]
    assert list_items(database, category_id=parent["id"]) == []

    with pytest.raises(ConflictError):
        update_category(database, sibling["id"], {"parent_id": child["id"]})
    with pytest.raises(ConflictError):
        delete_category(database, child["id"])

    delete_category(database, empty_child["id"])
    assert empty_child["id"] not in {category["id"] for category in list_categories(database)}


def test_category_defaults_contents_and_tree_delete(database: sqlite3.Connection) -> None:
    parent = create_category(database, "Machines")
    child = create_category(database, "Printers", parent["id"])
    drawer = create_location(database, {"name": "Printer cabinet", "kind": "cabinet"})
    set_category_default_location(database, parent["id"], drawer["public_id"])
    item = create_item(
        database,
        {
            "name": "Nozzle kit",
            "category_id": child["id"],
            "location_public_id": "unassigned",
            "quantity": 1,
        },
    )

    child_category = next(
        category for category in list_categories(database) if category["id"] == child["id"]
    )
    assert child_category["default_location"] == {
        "public_id": drawer["public_id"],
        "name": "Printer cabinet",
    }

    contents = category_contents(database, parent["id"])
    assert contents["children"][0]["id"] == child["id"]
    assert [entry["public_id"] for entry in contents["items"]] == [item["public_id"]]

    delete_category_tree(database, parent["id"])
    assert parent["id"] not in {category["id"] for category in list_categories(database)}
    assert list_items(database, query="Nozzle kit", include_zero=True)[0]["category_id"] is None


def test_location_tree_delete_archives_contained_items(database: sqlite3.Connection) -> None:
    room = create_location(database, {"name": "Temporary room"})
    box = create_location(
        database, {"name": "Temporary box", "parent_public_id": room["public_id"]}
    )
    item = create_item(
        database,
        {"name": "Temporary jig", "location_public_id": box["public_id"], "quantity": 1},
    )

    delete_location_tree(database, room["public_id"])

    assert all(node["public_id"] != room["public_id"] for node in list_location_tree(database))
    assert list_items(database, query=item["name"]) == []
    archived = database.execute(
        "SELECT archived_at FROM items WHERE public_id = ?", (item["public_id"],)
    ).fetchone()
    assert archived["archived_at"] is not None


def test_operations_import_adds_modifies_and_deletes_inventory(
    database: sqlite3.Connection,
) -> None:
    payload = {
        "format": "findstuff-ops-v1",
        "operations": [
            {"op": "add", "type": "category", "data": {"name": "Workbench supplies"}},
            {
                "op": "add",
                "type": "category",
                "data": {"name": "Precision driver tools", "parent": "Workbench supplies"},
            },
            {
                "op": "modify",
                "type": "category",
                "match": {"path": "Workbench supplies > Precision driver tools"},
                "data": {"name": "Small tools"},
            },
            {"op": "add", "type": "category", "data": {"name": "Temporary category"}},
            {"op": "deleted", "type": "category", "match": {"name": "Temporary category"}},
            {"op": "add", "type": "location", "data": {"name": "Workshop", "kind": "room"}},
            {
                "op": "add",
                "type": "location",
                "data": {"name": "Cabinet", "kind": "cabinet", "parent": "Workshop"},
            },
            {
                "op": "modify",
                "type": "location",
                "match": {"path": "Workshop > Cabinet"},
                "data": {"name": "Cabinet A", "description": "Small parts"},
            },
            {"op": "add", "type": "location", "data": {"name": "Temporary bin"}},
            {"op": "delete", "type": "location", "match": {"name": "Temporary bin"}},
            {
                "op": "add",
                "type": "item",
                "data": {
                    "name": "Screwdriver",
                    "location": "Workshop > Cabinet A",
                    "category": "Workbench supplies > Small tools",
                    "quantity": "2",
                    "unit": "pcs",
                    "tags": ["workbench", "hand tool"],
                },
            },
            {
                "op": "modify",
                "type": "item",
                "match": {"name": "Screwdriver"},
                "data": {"quantity": "3", "tags": ["ready"]},
            },
            {"op": "deleted", "type": "item", "match": {"name": "Screwdriver"}},
        ],
    }

    preview = import_preview(payload)
    assert preview["valid"] is True
    assert preview["counts"]["operations"] == 13

    result = apply_import_merge(database, payload)

    assert result["mode"] == "operations"
    assert result["created"]["add"] == 7
    assert result["created"]["modify"] == 3
    assert result["created"]["delete"] == 3
    categories = {category["path"] for category in list_categories(database)}
    assert "Workbench supplies > Small tools" in categories
    assert "Temporary category" not in categories
    archived = [
        item
        for item in list_items(database, include_archived=True)
        if item["name"] == "Screwdriver"
    ]
    assert len(archived) == 1
    assert archived[0]["quantity"] == "3"
    assert archived[0]["tags"] == ["ready"]
    assert archived[0]["archived_at"] is not None
    assert list_items(database, query="Screwdriver") == []


def test_category_and_location_names_are_unique_only_within_the_same_parent(
    database: sqlite3.Connection,
) -> None:
    category_a = create_category(database, "Workshop A")
    category_b = create_category(database, "Workshop B")
    consumables_a = create_category(database, "Consumables", category_a["id"])
    consumables_b = create_category(database, "consumables", category_b["id"])

    assert find_category_id(database, "Workshop A > Consumables") == consumables_a["id"]
    assert find_category_id(database, "Workshop B > consumables") == consumables_b["id"]
    with pytest.raises(ConflictError, match="ambiguous"):
        find_category_id(database, "Consumables")
    with pytest.raises(ConflictError, match="already exists here"):
        create_category(database, "CONSUMABLES", category_a["id"])

    room_a = create_location(database, {"name": "Room A"})
    room_b = create_location(database, {"name": "Room B"})
    drawer_a = create_location(
        database, {"name": "Drawer", "parent_public_id": room_a["public_id"]}
    )
    create_location(
        database, {"name": "drawer", "parent_public_id": room_b["public_id"]}
    )
    with pytest.raises(ConflictError, match="already exists here"):
        create_location(
            database, {"name": "DRAWER", "parent_public_id": room_a["public_id"]}
        )
    with pytest.raises(ConflictError, match="already exists here"):
        update_location(
            database,
            drawer_a["public_id"],
            {"parent_public_id": room_b["public_id"]},
        )
    create_location(database, {"name": "Unique root"})
    with pytest.raises(ConflictError, match="already exists here"):
        create_location(database, {"name": "unique ROOT"})


def test_operations_import_allows_repeated_leaf_names_in_different_subtrees(
    database: sqlite3.Connection,
) -> None:
    payload = {
        "format": "findstuff-ops-v1",
        "operations": [
            {"op": "add", "type": "category", "data": {"name": "Electrical"}},
            {"op": "add", "type": "category", "data": {"name": "Plumbing"}},
            {
                "op": "add",
                "type": "category",
                "data": {"name": "Consumables", "parent": "Electrical"},
            },
            {
                "op": "add",
                "type": "category",
                "data": {"name": "Consumables", "parent": "Plumbing"},
            },
            {"op": "add", "type": "location", "data": {"name": "Garage", "kind": "room"}},
            {"op": "add", "type": "location", "data": {"name": "Studio", "kind": "room"}},
            {"op": "add", "type": "location", "data": {"name": "Drawer", "parent": "Garage"}},
            {"op": "add", "type": "location", "data": {"name": "Drawer", "parent": "Studio"}},
        ],
    }

    preview = import_preview(payload, database)
    assert preview["valid"] is True
    assert all(detail["status"] == "add" for detail in preview["details"])
    result = apply_import_merge(database, payload)
    assert result["valid"] is True
    assert {entry["path"] for entry in list_categories(database)} >= {
        "Electrical > Consumables",
        "Plumbing > Consumables",
    }
    location_paths = {
        child["path"]
        for root in list_location_tree(database)
        for child in root["children"]
    }
    assert location_paths >= {"Garage > Drawer", "Studio > Drawer"}

    ambiguous_item = {
        "format": "findstuff-ops-v1",
        "operations": [
            {
                "op": "add",
                "type": "item",
                "data": {
                    "name": "Ambiguous import item",
                    "category": "Consumables",
                    "location": "Garage > Drawer",
                },
            }
        ],
    }
    ambiguous_preview = import_preview(ambiguous_item, database)
    assert ambiguous_preview["valid"] is False
    assert "ambiguous" in ambiguous_preview["errors"][0].lower()

    ambiguous_item["operations"][0]["data"]["category"] = "Electrical > Consumables"
    assert import_preview(ambiguous_item, database)["valid"] is True


def test_operations_import_sets_and_carries_category_default_location(
    database: sqlite3.Connection,
) -> None:
    shelf = create_location(database, {"name": "Shelf A"})
    payload = {
        "format": "findstuff-ops-v1",
        "operations": [
            {
                "op": "add",
                "type": "category",
                "data": {"name": "Ops import cables", "default_location": "Shelf A"},
            },
            {
                "op": "modify",
                "type": "category",
                "match": {"name": "Ops import cables"},
                "data": {"name": "Ops import USB cables"},
            },
        ],
    }

    apply_import_merge(database, payload)

    category = next(
        category
        for category in list_categories(database)
        if category["name"] == "Ops import USB cables"
    )
    assert category["default_location"] == {"public_id": shelf["public_id"], "name": "Shelf A"}
    assert (
        database.execute(
            "SELECT match_value FROM location_rules WHERE rule_type = 'category'"
        ).fetchone()["match_value"]
        == "Ops import USB cables"
    )

    clear_payload = {
        "format": "findstuff-ops-v1",
        "operations": [
            {
                "op": "modify",
                "type": "category",
                "match": {"name": "Ops import USB cables"},
                "data": {"default_location": None},
            }
        ],
    }

    apply_import_merge(database, clear_payload)
    category = next(
        category
        for category in list_categories(database)
        if category["name"] == "Ops import USB cables"
    )
    assert category["default_location"] is None


def test_operations_import_sets_category_metadata_flags(
    database: sqlite3.Connection,
) -> None:
    payload = {
        "format": "findstuff-ops-v1",
        "operations": [
            {
                "op": "add",
                "type": "category",
                "data": {
                    "name": "Ops metadata category",
                    "metadata_enabled": {
                        "expiration": True,
                        "batches": True,
                        "maintenance": False,
                        "reservation": False,
                        "enrichment": True,
                        "photos": True,
                        "identity": True,
                        "specs": False,
                        "price": True,
                        "links": True,
                    },
                },
            },
            {
                "op": "modify",
                "type": "category",
                "match": {"name": "Ops metadata category"},
                "data": {"metadata_enabled": {"expiration": False, "links": True}},
            },
        ],
    }

    preview = import_preview(payload, database)

    assert preview["valid"] is True

    apply_import_merge(database, payload)

    category = next(
        category
        for category in list_categories(database)
        if category["name"] == "Ops metadata category"
    )
    overrides = category_data_settings(database)["overrides"][str(category["id"])]
    assert overrides == {"expiration": False, "links": True}


def test_operations_import_rejects_invalid_category_metadata_flags(
    database: sqlite3.Connection,
) -> None:
    payload = {
        "format": "findstuff-ops-v1",
        "operations": [
            {
                "op": "add",
                "type": "category",
                "data": {
                    "name": "Ops invalid metadata category",
                    "metadata_enabled": {"expiration": "yes"},
                },
            },
        ],
    }

    preview = import_preview(payload, database)

    assert preview["valid"] is False
    assert "must be true or false" in preview["errors"][0]


def test_operations_import_skips_duplicate_adds_and_reports_detailed_errors(
    database: sqlite3.Connection,
) -> None:
    create_category(database, "Ops duplicate category")
    create_location(database, {"name": "Ops duplicate room", "kind": "room"})
    payload = {
        "format": "findstuff-ops-v1",
        "operations": [
            {
                "op": "add",
                "type": "category",
                "data": {"name": "Ops duplicate category"},
            },
            {
                "op": "add",
                "type": "location",
                "data": {"name": "Ops duplicate room", "kind": "room"},
            },
            {
                "op": "modify",
                "type": "item",
                "match": {"name": "Missing imported item"},
                "data": {"quantity": "2"},
            },
            {
                "op": "add",
                "type": "category",
                "data": {"name": "Ops after error"},
            },
        ],
    }

    preview = import_preview(payload, database)

    assert preview["valid"] is False
    assert [detail["status"] for detail in preview["details"]] == [
        "skip",
        "skip",
        "error",
        "add",
    ]
    assert "Category already exists" in preview["details"][0]["message"]
    assert "Location already exists" in preview["details"][1]["message"]
    assert "Item not found by name: Missing imported item" in preview["errors"][0]

    result = apply_import_merge(database, payload)

    assert result["valid"] is False
    assert result["created"]["skipped"] == 2
    assert result["created"]["add"] == 1
    assert len(result["errors"]) == 1
    assert "Operation #3 (modify item) [Missing imported item]" in result["errors"][0]
    assert "Item not found by name: Missing imported item" in result["errors"][0]
    assert any(category["name"] == "Ops after error" for category in list_categories(database))


def test_operations_import_rejects_duplicate_item_add_by_name_and_category(
    database: sqlite3.Connection,
) -> None:
    tools = create_category(database, "Duplicate import tools")
    create_item(
        database,
        {
            "name": "Already here",
            "category_id": tools["id"],
            "quantity": Decimal("1"),
        },
    )
    payload = {
        "format": "findstuff-ops-v1",
        "operations": [
            {
                "op": "add",
                "type": "item",
                "data": {
                    "name": "Already here",
                    "category": "Duplicate import tools",
                    "quantity": "4",
                },
            }
        ],
    }

    preview = import_preview(payload, database)

    assert preview["valid"] is False
    assert preview["details"][0]["status"] == "error"
    assert "Duplicate item by name and category" in preview["details"][0]["message"]

    result = apply_import_merge(database, payload)

    assert result["valid"] is False
    assert result["created"]["items"] == 0
    assert "Item already exists with this name and category" in result["errors"][0]
    matching = [item for item in list_items(database) if item["name"] == "Already here"]
    assert len(matching) == 1
    assert matching[0]["quantity"] == "1"


def test_operations_import_can_adjust_quantity_by_delta(database: sqlite3.Connection) -> None:
    item = create_item(database, {"name": "Delta import bolts", "quantity": Decimal("5")})
    payload = {
        "format": "findstuff-ops-v1",
        "operations": [
            {
                "op": "modify",
                "type": "item",
                "match": {"public_id": item["public_id"]},
                "data": {"add_quantity": "3"},
            },
            {
                "op": "modify",
                "type": "item",
                "match": {"public_id": item["public_id"]},
                "data": {"remove_quantity": "2"},
            },
        ],
    }

    result = apply_import_merge(database, payload)

    assert result["valid"] is True
    assert list_items(database, query="Delta import bolts")[0]["quantity"] == "6"


def test_operations_import_can_be_undone(database: sqlite3.Connection) -> None:
    payload = {
        "format": "findstuff-ops-v1",
        "operations": [
            {"op": "add", "type": "location", "data": {"name": "Undo shelf"}},
            {"op": "add", "type": "category", "data": {"name": "Undo tools"}},
            {
                "op": "add",
                "type": "item",
                "data": {
                    "name": "Undo wrench",
                    "location": "Undo shelf",
                    "category": "Undo tools",
                    "quantity": "1",
                },
            },
        ],
    }

    result = apply_import_merge(database, payload)

    assert result["valid"] is True
    batch_id = result["import_public_id"]
    assert list_import_batches(database)[0]["public_id"] == batch_id
    assert any(item["name"] == "Undo wrench" for item in list_items(database))

    undone = undo_import_batch(database, batch_id)

    assert undone["undone"] is True
    assert not any(
        item["name"] == "Undo wrench" for item in list_items(database, include_archived=True)
    )
    assert not any(category["name"] == "Undo tools" for category in list_categories(database))
    assert not any(location["name"] == "Undo shelf" for location in list_location_tree(database))
    assert list_import_batches(database)[0]["undone_at"] is not None


def test_import_history_keeps_only_latest_five(database: sqlite3.Connection) -> None:
    for index in range(7):
        result = apply_import_merge(
            database,
            {
                "format": "findstuff-ops-v1",
                "operations": [
                    {
                        "op": "add",
                        "type": "item",
                        "data": {"name": f"Retained import item {index}", "quantity": "1"},
                    }
                ],
            },
        )
        assert result["import_public_id"]

    batches = list_import_batches(database)

    assert len(batches) == 5
    assert database.execute("SELECT count(*) FROM import_batches").fetchone()[0] == 5


def test_export_merge_import_can_be_undone(tmp_path: Path) -> None:
    source_path = tmp_path / "source.sqlite3"
    target_path = tmp_path / "target.sqlite3"
    migrate(source_path)
    source = connect(source_path)
    create_item(source, {"name": "Undo imported meter", "quantity": Decimal("1")})
    exported = export_inventory(source)
    source.close()
    migrate(target_path)
    target = connect(target_path)
    try:
        result = apply_import_merge(target, exported)
        batch_id = result["import_public_id"]
        assert result["created"]["items"] == 1

        undo_import_batch(target, batch_id)

        assert not any(
            item["name"] == "Undo imported meter"
            for item in list_items(target, include_archived=True)
        )
    finally:
        target.close()


def test_expiration_lots_roll_up_and_adjust_fifo(database: sqlite3.Connection) -> None:
    pantry = create_location(database, {"name": "Pantry"})
    milk = create_item(
        database,
        {
            "name": "Milk",
            "location_public_id": pantry["public_id"],
            "quantity": Decimal("1"),
            "unit": "pcs",
            "expiration_date": "2026-07-10",
        },
    )
    create_item_lot(
        database,
        milk["public_id"],
        {
            "quantity": Decimal("1"),
            "expiration_date": "2026-07-20",
            "note": "Second bottle",
        },
    )

    refreshed = list_items(database, query="Milk")[0]
    assert refreshed["quantity"] == "2"
    assert refreshed["expiration_date"] == "2026-07-10"
    assert [lot["expiration_date"] for lot in list_item_lots(database, milk["public_id"])] == [
        "2026-07-10",
        "2026-07-20",
    ]

    adjusted = adjust_quantity(database, milk["public_id"], Decimal("-1"), refreshed["version"])
    assert adjusted["quantity"] == "1"
    assert adjusted["expiration_date"] == "2026-07-20"
    lots = list_item_lots(database, milk["public_id"])
    assert len(lots) == 1
    assert lots[0]["expiration_date"] == "2026-07-20"


def test_maintenance_task_completion_reschedules(database: sqlite3.Connection) -> None:
    workshop = create_location(database, {"name": "Workshop"})
    printer = create_item(
        database,
        {
            "name": "3D printer",
            "location_public_id": workshop["public_id"],
            "quantity": 1,
            "unit": "pcs",
        },
    )
    task = create_maintenance_task(
        database,
        printer["public_id"],
        {
            "title": "Lube rails",
            "notes": "Use light machine oil",
            "interval_days": 30,
            "last_completed_at": None,
            "next_due_at": "2026-07-01",
        },
    )

    completed = complete_maintenance_task(database, printer["public_id"], task["public_id"])

    assert completed["last_completed_at"] is not None
    assert completed["next_due_at"] > completed["last_completed_at"]
    assert list_maintenance_tasks(database, printer["public_id"])[0]["title"] == "Lube rails"
