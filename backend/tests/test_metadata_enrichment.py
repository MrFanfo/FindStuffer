from __future__ import annotations

import json
from pathlib import Path

from findstuff.db import connect, migrate, transaction
from findstuff.inventory import create_item, get_item, get_item_row, list_categories
from findstuff.metadata_enrichment import (
    RESPONSE_SCHEMA,
    accept_suggestion,
    create_export_request,
    import_response,
    list_suggestions,
)


def test_external_enrichment_hides_protected_fields_and_reviews_patches(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "findstuff.sqlite3"
    migrate(database_path)
    connection = connect(database_path)
    try:
        electronics_id = next(
            category["id"]
            for category in list_categories(connection)
            if category["slug"] == "electronics"
        )
        item = create_item(
            connection,
            {
                "brand": "",
                "category_id": electronics_id,
                "description": "ESP32 dev board with USB-C",
                "location_public_id": "unassigned",
                "model": "",
                "name": "ESP32-C3 dev board",
                "notes": "Private box note",
                "quantity": "3",
                "serial_number": "PRIVATE-SERIAL",
                "unit": "pcs",
            },
        )
        row = get_item_row(connection, item["public_id"])
        with transaction(connection):
            connection.execute(
                """
                INSERT INTO item_metadata(
                    item_id, path, value_json, value_type, confidence,
                    sources_json, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["id"],
                    "/metadata/electronics/chipset",
                    json.dumps("ESP32-C3"),
                    "string",
                    1.0,
                    "[]",
                    "confirmed",
                ),
            )

        export = create_export_request(connection, limit=10)
        exported_text = json.dumps(export)
        assert "quantity" not in exported_text
        assert "Private box note" not in exported_text
        assert "PRIVATE-SERIAL" not in exported_text
        assert "Unassigned" not in exported_text
        assert "/metadata/electronics/chipset" not in exported_text

        response = {
            "agent": {"name": "test-agent"},
            "export_id": export["export_id"],
            "schema_version": RESPONSE_SCHEMA,
            "suggestions": [
                {
                    "item_public_id": item["public_id"],
                    "item_version": item["version"],
                    "patches": [
                        {
                            "confidence": 0.93,
                            "op": "set",
                            "path": "/metadata/electronics/datasheet_url",
                            "rationale": "Official Espressif product documentation.",
                            "sources": [
                                {
                                    "source_type": "manufacturer",
                                    "title": "ESP32-C3 documentation",
                                    "url": "https://www.espressif.com/",
                                }
                            ],
                            "uncertainty": "Exact board variant still needs review.",
                            "value": "https://www.espressif.com/",
                            "value_type": "string",
                        },
                        {
                            "confidence": 0.99,
                            "op": "set",
                            "path": "/core/quantity",
                            "rationale": "Should be rejected as protected.",
                            "sources": [
                                {
                                    "source_type": "manufacturer",
                                    "title": "Invalid",
                                    "url": "https://example.com/",
                                }
                            ],
                            "uncertainty": "",
                            "value": "999",
                        },
                        {
                            "confidence": 0.99,
                            "op": "set",
                            "path": "/metadata/electronics/chipset",
                            "rationale": "Should be rejected as manually confirmed.",
                            "sources": [
                                {
                                    "source_type": "manufacturer",
                                    "title": "Invalid",
                                    "url": "https://example.com/",
                                }
                            ],
                            "uncertainty": "",
                            "value": "WRONG",
                        },
                    ],
                }
            ],
        }
        result = import_response(connection, response)
        assert result["suggestions"] == 3
        assert result["unsafe"] == 2

        pending = list_suggestions(connection, "pending")
        assert len(pending) == 1
        assert pending[0]["path"] == "/metadata/electronics/datasheet_url"
        accept_suggestion(connection, pending[0]["public_id"])

        updated = get_item(connection, item["public_id"])
        assert updated["quantity"] == "3"
        assert updated["serial_number"] == "PRIVATE-SERIAL"

        accepted_metadata = connection.execute(
            """
            SELECT value_json FROM item_metadata
            WHERE item_id = ? AND path = '/metadata/electronics/datasheet_url'
            """,
            (row["id"],),
        ).fetchone()
        assert json.loads(accepted_metadata["value_json"]) == "https://www.espressif.com/"
    finally:
        connection.close()
