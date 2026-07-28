from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from findstuff.ai_commands import AdjustAction, Proposal, confirm_command, resolve_proposal
from findstuff.db import connect, migrate
from findstuff.inventory import create_item, create_location, get_item


def test_ai_proposal_is_resolved_then_explicitly_confirmed(tmp_path: Path) -> None:
    path = tmp_path / "ai.sqlite3"
    migrate(path)
    connection = connect(path)
    try:
        location = create_location(connection, {"name": "Studio"})
        item = create_item(
            connection,
            {
                "name": "ESP32 boards",
                "location_public_id": location["public_id"],
                "quantity": Decimal("3"),
            },
        )
        proposal = Proposal(
            summary="Use one ESP32 board",
            action=AdjustAction(type="adjust_quantity", item="ESP32 boards", delta=-1),
        )
        resolved = resolve_proposal(connection, proposal)
        expires = datetime.now(UTC) + timedelta(minutes=5)
        connection.execute(
            """
            INSERT INTO ai_commands(
                public_id, raw_text, proposal_json, resolved_json, status, expires_at
            ) VALUES ('cmd_test', 'remove one ESP32 board', ?, ?, 'proposed', ?)
            """,
            (
                proposal.model_dump_json(),
                json.dumps(resolved),
                expires.strftime("%Y-%m-%d %H:%M:%S"),
            ),
        )
        result = confirm_command(connection, "cmd_test")
        assert result["status"] == "applied"
        assert get_item(connection, item["public_id"])["quantity"] == "2"
        event = connection.execute(
            "SELECT source FROM inventory_events ORDER BY id DESC LIMIT 1"
        ).fetchone()
        assert event["source"] == "ai"
    finally:
        connection.close()


def test_ai_operations_are_applied_as_one_undoable_import(tmp_path: Path) -> None:
    path = tmp_path / "ai-operations.sqlite3"
    migrate(path)
    connection = connect(path)
    try:
        resolved = {
            "format": "findstuff-ops-v1",
            "operations": [
                {
                    "op": "add",
                    "type": "location",
                    "data": {"name": "AI shelf", "kind": "shelf"},
                },
                {
                    "op": "add",
                    "type": "item",
                    "data": {
                        "name": "Test boards",
                        "quantity": 3,
                        "unit": "pcs",
                        "location": "AI shelf",
                    },
                },
            ],
        }
        expires = datetime.now(UTC) + timedelta(minutes=5)
        connection.execute(
            """
            INSERT INTO ai_commands(
                public_id, raw_text, proposal_json, resolved_json, status, expires_at
            ) VALUES ('cmd_operations', 'create a shelf and add boards', '{}', ?,
                      'proposed', ?)
            """,
            (
                json.dumps(resolved),
                expires.strftime("%Y-%m-%d %H:%M:%S"),
            ),
        )

        result = confirm_command(connection, "cmd_operations")

        assert result["status"] == "applied"
        assert result["result"]["created"]["add"] == 2
        assert result["result"]["import_public_id"].startswith("imp_")
        item = connection.execute(
            "SELECT name FROM items WHERE name = 'Test boards'"
        ).fetchone()
        assert item["name"] == "Test boards"
        batch = connection.execute(
            "SELECT undo_json FROM import_batches WHERE public_id = ?",
            (result["result"]["import_public_id"],),
        ).fetchone()
        assert len(json.loads(batch["undo_json"])) == 2
    finally:
        connection.close()
