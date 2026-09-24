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
    shelf = create_location(connection, {"name": "Shelf", "kind": "shelf"})
    drawer = create_location(
        connection, {"name": "Drawer", "kind": "drawer", "parent_public_id": shelf["public_id"]}
    )
    boards = create_category(connection, "Boards")
    sensors = create_category(connection, "Sensors", boards["id"])
    on_shelf = create_item(
        connection,
        {
            "name": "Feather M0",
            "category_id": boards["id"],
            "location_public_id": shelf["public_id"],
            "quantity": "2",
        },
    )
    inside = create_item(
        connection,
        {
            "name": "BME280",
            "category_id": sensors["id"],
            "location_public_id": drawer["public_id"],
            "quantity": "5",
        },
    )
    return {
        "shelf": shelf,
        "drawer": drawer,
        "boards": boards,
        "sensors": sensors,
        "on_shelf": on_shelf,
        "inside": inside,
    }


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
    assert {category["name"] for category in payload["categories"]} == {"Boards", "Sensors"}
    assert guide["_catalogues_omitted"]


def test_an_unknown_branch_is_refused(database) -> None:
    with pytest.raises(NotFoundError):
        export_category(database, 999999)
    with pytest.raises(NotFoundError):
        export_location(database, "loc_nothing")


def test_an_answer_written_from_the_export_imports_cleanly(database) -> None:
    from findstuff.extended import apply_import_merge, import_preview
    from findstuff.inventory import get_item

    stock = _stock(database)
    apply_import_merge(
        database,
        {
            "format": "findstuff-ops-v1",
            "schema_version": 3,
            "operations": [
                {
                    "op": "add",
                    "type": "category_field",
                    "data": {
                        "category": "Boards",
                        "key": "flash_kb",
                        "label": "Flash",
                        "type": "integer",
                        "unit": "KB",
                    },
                }
            ],
        },
    )
    payload = export_category(database, stock["boards"]["id"])
    feather = next(item for item in payload["items"] if item["name"] == "Feather M0")
    assert feather["custom_fields"] == {"flash_kb": None}, "an empty field is shown as a gap"
    assert "weight_g" in payload["guide"]["_field_definitions"]["item"]

    answer = {
        "format": "findstuff-ops-v1",
        "schema_version": 3,
        "operations": [
            {
                "op": "modify",
                "type": "item",
                "match": {"public_id": feather["public_id"]},
                "data": {"brand": "Adafruit", "custom_fields": {"flash_kb": 256}},
            }
        ],
    }
    preview = import_preview(answer, database)
    assert preview["valid"], preview["errors"]
    apply_import_merge(database, answer)
    stored = get_item(database, feather["public_id"])
    assert stored["brand"] == "Adafruit"
    again = export_category(database, stock["boards"]["id"])
    assert next(i for i in again["items"] if i["name"] == "Feather M0")["custom_fields"] == {
        "flash_kb": 256
    }


def test_each_item_carries_its_complete_detail(database) -> None:
    stock = _stock(database)
    payload = export_location(database, stock["shelf"]["public_id"])
    item = next(entry for entry in payload["items"] if entry["name"] == "BME280")
    for key in (
        "photos",
        "documents",
        "lots",
        "related",
        "maintenance",
        "reservations",
        "enrichment",
        "compatibility",
        "projects",
        "custom_fields",
        "tags",
        "links",
    ):
        assert key in item, key
    assert "field_definitions" not in item, "definitions travel once, per category"
    assert item["category_path"] == "Boards > Sensors"
    assert item["location_path"] == "Shelf > Drawer"
    assert {place["name"] for place in payload["places"]} == {"Shelf", "Drawer"}
    sensors = next(entry for entry in payload["categories"] if entry["name"] == "Sensors")
    assert "custom_fields" in sensors and "capabilities" in sensors
    assert payload["scope"]["item_count"] == 2


def test_stock_inside_a_box_on_the_shelf_comes_along(database) -> None:
    stock = _stock(database)
    box = create_item(
        database,
        {
            "name": "Parts box",
            "location_public_id": stock["shelf"]["public_id"],
            "is_container": True,
        },
    )
    create_item(
        database,
        {"name": "Resistor kit", "container_item_id": box["public_id"], "quantity": "1"},
    )
    payload = export_location(database, stock["shelf"]["public_id"], include_children=False)
    assert {item["name"] for item in payload["items"]} == {
        "Feather M0",
        "Parts box",
        "Resistor kit",
    }


def test_both_exports_are_served_over_the_api(tmp_path: Path, monkeypatch) -> None:
    import asyncio
    import importlib

    import httpx

    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FINDSTUFF_DATABASE_PATH", str(tmp_path / "api.sqlite3"))
    monkeypatch.setenv("FINDSTUFF_AUTO_BACKUP_ENABLED", "false")

    import findstuff.app as app_module

    app_module = importlib.reload(app_module)

    async def scenario() -> None:
        transport = httpx.ASGITransport(app=app_module.app)
        async with app_module.app.router.lifespan_context(app_module.app):
            async with httpx.AsyncClient(
                transport=transport, base_url="http://testserver"
            ) as client:
                shelf = (
                    await client.post("/api/v1/locations", json={"name": "Shelf", "kind": "shelf"})
                ).json()
                category = (await client.post("/api/v1/categories", json={"name": "Boards"})).json()
                await client.post(
                    "/api/v1/items",
                    json={
                        "name": "Feather M0",
                        "category_id": category["id"],
                        "location_public_id": shelf["public_id"],
                    },
                )
                by_place = await client.get(
                    f"/api/v1/locations/{shelf['public_id']}/enrichment-export"
                )
                by_category = await client.get(
                    f"/api/v1/categories/{category['id']}/enrichment-export"
                )
                missing = await client.get("/api/v1/categories/999999/enrichment-export")
        assert by_place.status_code == 200
        assert [item["name"] for item in by_place.json()["items"]] == ["Feather M0"]
        assert by_category.status_code == 200
        assert by_category.json()["scope"]["kind"] == "category"
        assert missing.status_code == 404

    asyncio.run(scenario())
