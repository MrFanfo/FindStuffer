import pytest
from test_structured_features import batch, op  # noqa: F401
from test_structured_features import database as database

from findstuff.extended import apply_import_merge, import_preview
from findstuff.inventory import ConflictError, create_item, create_location, get_item
from findstuff.inventory import update_item as _update_item


def update_item(database, public_id, values):
    return _update_item(
        database,
        public_id,
        {"expected_version": get_item(database, public_id)["version"], **values},
    )


def test_nested_containers_move_and_cycle(database):
    a = create_location(database, {"name": "Drawer A", "kind": "drawer"})
    b = create_location(database, {"name": "Drawer B", "kind": "drawer"})
    outer = create_item(
        database, {"name": "Toolbox", "is_container": True, "location_public_id": a["public_id"]}
    )
    inner = create_item(
        database,
        {"name": "Screw box", "is_container": True, "container_item_id": outer["public_id"]},
    )
    screws = create_item(
        database,
        {"name": "M3x8 BHCS Screws", "quantity": 42, "container_item_id": inner["public_id"]},
    )
    assert screws["direct_location_public_id"] is None
    assert screws["location_public_id"] == a["public_id"]
    assert screws["containment_path"] == "Inside Screw box > Toolbox > Drawer A"
    update_item(database, outer["public_id"], {"location_public_id": b["public_id"]})
    assert get_item(database, screws["public_id"])["location_public_id"] == b["public_id"]
    assert get_item(database, outer["public_id"])["quantity"] == "1"
    with pytest.raises(ConflictError):
        update_item(database, outer["public_id"], {"container_item_id": inner["public_id"]})
    with pytest.raises(ConflictError):
        update_item(database, outer["public_id"], {"container_item_id": outer["public_id"]})
    moved = update_item(database, screws["public_id"], {"location_public_id": a["public_id"]})
    assert moved["container_item_id"] is None
    assert moved["direct_location_public_id"] == a["public_id"]


def test_same_batch_containment_and_validation(database):
    payload = batch(
        op("item", {"name": "Organizer", "is_container": True}),
        op("item", {"name": "M3x8", "container_item_id": "Organizer", "quantity": 12}),
    )
    preview = import_preview(payload, database)
    assert preview["valid"], preview["errors"]
    apply_import_merge(database, payload)
    child = database.execute("SELECT public_id FROM items WHERE name='M3x8'").fetchone()[0]
    assert get_item(database, child)["container_item_id"]
    bad = batch(op("item", {"name": "Bad", "container_item_id": child}))
    assert not import_preview(bad, database)["valid"]
    with pytest.raises(ValueError, match="not both"):
        create_item(
            database,
            {"name": "Bad", "container_item_id": "Organizer", "location_public_id": "somewhere"},
        )


def test_search_location_visibility_duplicate_boxes_and_split(database):
    from findstuff.inventory import location_contents
    from findstuff.inventory_query import query_inventory

    place = create_location(database, {"name": "Workbench", "kind": "shelf"})
    payload = batch(
        op(
            "item",
            {
                "name": "M3x8 organizer",
                "is_container": True,
                "location_public_id": place["public_id"],
            },
        ),
        op(
            "item",
            {
                "name": "Other organizer",
                "is_container": True,
                "location_public_id": place["public_id"],
            },
        ),
        op("item", {"name": "M3x8 Screws", "container_item_id": "M3x8 organizer", "quantity": 14}),
        op("item", {"name": "M3x8 Screws", "container_item_id": "Other organizer", "quantity": 3}),
        op("item", {"name": "Washers", "container_item_id": "M3x8 organizer", "quantity": 4}),
    )
    apply_import_merge(database, payload)
    results = query_inventory(database, query="M3x8", sort="name")
    assert results["items"][-1]["name"] == "Washers"
    assert any(row["name"] == "M3x8 Screws" for row in results["items"])
    assert len(location_contents(database, place["public_id"])["items"]) == 2
    duplicate = batch(op("item", {"name": "M3x8 Screws", "container_item_id": "Other organizer"}))
    assert not import_preview(duplicate, database)["valid"]
    split = batch(
        op(
            "item",
            {"container_item_id": "Other organizer", "quantity": 5},
            "split",
            {"name": "M3x8 Screws", "container_item_id": "M3x8 organizer"},
        ),
        duplicate_policy="merge_quantity",
    )
    preview = import_preview(split, database)
    assert preview["valid"], preview["errors"]
    apply_import_merge(database, split)
    rows = database.execute(
        "SELECT quantity_milli FROM items WHERE name='M3x8 Screws' ORDER BY quantity_milli"
    ).fetchall()
    assert [row[0] for row in rows] == [8000, 9000]


def test_containment_export_remaps_ids_and_undo_handles_unordered_rows(database, tmp_path):
    from findstuff.db import connect, migrate
    from findstuff.extended import export_inventory, undo_import_batch

    apply_import_merge(
        database,
        batch(
            op("item", {"name": "Box", "is_container": True}),
            op("item", {"name": "Parts", "container_item_id": "Box"}),
        ),
    )
    payload = export_inventory(database)
    payload["tables"]["items"].reverse()
    path = tmp_path / "restored.sqlite3"
    migrate(path)
    target = connect(path)
    try:
        result = apply_import_merge(target, payload)
        assert (
            target.execute(
                "SELECT count(*) FROM items WHERE container_item_id IS NOT NULL"
            ).fetchone()[0]
            == 1
        )
        undo_import_batch(target, result["import_public_id"])
        assert target.execute("SELECT count(*) FROM items").fetchone()[0] == 0
    finally:
        target.close()


def test_schema_three_failure_rolls_back_container_batch(database):
    payload = batch(
        op("item", {"name": "Box", "is_container": True}),
        op("item", {"name": "Bad child", "container_item_id": "Missing"}),
    )
    payload["schema_version"] = 3
    with pytest.raises(ValueError, match="Missing"):
        apply_import_merge(database, payload)
    assert database.execute("SELECT count(*) FROM items").fetchone()[0] == 0
