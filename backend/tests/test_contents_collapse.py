from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from findstuff.db import connect, migrate
from findstuff.inventory import (
    category_contents,
    create_category,
    create_item,
    create_location,
    location_contents,
)


@pytest.fixture
def database(tmp_path: Path) -> sqlite3.Connection:
    path = tmp_path / "collapse.sqlite3"
    migrate(path)
    connection = connect(path)
    yield connection
    connection.close()


def _workshop(connection: sqlite3.Connection) -> dict[str, object]:
    shelf = create_location(connection, {"name": "Shelf", "kind": "shelf"})
    storage = create_category(connection, "Storage")
    screws = create_category(connection, "Screws")
    box = create_item(
        connection,
        {
            "name": "Screw box",
            "category_id": storage["id"],
            "location_public_id": shelf["public_id"],
            "is_container": True,
        },
    )
    pouch = create_item(
        connection,
        {
            "name": "Tiny pouch",
            "category_id": storage["id"],
            "container_item_id": box["public_id"],
            "is_container": True,
        },
    )
    for size in ("M2", "M3", "M4"):
        create_item(
            connection,
            {
                "name": f"{size} screws",
                "category_id": screws["id"],
                "container_item_id": box["public_id"],
                "quantity": "10",
            },
        )
    create_item(
        connection,
        {
            "name": "M1 screws",
            "category_id": screws["id"],
            "container_item_id": pouch["public_id"],
            "quantity": "5",
        },
    )
    create_item(
        connection,
        {
            "name": "Loose screw",
            "category_id": screws["id"],
            "location_public_id": shelf["public_id"],
            "quantity": "1",
        },
    )
    return {"shelf": shelf, "storage": storage, "screws": screws, "box": box}


def test_a_category_shows_the_box_instead_of_what_is_inside_it(database) -> None:
    stock = _workshop(database)
    contents = category_contents(database, stock["screws"]["id"])
    names = sorted(item["name"] for item in contents["items"])
    assert names == ["Loose screw", "Screw box"], "the box stands in for its screws"
    box = next(item for item in contents["items"] if item["name"] == "Screw box")
    assert box["contained_matches"] == 4, "screws in a pouch inside the box count too"
    assert contents["inside_containers"] == 4


def test_a_box_in_its_own_category_is_listed_once(database) -> None:
    stock = _workshop(database)
    contents = category_contents(database, stock["storage"]["id"])
    assert [item["name"] for item in contents["items"]] == ["Screw box"]
    assert contents["items"][0]["contained_matches"] == 1, "the pouch inside it"


def test_a_place_lists_only_what_is_not_inside_something(database) -> None:
    stock = _workshop(database)
    contents = location_contents(database, stock["shelf"]["public_id"])
    assert sorted(item["name"] for item in contents["items"]) == ["Loose screw", "Screw box"]
    assert contents["inside_containers"] == 5
