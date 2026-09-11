from pathlib import Path

import pytest

from findstuff.compatibility import effective_compatibility, resolve_target
from findstuff.custom_fields import category_fields
from findstuff.db import connect, migrate
from findstuff.extended import apply_import_merge, import_preview, undo_import_batch
from findstuff.inventory import get_item, get_item_row, list_categories
from findstuff.projects import acquired_to_inventory, project_detail


@pytest.fixture
def database(tmp_path: Path):
    path = tmp_path / "features.sqlite3"
    migrate(path)
    db = connect(path)
    yield db
    db.close()


def op(entity, data, action="add", match=None):
    return {"op": action, "type": entity, "data": data, **({"match": match} if match else {})}


def batch(*operations, **options):
    return {
        "format": "findstuff-ops-v1",
        "schema_version": 2,
        "operations": list(operations),
        **options,
    }


def setup_features(database):
    payload = batch(
        op("category", {"name": "Hardware"}),
        op("category", {"name": "Nozzles", "parent": "Hardware"}),
        op(
            "category_field",
            {
                "category": "Hardware",
                "key": "diameter",
                "label": "Diameter",
                "type": "decimal",
                "unit": "mm",
                "constraints": {"min": 0, "max": 10},
            },
        ),
        op("compatibility_target", {"name": "Voron family", "aliases": ["Voron printers"]}),
        op("compatibility_target", {"name": "Voron 2.4", "parent": "Voron family"}),
        op("project", {"name": "Toolhead Upgrade", "compatibility": ["Voron 2.4"]}),
        op(
            "item",
            {
                "name": "Nozzle",
                "quantity": 3,
                "category": "Hardware > Nozzles",
                "custom_fields": {"diameter": 0.4},
                "compatibility": [{"target": "Voron family", "status": "compatible"}],
            },
        ),
        op(
            "project_requirement",
            {
                "project": "Toolhead Upgrade",
                "name": "Nozzle",
                "item": "Nozzle",
                "required_quantity": 10,
                "inventory_quantity": 3,
                "acquired_quantity": 4,
            },
        ),
    )
    preview = import_preview(payload, database)
    assert preview["valid"], preview["errors"]
    assert not database.execute("SELECT 1 FROM projects").fetchone()
    result = apply_import_merge(database, payload)
    return result


def test_same_batch_entities_project_quantities_and_inventory_link(database):
    setup_features(database)
    project = project_detail(database, "Toolhead Upgrade")
    requirement = project["requirements"][0]
    assert requirement["inventory_quantity_available"] == "3"
    assert requirement["acquired_quantity"] == "4"
    assert requirement["missing_quantity"] == "3"
    assert project["progress"]["percent"] == 70
    assert requirement["compatibility_results"][0]["inherited"]
    assert requirement["compatibility_results"][0]["status"] == "compatible"
    change = batch(
        op(
            "project_requirement",
            {"purchased_quantity": 3},
            "modify",
            {"public_id": requirement["public_id"]},
        )
    )
    apply_import_merge(database, change)
    apply_import_merge(database, change)
    requirement = project_detail(database, "Toolhead Upgrade")["requirements"][0]
    assert requirement["missing_quantity"] == "3"  # Ordered is not physically acquired.
    assert requirement["to_buy_quantity"] == "0"
    assert database.execute("SELECT quantity_milli FROM items").fetchone()[0] == 3000


def test_acquired_stock_conversion_does_not_double_count_and_is_retry_safe(database):
    setup_features(database)
    requirement = project_detail(database, "Toolhead Upgrade")["requirements"][0]
    request = {
        "request_id": "stock-request-123",
        "expected_version": requirement["version"],
        "quantity": "4",
    }
    result = acquired_to_inventory(database, requirement["public_id"], request)
    assert result["requirement"]["acquired_quantity"] == "0"
    assert result["requirement"]["inventory_quantity_available"] == "7"
    assert result["requirement"]["missing_quantity"] == "3"
    acquired_to_inventory(database, requirement["public_id"], request)
    assert database.execute("SELECT quantity_milli FROM items").fetchone()[0] == 7000


def test_custom_field_override_keeps_values_and_nearest_definition_wins(database):
    setup_features(database)
    child = next(row for row in list_categories(database) if row["name"] == "Nozzles")
    parent_field = category_fields(database, child["id"])[0]
    assert parent_field["inherited"]
    override = op(
        "category_field",
        {
            "category": child["id"],
            "overrides": parent_field["public_id"],
            "key": "diameter",
            "label": "Nozzle diameter",
            "type": "decimal",
            "unit": "mm",
            "constraints": {"max": 1},
        },
    )
    result = apply_import_merge(database, batch(override))
    effective = category_fields(database, child["id"])[0]
    assert effective["public_id"] != parent_field["public_id"]
    assert effective["value_field_id"] == parent_field["public_id"]
    assert effective["constraints"]["max"] == "1"
    item_id = database.execute("SELECT public_id FROM items").fetchone()[0]
    assert get_item(database, item_id)["custom_fields"][parent_field["public_id"]] == "0.4"
    invalid = batch(
        op("item", {"custom_fields": {"diameter": 2}}, "modify", {"public_id": item_id})
    )
    assert not import_preview(invalid, database)["valid"]
    with pytest.raises(ValueError):
        apply_import_merge(database, invalid)
    undo_import_batch(database, result["import_public_id"])
    assert category_fields(database, child["id"])[0]["public_id"] == parent_field["public_id"]


def test_field_rename_deactivate_and_invalid_type_change_preserve_data(database):
    setup_features(database)
    field_id = database.execute("SELECT public_id FROM category_fields").fetchone()[0]
    changed = batch(
        op(
            "category_field",
            {"key": "nozzle_diameter", "label": "Nozzle diameter"},
            "modify",
            {"public_id": field_id},
        )
    )
    apply_import_merge(database, changed)
    assert database.execute("SELECT count(*) FROM item_field_values").fetchone()[0] == 1
    invalid = batch(op("category_field", {"type": "integer"}, "modify", {"public_id": field_id}))
    preview = import_preview(invalid, database)
    assert not preview["valid"]
    assert preview["validation_errors"][0]["error_code"] == "field_migration_failed"
    assert preview["validation_errors"][0]["affected_items"] == 1
    apply_import_merge(
        database,
        batch({"op": "delete", "type": "category_field", "match": {"public_id": field_id}}),
    )
    assert database.execute("SELECT count(*) FROM item_field_values").fetchone()[0] == 1
    assert database.execute("SELECT active FROM category_fields").fetchone()[0] == 0


def test_compatibility_alias_dedup_and_specific_override(database):
    setup_features(database)
    duplicate = batch(op("compatibility_target", {"name": "Voron printers"}))
    assert not import_preview(duplicate, database)["valid"]
    item_id = database.execute("SELECT public_id FROM items").fetchone()[0]
    item_row = get_item_row(database, item_id)
    assert resolve_target(database, "Voron printers")["name"] == "Voron family"
    apply_import_merge(
        database,
        batch(
            op(
                "item",
                {
                    "compatibility": [
                        {"target": "Voron family"},
                        {"target": "Voron 2.4", "status": "incompatible", "notes": "Wrong mount"},
                    ]
                },
                "modify",
                {"public_id": item_id},
            )
        ),
    )
    effective = effective_compatibility(database, item_row["id"], "Voron 2.4")
    assert effective["status"] == "incompatible"
    assert not effective["inherited"]


def test_location_and_category_moves_preserve_contained_identity(database):
    result = apply_import_merge(
        database,
        batch(
            op("location", {"name": "Room A"}),
            op("location", {"name": "Room B"}),
            op("location", {"name": "Box", "parent": "Room A"}),
            op("category", {"name": "Root A"}),
            op("category", {"name": "Root B"}),
            op("category", {"name": "Parts", "parent": "Root A"}),
            op(
                "item",
                {
                    "name": "Bolt",
                    "quantity": 8,
                    "category": "Root A > Parts",
                    "location": "Room A > Box",
                },
            ),
        ),
    )
    item_id = result["details"][-1]["after"]["public_id"]
    box_id = get_item(database, item_id)["location_public_id"]
    apply_import_merge(
        database,
        batch(
            op("location", {"parent": "Room B"}, "modify", {"public_id": box_id}),
            op("category", {"parent": "Root B"}, "modify", {"path": "Root A > Parts"}),
        ),
    )
    item = get_item(database, item_id)
    assert item["location_public_id"] == box_id
    assert item["location_path"] == "Room B > Box"
    assert item["category_path"] == "Root B > Parts"
    assert item["quantity"] == "8"


def test_full_feature_import_undo_has_no_orphans(database):
    result = setup_features(database)
    undo_import_batch(database, result["import_public_id"])
    for table in (
        "items",
        "category_fields",
        "item_field_values",
        "compatibility_targets",
        "projects",
        "project_requirements",
    ):
        assert database.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
    assert not database.execute("PRAGMA foreign_key_check").fetchall()


def test_structured_json_export_roundtrip(database, tmp_path):
    from findstuff.extended import export_inventory

    setup_features(database)
    exported = export_inventory(database)
    path = tmp_path / "other.sqlite3"
    migrate(path)
    target = connect(path)
    try:
        preview = import_preview(exported, target)
        assert preview["valid"], preview["errors"]
        result = apply_import_merge(target, exported)
        project = project_detail(target, "Toolhead Upgrade")
        assert project["requirements"][0]["missing_quantity"] == "3"
        assert target.execute("SELECT count(*) FROM item_field_values").fetchone()[0] == 1
        assert target.execute("SELECT count(*) FROM item_compatibility").fetchone()[0] == 1
        undo_import_batch(target, result["import_public_id"])
        assert not target.execute("PRAGMA foreign_key_check").fetchall()
        assert not target.execute("SELECT 1 FROM projects").fetchone()
    finally:
        target.close()


def test_legacy_reservations_and_requirements_share_available_stock(database, tmp_path):
    from decimal import Decimal

    from findstuff.extended import export_inventory, reserve_item
    from findstuff.inventory import ConflictError

    setup_features(database)
    req = project_detail(database, "Toolhead Upgrade")["requirements"][0]
    apply_import_merge(
        database,
        batch(
            op("project_requirement", {"reserve": True}, "modify", {"public_id": req["public_id"]}),
            op("project", {"name": "Another project"}),
        ),
    )
    other = project_detail(database, "Another project")
    with pytest.raises(ConflictError, match="available"):
        reserve_item(database, other["public_id"], req["item"], Decimal(1))
    apply_import_merge(
        database,
        batch(
            op("project_requirement", {"reserve": False}, "modify", {"public_id": req["public_id"]})
        ),
    )
    reserve_item(database, other["public_id"], req["item"], Decimal(1))
    path = tmp_path / "reservations.sqlite3"
    migrate(path)
    target = connect(path)
    try:
        result = apply_import_merge(target, export_inventory(database))
        assert (
            target.execute("SELECT quantity_milli FROM project_reservations").fetchone()[0] == 1000
        )
        undo_import_batch(target, result["import_public_id"])
        assert not target.execute("SELECT 1 FROM project_reservations").fetchone()
        assert not target.execute("PRAGMA foreign_key_check").fetchall()
    finally:
        target.close()


def test_composite_requirement_reference_and_planned_stock_conversion(database):
    result = apply_import_merge(
        database,
        batch(
            op("location", {"name": "Box A"}),
            op("location", {"name": "Box B"}),
            op("item", {"name": "Fitting", "location": "Box A", "quantity": 3}),
            op("item", {"name": "Fitting", "location": "Box B", "quantity": 14}),
            op("project", {"name": "Printer"}),
            op(
                "project_requirement",
                {
                    "project": "Printer",
                    "name": "Fitting",
                    "required_quantity": 5,
                    "item": {"name": "Fitting", "location": "Box B"},
                    "inventory_quantity": 5,
                },
            ),
            op(
                "project_requirement",
                {
                    "project": "Printer",
                    "name": "Cable",
                    "required_quantity": 2,
                    "acquired_quantity": 2,
                },
            ),
        ),
    )
    assert result["details"][5]["after"]["missing_quantity"] == "0"
    req = project_detail(database, "Printer")["requirements"][1]
    converted = acquired_to_inventory(
        database,
        req["public_id"],
        {
            "request_id": "planned-stock-conversion",
            "expected_version": req["version"],
            "quantity": 2,
            "location": result["details"][0]["after"]["public_id"],
        },
    )
    assert converted["requirement"]["acquired_quantity"] == "0"
    assert converted["requirement"]["missing_quantity"] == "0"
    assert converted["item"]["location_path"] == "Box A"


def test_target_spelling_collisions_and_database_wide_compatibility_filter(database):
    from findstuff.inventory import create_item
    from findstuff.inventory_query import query_inventory

    setup_features(database)
    assert not import_preview(
        batch(op("compatibility_target", {"name": "Voron-family"})), database
    )["valid"]
    for index in range(255):
        create_item(database, {"name": f"Unrelated stock {index}"})
    result = query_inventory(database, query="parts for Voron 2.4")
    assert result["total"] == 1
    assert result["items"][0]["name"] == "Nozzle"


def test_targets_carry_an_optional_category_that_survives_edits(database):
    from findstuff.compatibility import save_target, targets

    setup_features(database)
    hardware = next(row for row in list_categories(database) if row["name"] == "Hardware")

    plain = save_target(database, {"name": "Unsorted rig"})
    assert plain["category"] is None

    grouped = save_target(database, {"name": "Voron 0.2", "category": "Hardware"})
    assert grouped["category"] == hardware["id"]
    # The readable path travels with the ID so the AI template and exports do not
    # have to resolve the grouping themselves.
    assert grouped["category_path"] == "Hardware"
    assert plain["category_path"] is None

    listed = {row["name"]: row["category"] for row in targets(database)}
    assert listed["Voron 0.2"] == hardware["id"]
    assert listed["Voron family"] is None

    moved = save_target(
        database, {"name": "Voron 0.2", "category": hardware["id"]}, grouped["public_id"]
    )
    assert moved["category"] == hardware["id"]

    cleared = save_target(database, {"name": "Voron 0.2"}, grouped["public_id"])
    assert cleared["category"] is None


def test_target_category_rejects_an_unknown_category(database):
    from findstuff.compatibility import save_target

    setup_features(database)
    with pytest.raises(ValueError, match="Category not found"):
        save_target(database, {"name": "Ghost rig", "category": "No such category"})


@pytest.mark.parametrize(
    "first,second",
    [
        ({"name": "Ender 3"}, {"name": "Ender3"}),
        ({"name": "Printer", "aliases": ["Ender 3"]}, {"name": "Ender-3"}),
        ({"name": "Ender 3"}, {"name": "Other printer", "aliases": ["ender3"]}),
        ({"name": "Printer", "aliases": ["Ender 3"]}, {"name": "Other", "aliases": ["ENDER-3"]}),
    ],
)
def test_same_batch_target_names_and_aliases_collide_atomically(database, first, second):
    payload = batch(op("compatibility_target", first), op("compatibility_target", second))
    preview = import_preview(payload, database)
    assert not preview["valid"]
    assert preview["validation_errors"][0]["operation_index"] == 2
    assert "Ender" in str(preview["errors"]) or "ender" in str(preview["errors"])
    assert database.execute("SELECT count(*) FROM compatibility_targets").fetchone()[0] == 0
    with pytest.raises(ValueError):
        apply_import_merge(database, payload)
    assert database.execute("SELECT count(*) FROM compatibility_targets").fetchone()[0] == 0


def test_template_effective_fields_are_resolved_and_descriptions_are_scoped(database):
    from findstuff.operations_contract import operations_template

    setup_features(database)
    apply_import_merge(
        database,
        batch(
            op("category", {"name": "Hardened", "parent": "Hardware > Nozzles"}),
            op(
                "category_field",
                {
                    "category": "Hardware > Nozzles > Hardened",
                    "overrides": "diameter",
                    "key": "diameter",
                    "label": "Hardened diameter",
                    "type": "decimal",
                    "unit": "mm",
                    "default": 0.6,
                },
            ),
        ),
    )
    template = operations_template(database)
    categories = {entry["name"]: entry for entry in template["_available_categories"]}
    parent = categories["Nozzles"]["effective_custom_fields"][0]
    child = categories["Hardened"]["effective_custom_fields"][0]
    assert parent["inherited"] and parent["source_category_path"] == "Hardware"
    assert not child["inherited"] and child["label"] == "Hardened diameter"
    assert child["value_field_id"] == parent["value_field_id"]
    assert str(child["default"]) == "0.6"
    assert len(categories["Hardened"]["defined_here"]) == 1
    assert not categories["Nozzles"]["defined_here"]
    definitions = template["_field_definitions"]
    assert "product name" in definitions["item"]["name"]["description"]
    assert "product name" not in definitions["category"]["name"]["description"]
    assert "product name" not in definitions["location"]["name"]["description"]
    assert "physical place" in definitions["location"]["description"]["description"]
    assert "compatibility_targets" in definitions["item"]


def test_physical_target_links_survive_sale_and_roundtrip_and_undo(database, tmp_path):
    from findstuff.compatibility import represented_targets
    from findstuff.extended import export_inventory

    setup_features(database)
    result = apply_import_merge(
        database, batch(op("item", {"name": "My printer", "compatibility_targets": ["Voron 2.4"]}))
    )
    machine = database.execute("SELECT * FROM items WHERE name='My printer'").fetchone()
    target = represented_targets(database, machine["id"])[0]
    assert target["name"] == "Voron 2.4"
    assert machine["public_id"] in target["linked_item_ids"]
    exported = export_inventory(database)
    assert len(exported["tables"]["target_inventory_items"]) == 1
    path = tmp_path / "linked.sqlite3"
    migrate(path)
    other = connect(path)
    try:
        preview = import_preview(exported, other)
        assert preview["valid"], preview["errors"]
        imported = apply_import_merge(other, exported)
        assert other.execute("SELECT count(*) FROM target_inventory_items").fetchone()[0] == 1
        undo_import_batch(other, imported["import_public_id"])
        assert other.execute("SELECT count(*) FROM target_inventory_items").fetchone()[0] == 0
    finally:
        other.close()
    # Sale/archive does not deactivate the model or its parts relationships.
    database.execute("UPDATE items SET archived_at=CURRENT_TIMESTAMP WHERE id=?", (machine["id"],))
    assert resolve_target(database, "Voron 2.4")["active"]
    part = database.execute("SELECT id FROM items WHERE name='Nozzle'").fetchone()[0]
    assert effective_compatibility(database, part, "Voron 2.4")["status"] == "compatible"
    database.commit()
    undo_import_batch(database, result["import_public_id"])
    assert database.execute("SELECT count(*) FROM target_inventory_items").fetchone()[0] == 0
    assert resolve_target(database, "Voron 2.4")["active"]


def test_physical_target_modify_preview_and_undo_preserve_abstract_identity(database):
    import asyncio

    from findstuff.extension_routes import target_detail
    from findstuff.extensions import item_extensions

    setup_features(database)
    apply_import_merge(database, batch(op("item", {"name": "Owned printer"})))
    machine = database.execute("SELECT * FROM items WHERE name='Owned printer'").fetchone()
    payload = batch(
        op(
            "item",
            {"compatibility_targets": ["Voron 2.4"]},
            "modify",
            {"public_id": machine["public_id"]},
        )
    )
    preview = import_preview(payload, database)
    assert preview["valid"], preview["errors"]
    assert not item_extensions(database, machine["public_id"])["compatibility_targets"]
    applied = apply_import_merge(database, payload)
    detail = asyncio.run(target_detail("Voron 2.4", database, 0))
    assert detail["linked_items"][0]["public_id"] == machine["public_id"]
    assert detail["items"][0]["effective_compatibility"]["inherited"]
    undo_import_batch(database, applied["import_public_id"])
    assert not item_extensions(database, machine["public_id"])["compatibility_targets"]
    assert resolve_target(database, "Voron 2.4")["active"]
    # Explicit null is not an unlink and cannot partially mutate the item.
    bad = batch(
        op(
            "item",
            {"name": "Changed", "compatibility_targets": None},
            "modify",
            {"public_id": machine["public_id"]},
        )
    )
    assert not import_preview(bad, database)["valid"]
    assert get_item_row(database, machine["public_id"])["name"] == "Owned printer"
