from __future__ import annotations

import sqlite3
from decimal import Decimal
from pathlib import Path

from findstuff.db import connect, migrate
from findstuff.extended import (
    add_shopping,
    apply_import_merge,
    create_loan,
    create_project,
    export_inventory,
    generate_low_stock_shopping,
    list_loans,
    list_projects,
    list_shopping,
    reserve_item,
    return_loan,
    set_project_status,
)
from findstuff.inventory import create_item


def test_shopping_reservations_and_export(tmp_path: Path) -> None:
    path = tmp_path / "extended.sqlite3"
    migrate(path)
    connection: sqlite3.Connection = connect(path)
    try:
        item = create_item(
            connection,
            {
                "name": "M3 bolts",
                "quantity": Decimal("3"),
                "low_stock_threshold": Decimal("5"),
            },
        )
        assert generate_low_stock_shopping(connection) == 1
        assert list_shopping(connection)[0]["name"] == "M3 bolts"
        linked = add_shopping(
            connection,
            item["name"],
            Decimal("2"),
            item["unit"],
            item["public_id"],
        )
        assert linked["item_public_id"] == item["public_id"]
        assert len(list_shopping(connection)) == 1

        project = create_project(connection, "Robot arm")
        reserve_item(connection, project["public_id"], item["public_id"], Decimal("1"))
        reserve_item(connection, project["public_id"], item["public_id"], Decimal("3"))
        assert list_projects(connection)[0]["reservations"][0]["item_name"] == "M3 bolts"
        assert list_projects(connection)[0]["reservations"][0]["quantity"] == "3"
        set_project_status(connection, project["public_id"], "completed")

        loan = create_loan(
            connection,
            item["public_id"],
            "lent",
            "Ada",
            Decimal("1"),
            None,
            "For the robot",
        )
        assert list_loans(connection)[0]["person"] == "Ada"
        return_loan(connection, loan["public_id"])
        assert list_loans(connection)[0]["returned_at"] is not None
        exported = export_inventory(connection)
        assert exported["format"] == "findstuff-export-v1"
        assert len(exported["tables"]["project_reservations"]) == 1
    finally:
        connection.close()


def test_export_can_be_merged_into_a_fresh_database(tmp_path: Path) -> None:
    source_path = tmp_path / "source.sqlite3"
    target_path = tmp_path / "target.sqlite3"
    migrate(source_path)
    source = connect(source_path)
    create_item(source, {"name": "Imported oscilloscope", "quantity": 1})
    exported = export_inventory(source)
    source.close()

    migrate(target_path)
    target = connect(target_path)
    try:
        result = apply_import_merge(target, exported)
        assert result["created"]["items"] == 1
        assert (
            target.execute(
                "SELECT count(*) FROM items WHERE name = 'Imported oscilloscope'"
            ).fetchone()[0]
            == 1
        )
        repeated = apply_import_merge(target, exported)
        assert repeated["created"]["items"] == 0
    finally:
        target.close()
