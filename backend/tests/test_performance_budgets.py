from __future__ import annotations

import sqlite3
import time
from decimal import Decimal
from pathlib import Path

import pytest

from findstuff.db import connect, migrate
from findstuff.inventory import create_item, create_location, list_items, location_contents


@pytest.fixture
def seeded_database(tmp_path: Path) -> sqlite3.Connection:
    path = tmp_path / "perf.sqlite3"
    migrate(path)
    connection = connect(path)
    home = create_location(connection, {"name": "Home", "kind": "home"})
    rooms = [
        create_location(
            connection,
            {"name": f"Room {index}", "kind": "room", "parent_public_id": home["public_id"]},
        )
        for index in range(6)
    ]
    shelves = [
        create_location(
            connection,
            {
                "name": f"Shelf {index}",
                "kind": "shelf",
                "parent_public_id": rooms[index % len(rooms)]["public_id"],
            },
        )
        for index in range(18)
    ]
    for index in range(180):
        create_item(
            connection,
            {
                "name": f"Perf item {index:03d}",
                "description": f"Searchable component batch {index % 12}",
                "location_public_id": shelves[index % len(shelves)]["public_id"],
                "quantity": Decimal((index % 9) + 1),
                "unit": "pcs",
                "brand": f"Brand {index % 5}",
            },
        )
    yield connection
    connection.close()


def counted(connection: sqlite3.Connection, action):
    statements: list[str] = []
    connection.set_trace_callback(
        lambda statement: statements.append(statement)
        if not statement.lstrip().startswith("--")
        else None
    )
    started = time.perf_counter()
    try:
        result = action()
    finally:
        elapsed_ms = (time.perf_counter() - started) * 1000
        connection.set_trace_callback(None)
    return result, statements, elapsed_ms


def test_inventory_listing_stays_under_query_budget(seeded_database: sqlite3.Connection) -> None:
    items, statements, elapsed_ms = counted(
        seeded_database,
        lambda: list_items(seeded_database, query="component", limit=180),
    )

    assert len(items) == 180
    assert len(statements) <= 28
    assert elapsed_ms < 350


def test_location_contents_stays_under_query_budget(seeded_database: sqlite3.Connection) -> None:
    home = seeded_database.execute(
        "SELECT public_id FROM locations WHERE name = 'Home'"
    ).fetchone()["public_id"]
    contents, statements, elapsed_ms = counted(
        seeded_database,
        lambda: location_contents(seeded_database, home),
    )

    assert len(contents["items"]) == 180
    assert len(statements) <= 34
    assert elapsed_ms < 450
