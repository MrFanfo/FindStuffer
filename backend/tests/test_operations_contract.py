from __future__ import annotations

import json
from pathlib import Path

import pytest

from findstuff.barcodes import existing_item_for_barcode, existing_items_for_barcode
from findstuff.db import connect, migrate
from findstuff.extended import (
    apply_import_merge,
    export_inventory,
    import_preview,
    undo_import_batch,
)
from findstuff.inventory import create_item, create_location, get_item
from findstuff.operations_contract import DATA_FIELDS, MATCH_FIELDS, operations_template


@pytest.fixture
def database(tmp_path: Path):
    path = tmp_path / "contract.sqlite3"
    migrate(path)
    with connect(path) as connection:
        yield connection


def batch(*operations):
    return {"format": "findstuff-ops-v1", "schema_version": 2, "operations": list(operations)}


def add(entity, **data):
    return {"op": "add", "type": entity, "data": data}


def modify(public_id, **data):
    return {"op": "modify", "type": "item", "match": {"public_id": public_id}, "data": data}


def stock_batch():
    return batch(
        add("category", name="Fittings"),
        add("location", name="Box A", kind="box"),
        add("location", name="Box B", kind="box"),
        add("item", name="PTFE Fittings", category="Fittings", location="Box A", quantity=3),
        add("item", name="PTFE Fittings", category="Fittings", location="Box B", quantity=14),
    )


def test_multiplace_stock_batch_preview_apply_and_exact_collision(database):
    payload = stock_batch()
    before = database.execute("SELECT count(*) FROM items").fetchone()[0]
    preview = import_preview(payload, database)
    assert preview["valid"], preview["errors"]
    assert preview["counts"]["items_added"] == 2
    assert preview["counts"]["locations_created"] == 2
    assert preview["details"][4]["after"]["location_path"] == "Box B"
    assert database.execute("SELECT count(*) FROM items").fetchone()[0] == before
    applied = apply_import_merge(database, payload)
    assert applied["created"]["items"] == 2
    rows = database.execute("SELECT public_id, name, quantity_milli FROM items").fetchall()
    assert {row["name"] for row in rows} == {"PTFE Fittings"}
    assert {row["quantity_milli"] for row in rows} == {3000, 14000}
    collision = import_preview(batch(payload["operations"][4]), database)
    assert not collision["valid"]
    assert all(word in collision["details"][0]["message"] for word in ("Box B", "Fittings"))
    with pytest.raises(ValueError, match="Duplicate item"):
        apply_import_merge(database, batch(payload["operations"][4]))


def test_duplicate_in_same_batch_has_origin_and_is_atomic(database):
    payload = stock_batch()
    payload["operations"].append(payload["operations"][3])
    preview = import_preview(payload, database)
    assert not preview["valid"]
    assert "earlier Operation #4" in preview["details"][-1]["message"]
    with pytest.raises(ValueError):
        apply_import_merge(database, payload)
    assert database.execute("SELECT count(*) FROM items").fetchone()[0] == 0
    assert not database.execute("SELECT 1 FROM locations WHERE name='Box A'").fetchone()


def test_exact_matching_move_quantity_clear_and_undo(database):
    apply_import_merge(database, stock_batch())
    row = database.execute("SELECT public_id FROM items ORDER BY quantity_milli").fetchone()
    public_id = row[0]
    payload = batch(
        modify(public_id, location="Box B", quantity_delta="0.125", fullness_percent=75)
    )
    preview = import_preview(payload, database)
    assert preview["valid"]
    assert preview["counts"]["items_moved"] == 1
    assert preview["details"][0]["before"]["location_path"] == "Box A"
    assert preview["details"][0]["after"]["quantity"] == "3.125"
    result = apply_import_merge(database, payload)
    assert get_item(database, public_id)["quantity"] == "3.125"
    undo_import_batch(database, result["import_public_id"])
    restored = get_item(database, public_id)
    assert restored["quantity"] == "3"
    assert restored["fullness_percent"] is None
    assert restored["location_path"] == "Box A"
    apply_import_merge(database, batch(modify(public_id, quantity=0, location=None, tags=[])))
    cleared = get_item(database, public_id)
    assert cleared["quantity"] == "0"
    assert cleared["location_public_id"] == "unassigned"


def test_ambiguous_name_requires_qualifiers(database):
    apply_import_merge(database, stock_batch())
    operation = {
        "op": "modify",
        "type": "item",
        "match": {"name": "PTFE Fittings"},
        "data": {"add_quantity": 2},
    }
    preview = import_preview(batch(operation), database)
    assert not preview["valid"]
    assert "Box A" in preview["details"][0]["message"]
    assert "Box B" in preview["details"][0]["message"]
    operation["match"].update(category="Fittings", location="Box B")
    assert apply_import_merge(database, batch(operation))["valid"]
    assert database.execute("SELECT max(quantity_milli) FROM items").fetchone()[0] == 16000


@pytest.mark.parametrize(
    "data",
    [
        {"quantity": "1.0001"},
        {"quantity": -1},
        {"quantity": None},
        {"fullness_percent": 100.5},
        {"fullness_percent": 101},
        {"invented_field": "x"},
        {"tags": "tag"},
        {"category": "Missing", "category_id": 1},
    ],
)
def test_invalid_fields_rejected_before_any_write(database, data):
    payload = batch(add("location", name="Must not persist"), add("item", name="Invalid", **data))
    assert not import_preview(payload, database)["valid"]
    with pytest.raises(ValueError):
        apply_import_merge(database, payload)
    assert not database.execute("SELECT 1 FROM locations WHERE name='Must not persist'").fetchone()


def test_hierarchy_warning_and_repeated_leaf_names(database):
    payload = batch(
        add("location", name="Drawer", kind="drawer"),
        add("location", name="Room", kind="room", parent="Drawer"),
        add("location", name="Room", kind="room"),
    )
    preview = import_preview(payload, database)
    assert preview["valid"]
    assert preview["counts"]["warnings"] == 1
    assert apply_import_merge(database, payload)["created"]["locations"] == 3


def test_exported_contract_covers_every_field_and_revision(database):
    template = operations_template(database)
    json.dumps(template)
    assert template["schema_version"] == 2
    assert template["operations"] == []
    for entity, fields in DATA_FIELDS.items():
        definitions = template["_field_definitions"][entity]
        assert set(fields) <= definitions.keys()
        assert set(MATCH_FIELDS[entity]) <= definitions.keys()
        assert set(template["_schemas"][entity]["modify"]["allowed_fields"]) == set(fields)
    for revision in (0, 3, "2", True):
        with pytest.raises(ValueError, match="schema_version"):
            import_preview({**batch(), "schema_version": revision}, database)


def test_raw_preview_shows_resolved_destinations_and_catches_missing_reference(database):
    apply_import_merge(database, stock_batch())
    payload = export_inventory(database)
    preview = import_preview(payload, database)
    assert preview["valid"], preview["errors"]
    details = [row for row in preview["details"] if row["table"] == "items"]
    assert {row["after"]["location_path"] for row in details} == {"Box A", "Box B"}
    payload["tables"]["items"][0]["public_id"] = "itm_new_identity"
    payload["tables"]["items"][0]["location_id"] = -999
    preview = import_preview(payload, database)
    assert not preview["valid"]
    assert "missing location" in preview["errors"][0]


def test_barcode_has_no_implicit_stock_selection_when_multiple_places(database):
    place = create_location(database, {"name": "Box", "kind": "box"})
    first = create_item(database, {"name": "Product", "barcode": "3017620422003"})
    assert existing_item_for_barcode(database, "3017620422003")["public_id"] == first["public_id"]
    second = create_item(
        database,
        {"name": "Product", "barcode": "3017620422003", "location_public_id": place["public_id"]},
    )
    assert existing_item_for_barcode(database, "3017620422003") is None
    assert {
        item["public_id"] for item in existing_items_for_barcode(database, "3017620422003")
    } == {
        first["public_id"],
        second["public_id"],
    }


@pytest.mark.parametrize(
    "policy, quantity, status",
    [
        ("skip", "14", "skip"),
        ("merge_quantity", "19", "merge"),
        ("replace", "5", "replace"),
    ],
)
def test_duplicate_policy_preview_matches_commit_and_replay(database, policy, quantity, status):
    apply_import_merge(database, stock_batch())
    payload = {
        **batch(
            add("item", name="PTFE Fittings", category="Fittings", location="Box B", quantity=5)
        ),
        "duplicate_policy": policy,
        "import_id": "restock-batch",
    }
    preview = import_preview(payload, database)
    assert preview["valid"], preview["errors"]
    assert preview["details"][0]["status"] == status
    assert preview["details"][0]["after"]["quantity"] == quantity
    result = apply_import_merge(database, payload)
    replay = apply_import_merge(database, payload)
    assert replay["replayed"]
    assert replay["import_id"] == result["import_id"]
    public_id = preview["details"][0]["after"]["public_id"]
    assert get_item(database, public_id)["quantity"] == quantity
    payload["operations"][0]["data"]["quantity"] = 6
    with pytest.raises(ValueError, match="different content"):
        apply_import_merge(database, payload)


def test_split_partial_move_and_record_merge_conserve_quantity_and_undo(database):
    apply_import_merge(database, stock_batch())
    source = database.execute("SELECT public_id FROM items WHERE quantity_milli=14000").fetchone()[
        0
    ]
    payload = {
        **batch(
            {
                "op": "split",
                "type": "item",
                "match": {"public_id": source},
                "data": {"quantity": 5, "location": "Box A"},
            }
        ),
        "duplicate_policy": "merge_quantity",
    }
    preview = import_preview(payload, database)
    assert preview["valid"], preview["errors"]
    detail = preview["details"][0]
    assert detail["source_after"]["quantity"] == "9"
    assert detail["after"]["quantity"] == "8"
    result = apply_import_merge(database, payload)
    assert database.execute("SELECT sum(quantity_milli) FROM items").fetchone()[0] == 17000
    assert (
        database.execute(
            "SELECT count(*) FROM import_provenance WHERE import_id=?", (result["import_id"],)
        ).fetchone()[0]
        == 2
    )
    undo_import_batch(database, result["import_public_id"])
    assert get_item(database, source)["quantity"] == "14"
    assert apply_import_merge(database, payload)["undone"]
    assert get_item(database, source)["quantity"] == "14"
    target = create_location(database, {"name": "Box C"})
    split = batch(
        {
            "op": "split",
            "type": "item",
            "match": {"public_id": source},
            "data": {"quantity": 5, "location": target["public_id"]},
        }
    )
    result = apply_import_merge(database, split)
    new_id = result["details"][0]["after"]["public_id"]
    assert new_id != source
    assert get_item(database, source)["quantity"] == "9"
    apply_import_merge(database, batch(modify(new_id, location="Box B")))
    merge = batch(
        {
            "op": "merge",
            "type": "item",
            "match": {"public_id": source},
            "data": {"source": {"public_id": new_id}},
        }
    )
    result = apply_import_merge(database, merge)
    assert get_item(database, source)["quantity"] == "14"
    assert get_item(database, new_id)["archived_at"] is not None
    undo_import_batch(database, result["import_public_id"])
    assert get_item(database, source)["quantity"] == "9"
    assert get_item(database, new_id)["quantity"] == "5"
    assert get_item(database, new_id)["archived_at"] is None


def test_full_move_retains_public_id_and_increment_receipts_survive_history_rotation(database):
    apply_import_merge(database, stock_batch())
    public_id = database.execute("SELECT public_id FROM items ORDER BY id LIMIT 1").fetchone()[0]
    result = apply_import_merge(
        database,
        batch(
            {
                "op": "move",
                "type": "item",
                "match": {"public_id": public_id},
                "data": {"location": None},
            }
        ),
    )
    assert result["details"][0]["after"]["public_id"] == public_id
    assert get_item(database, public_id)["quantity"] == "3"
    payload = batch(
        {"op": "merge", "type": "item", "match": {"public_id": public_id}, "data": {"quantity": 2}}
    )
    apply_import_merge(database, payload)
    for index in range(6):
        apply_import_merge(
            database,
            {**batch(modify(public_id, notes=f"Edit {index}")), "import_id": f"edit-{index}"},
        )
    assert apply_import_merge(database, payload)["replayed"]
    assert get_item(database, public_id)["quantity"] == "5"


def test_dependency_order_and_cycle_errors(database):
    payload = {
        **batch(
            add("item", name="Late reference", location="New parent > New child"),
            add("location", name="New child", parent="New parent"),
            add("location", name="New parent"),
        ),
        "ordering": "dependencies",
    }
    preview = import_preview(payload, database)
    assert preview["valid"], preview["errors"]
    assert preview["execution_order"] == [3, 2, 1]
    assert apply_import_merge(database, payload)["valid"]
    cycle = {
        **batch(add("location", name="A", parent="B"), add("location", name="B", parent="A")),
        "ordering": "dependencies",
    }
    preview = import_preview(cycle, database)
    assert not preview["valid"]
    assert {error["error_code"] for error in preview["validation_errors"]} == {
        "unresolved_dependency"
    }
    with pytest.raises(ValueError):
        apply_import_merge(database, cycle)


def test_failed_transfer_rolls_back_every_operation(database):
    apply_import_merge(database, stock_batch())
    source = database.execute("SELECT public_id FROM items WHERE quantity_milli=14000").fetchone()[
        0
    ]
    payload = batch(
        modify(source, notes="Must roll back"),
        {
            "op": "split",
            "type": "item",
            "match": {"public_id": source},
            "data": {"quantity": 15, "location": "Box A"},
        },
    )
    preview = import_preview(payload, database)
    assert preview["validation_errors"][0]["field"] == "data.quantity"
    assert preview["validation_errors"][0]["error_code"] == "out_of_range"
    with pytest.raises(ValueError):
        apply_import_merge(database, payload)
    assert get_item(database, source)["notes"] == ""


def test_strict_json_and_operation_limits(database):
    from findstuff.import_protocol import strict_json

    for invalid in ('{"a":1,"a":2}', '{"a":1,}', '{/*comment*/"a":1}', '{"a":NaN}'):
        with pytest.raises(ValueError):
            strict_json(invalid)
    with pytest.raises(ValueError, match="1,000"):
        import_preview(batch(*[add("item", name="Too many") for _ in range(5000)]), database)
    with pytest.raises(ValueError, match="nesting"):
        strict_json('{"a":' * 34 + "0" + "}" * 34)
