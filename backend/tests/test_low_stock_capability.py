from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from findstuff.db import connect, migrate
from findstuff.extended import generate_low_stock_shopping
from findstuff.inventory import (
    CATEGORY_DATA_FIELDS,
    analytics,
    create_category,
    create_item,
    dashboard,
    get_item,
    list_categories,
    list_items,
    save_category_data_settings,
)
from findstuff.inventory_query import query_inventory


@pytest.fixture
def database(tmp_path: Path) -> sqlite3.Connection:
    path = tmp_path / "low-stock.sqlite3"
    migrate(path)
    connection = connect(path)
    yield connection
    connection.close()


def _stock(connection: sqlite3.Connection) -> dict[str, object]:
    hobbies = create_category(connection, "Hobbies")
    trainers = create_category(connection, "Trainers", hobbies["id"])
    pantry = create_category(connection, "Pantry")
    knife = create_item(
        connection,
        {
            "name": "Nautilus",
            "category_id": trainers["id"],
            "quantity": "1",
            "low_stock_threshold": "1",
        },
    )
    rice = create_item(
        connection,
        {"name": "Rice", "category_id": pantry["id"], "quantity": "1", "low_stock_threshold": "2"},
    )
    return {
        "hobbies": hobbies,
        "trainers": trainers,
        "pantry": pantry,
        "knife": knife,
        "rice": rice,
    }


def _low_names(connection: sqlite3.Connection) -> set[str]:
    return {item["name"] for item in list_items(connection, low_stock=True)}


def test_low_stock_is_a_standard_category_field_on_by_default(database) -> None:
    assert "low_stock" in CATEGORY_DATA_FIELDS
    stock = _stock(database)
    assert all(category["capabilities"]["low_stock"] for category in list_categories(database))
    assert get_item(database, stock["knife"]["public_id"])["low_stock_enabled"] is True
    assert _low_names(database) == {"Nautilus", "Rice"}


def test_turning_it_off_for_a_branch_stops_every_low_stock_signal(database) -> None:
    stock = _stock(database)
    save_category_data_settings(database, {str(stock["hobbies"]["id"]): {"low_stock": False}})

    trainers = next(c for c in list_categories(database) if c["id"] == stock["trainers"]["id"])
    assert trainers["capabilities"]["low_stock"] is False, "a child category inherits it"

    knife = get_item(database, stock["knife"]["public_id"])
    assert knife["low_stock_enabled"] is False
    assert knife["low_stock_threshold"] == "1", "the threshold is kept, only ignored"

    assert _low_names(database) == {"Rice"}
    assert dashboard(database)["low_stock_count"] == 1
    assert analytics(database)["summary"]["low_stock"] == 1
    low = query_inventory(database, filter_name="low")
    assert [item["name"] for item in low["items"]] == ["Rice"]
    in_stock = query_inventory(database, filter_name="in-stock")
    assert "Nautilus" in [item["name"] for item in in_stock["items"]]
    assert generate_low_stock_shopping(database) == 1


def test_a_child_can_turn_it_back_on(database) -> None:
    stock = _stock(database)
    save_category_data_settings(
        database,
        {
            str(stock["hobbies"]["id"]): {"low_stock": False},
            str(stock["trainers"]["id"]): {"low_stock": True},
        },
    )
    assert get_item(database, stock["knife"]["public_id"])["low_stock_enabled"] is True
    assert _low_names(database) == {"Nautilus", "Rice"}


def test_items_without_a_category_always_track_low_stock(database) -> None:
    stock = _stock(database)
    save_category_data_settings(database, {str(stock["pantry"]["id"]): {"low_stock": False}})
    loose = create_item(
        database, {"name": "Loose screws", "quantity": "1", "low_stock_threshold": "5"}
    )
    assert get_item(database, loose["public_id"])["low_stock_enabled"] is True
    assert _low_names(database) == {"Nautilus", "Loose screws"}
