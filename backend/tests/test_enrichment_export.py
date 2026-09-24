from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from findstuff.db import connect, migrate
from findstuff.enrichment_export import EXPORT_FORMAT, export_category, export_location
from findstuff.inventory import NotFoundError, create_category, create_item, create_location


@pytest.fixture
def database(tmp_path: Path) -> sqlite3.Connection:
    path = tmp_path / "export.sqlite3"
    migrate(path)
    connection = connect(path)
    yield connection
    connection.close()


def _stock(connection: sqlite3.Connection) -> dict[str, object]:
    shelf = create_location(connection, "Shelf", kind="shelf")
    drawer = create_location(connection, "Drawer", kind="drawer", parent_public_id=shelf["public_id"])
    boards = create_category(connection, "Boards")
    sensors = create_category(connection, "Sensors", boards["id"])
    on_shelf = create_item(connection, {"name": "Feather M0", "category_id": boards["id"], "location_public_id": shelf["public_id"], "quantity": "2"})
    inside = create_item(connection, {"name": "BME280", "category_id": sensors["id"], "location_public_id": drawer["public_id"], "quantity": "5"})
    return {"shelf": shelf, "drawer": drawer, "boards": boards, "sensors": sensors, "on_shelf": on_shelf, "inside": inside}


def test_a_category_export_carries_its_branch_and_the_import_guide(database) -> None:
    stock = _stock(database)
    payload = export_category(database, stock["boards"]["id"])

    assert payload["format"] == EXPORT_FORMAT
    assert payload["scope"]["path"] == "Boards"
    names = sorted(item["name"] for item in payload["items"])
    assert names == ["BME280", "Feather M0"], "a child category's stock comes along"
    assert payload["instructions"], "the file says what is being asked for"
    assert "_schemas" in payload["guide"], "the import format travels with it"
    assert all("history" not in item for item in payload["items"])
    assert all("custom_fields" in item for item in payload["items"])


def test_a_category_export_can_stay_on_its_own_level(database) -> None:
    stock = _stock(database)
    payload = export_category(database, stock["boards"]["id"], include_children=False)
    assert [item["name"] for item in payload["items"]] == ["Feather M0"]


def test_a_place_export_reaches_the_places_inside_it(database) -> None:
    stock = _stock(database)
    payload = export_location(database, stock["shelf"]["public_id"])
    assert sorted(item["name"] for item in payload["items"]) == ["BME280", "Feather M0"]

    direct = export_location(database, stock["shelf"]["public_id"], include_children=False)
    assert [item["name"] for item in direct["items"]] == ["Feather M0"]


def test_the_guide_leaves_out_the_whole_catalogue(database) -> None:
    stock = _stock(database)
    payload = export_category(database, stock["boards"]["id"])
    guide = payload["guide"]
    assert "_available_categories" not in guide, "a whole-inventory listing would dwarf the items"
    assert "_available_items" not in guide
    assert {category["name"] for category in guide["_categories_in_scope"]} == {"Boards", "Sensors"}
    assert guide["_catalogues_omitted"]


def test_an_unknown_branch_is_refused(database) -> None:
    with pytest.raises(NotFoundError):
        export_category(database, 999999)
    with pytest.raises(NotFoundError):
        export_location(database, "loc_nothing")
