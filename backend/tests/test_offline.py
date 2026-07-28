from __future__ import annotations

from pathlib import Path

from findstuff.db import connect, migrate
from findstuff.inventory import create_item, get_item
from findstuff.offline import apply_offline_operation


def test_offline_create_and_adjust_are_idempotent(tmp_path: Path) -> None:
    path = tmp_path / "offline.sqlite3"
    migrate(path)
    connection = connect(path)
    try:
        created = apply_offline_operation(
            connection,
            "offline:create-123",
            "create_item",
            {"name": "Offline torch", "quantity": 2, "unit": "pcs"},
        )
        replay = apply_offline_operation(
            connection,
            "offline:create-123",
            "create_item",
            {"name": "Offline torch", "quantity": 2, "unit": "pcs"},
        )
        assert replay["result"]["public_id"] == created["result"]["public_id"]
        assert connection.execute(
            "SELECT count(*) FROM items WHERE name = 'Offline torch'"
        ).fetchone()[0] == 1

        item = create_item(connection, {"name": "Cable", "quantity": 5})
        adjusted = apply_offline_operation(
            connection,
            "offline:adjust-123",
            "adjust_quantity",
            {"item_public_id": item["public_id"], "delta": -2},
        )
        replay_adjustment = apply_offline_operation(
            connection,
            "offline:adjust-123",
            "adjust_quantity",
            {"item_public_id": item["public_id"], "delta": -2},
        )
        assert adjusted["result"]["quantity"] == "3"
        assert replay_adjustment["result"]["quantity"] == "3"
        assert get_item(connection, item["public_id"])["quantity"] == "3"
    finally:
        connection.close()
