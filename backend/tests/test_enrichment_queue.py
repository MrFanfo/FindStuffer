from __future__ import annotations

from pathlib import Path

from findstuff.db import connect, migrate
from findstuff.enrichment import count_missing_enrichment, queue_missing_enrichment
from findstuff.inventory import create_item, list_categories


def test_missing_enrichment_count_matches_queue_candidates(tmp_path: Path) -> None:
    database_path = tmp_path / "findstuff.sqlite3"
    migrate(database_path)
    connection = connect(database_path)
    try:
        categories = {entry["slug"]: entry["id"] for entry in list_categories(connection)}
        create_item(
            connection,
            {
                "name": "Barcode pasta",
                "barcode": "8000000000001",
                "category_id": categories["groceries"],
            },
        )
        create_item(
            connection,
            {
                "name": "Barcode circuit board",
                "barcode": "8000000000002",
                "category_id": categories["electronics"],
            },
        )
        create_item(
            connection,
            {
                "name": "Pasta without barcode",
                "category_id": categories["groceries"],
            },
        )

        assert count_missing_enrichment(connection) == 1
        assert queue_missing_enrichment(connection) == 1
        assert count_missing_enrichment(connection) == 0
    finally:
        connection.close()
