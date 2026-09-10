from pathlib import Path

import pytest

from findstuff.db import connect, migrate
from findstuff.human_search import human_search
from findstuff.inventory import create_item
from findstuff.inventory_query import query_inventory
from findstuff.offline import apply_offline_operation


@pytest.fixture
def inventory(tmp_path: Path):
    path = tmp_path / "inventory.sqlite3"
    migrate(path)
    connection = connect(path)
    old = create_item(
        connection, {"name": "Ancient cable", "quantity": 1, "low_stock_threshold": 2}
    )
    for index in range(260):
        create_item(connection, {"name": f"Cable {index:03}", "quantity": 5})
    yield connection, old
    connection.close()


def test_complete_filter_sort_and_search(inventory):
    db, old = inventory
    low = query_inventory(db, filter_name="low")
    assert low["total"] == 1
    assert low["items"][0]["public_id"] == old["public_id"]
    assert query_inventory(db, sort="name")["items"][0]["public_id"] == old["public_id"]
    assert query_inventory(db, sort="quantity-asc")["items"][0]["public_id"] == old["public_id"]
    seen, cursor = set(), None
    while True:
        page = human_search(db, "cable", limit=100, cursor=cursor)
        assert page["total"] == 261
        ids = {item["public_id"] for item in page["items"]}
        assert not seen & ids
        seen |= ids
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert len(seen) == 261
    assert query_inventory(db, query="cable")["total"] == page["total"]


def test_formula_and_cursor_scope(inventory):
    db, old = inventory
    formula = {
        "type": "condition",
        "rule": {"id": "one", "field": "quantity", "operator": "lt", "value": "2"},
    }
    result = query_inventory(db, formula=formula)
    assert result["total"] == 1
    assert result["items"][0]["public_id"] == old["public_id"]
    formula["rule"]["operator"] = "gte"
    cursor = query_inventory(db, formula=formula)["next_cursor"]
    formula["rule"]["id"] = "different-client-id"
    assert query_inventory(db, formula=formula, cursor=cursor)["items"]
    with pytest.raises(ValueError, match="cursor"):
        query_inventory(db, filter_name="low", cursor=cursor)
    formula["rule"]["field"] = "name); DROP TABLE items; --"
    with pytest.raises(ValueError):
        query_inventory(db, formula=formula)
    for invalid in [{"type": []}, {"type": "condition", "rule": {"field": []}}]:
        with pytest.raises(ValueError):
            query_inventory(db, formula=invalid)


def test_distinct_offline_operations_with_same_name(inventory):
    db, old = inventory
    first = apply_offline_operation(
        db, "offline:first", "create_item", {"name": old["name"], "quantity": 7}
    )
    second = apply_offline_operation(
        db, "offline:second", "create_item", {"name": old["name"], "quantity": 9}
    )
    replay = apply_offline_operation(
        db, "offline:first", "create_item", {"name": old["name"], "quantity": 7}
    )
    assert len({old["public_id"], first["result"]["public_id"], second["result"]["public_id"]}) == 3
    assert first == replay
    assert first["result"]["quantity"] == "7"
    assert second["result"]["quantity"] == "9"


def test_reassignment_preview_is_atomic_and_rejects_stale_review(inventory):
    from findstuff.category_consolidation import consolidate, preview
    from findstuff.inventory import create_category, get_item, update_item

    db, old = inventory
    source = create_category(db, "Source category")
    target = create_category(db, "Target category")
    updated = update_item(
        db, old["public_id"], {"category_id": source["id"], "expected_version": old["version"]}
    )
    review = preview(db, source["id"], target["id"])
    assert review["item_count"] == 1
    update_item(
        db,
        old["public_id"],
        {"notes": "Changed after review", "expected_version": updated["version"]},
    )
    with pytest.raises(ValueError, match="changed"):
        consolidate(db, source["id"], target["id"], review["token"])
    assert get_item(db, old["public_id"])["category_id"] == source["id"]
    review = preview(db, source["id"], target["id"])
    assert consolidate(db, source["id"], target["id"], review["token"])["updated"] == 1
    assert get_item(db, old["public_id"])["category_id"] == target["id"]
    assert db.execute("SELECT 1 FROM categories WHERE id=?", (source["id"],)).fetchone()


def test_preferences_and_attention(inventory):
    from findstuff.home import attention, preferences, save_preferences

    db, _ = inventory
    assert preferences(db)["show_shopping"] is True
    save_preferences(db, {"pinned_places": ["unassigned"]})
    assert save_preferences(db, {"show_shopping": False})["pinned_places"] == ["unassigned"]
    with pytest.raises(ValueError):
        save_preferences(db, {"show_shopping": "false"})
    assert attention(db) == {"ai_pending": 0, "reminders": []}


def test_import_activity_is_excluded_consistently(inventory):
    from findstuff.inventory import analytics

    db, _ = inventory
    create_item(db, {"name": "Imported widget"}, source="import")
    included = analytics(db, 30, include_imports=True)
    excluded = analytics(db, 30, include_imports=False)
    assert (
        included["activity_summary"]["current_events"]
        == excluded["activity_summary"]["current_events"] + 1
    )
    assert (
        sum(row["changes"] for row in excluded["activity"])
        == excluded["activity_summary"]["current_events"]
    )
    assert all("import" not in row["source"] for row in excluded["source_mix"])
