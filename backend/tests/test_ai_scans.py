from __future__ import annotations

import json
from pathlib import Path

from findstuff.ai_scans import approve_scan, create_scan, get_scan, reject_scan, update_scan
from findstuff.db import connect, migrate
from findstuff.inventory import create_location, get_item


def proposal(name: str = "Cordless drill") -> dict:
    return {
        "item": {
            "name": name,
            "description": "A compact battery-powered drill.",
            "notes": "",
            "category_id": None,
            "quantity": "1",
            "unit": "pcs",
            "brand": "Acme",
            "model": "D12",
            "serial_number": "",
            "barcode": "",
            "links": [],
        },
        "confidence": 0.88,
        "warnings": [],
        "research": None,
    }


def test_ai_scan_can_be_edited_approved_and_rejected(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    database_path = tmp_path / "ai-scans.sqlite3"
    migrate(database_path)
    connection = connect(database_path)
    try:
        workshop = create_location(connection, {"name": "Workshop"})
        shelf = create_location(
            connection,
            {"name": "Shelf", "parent_public_id": workshop["public_id"]},
        )
        scan = create_scan(
            connection,
            location_public_id=workshop["public_id"],
            data=b"\xff\xd8\xffscan-one",
            declared_type="image/jpeg",
            width=1200,
            height=900,
        )
        connection.execute(
            """
            UPDATE ai_scan_proposals
            SET status = 'pending', proposal_json = ?
            WHERE public_id = ?
            """,
            (json.dumps(proposal()), scan["public_id"]),
        )

        edited = update_scan(
            connection,
            scan["public_id"],
            {
                "name": "12V cordless drill",
                "quantity": "2",
                "location_public_id": shelf["public_id"],
            },
        )
        assert edited["proposal"]["item"]["name"] == "12V cordless drill"
        assert edited["location_path"] == "Workshop > Shelf"

        item = approve_scan(connection, scan["public_id"])
        saved = get_item(connection, item["public_id"])
        assert saved["name"] == "12V cordless drill"
        assert saved["quantity"] == "2"
        assert saved["location_path"] == "Workshop > Shelf"
        assert connection.execute(
            "SELECT count(*) AS count FROM photos WHERE item_id = "
            "(SELECT id FROM items WHERE public_id = ?)",
            (item["public_id"],),
        ).fetchone()["count"] == 1
        assert get_scan(connection, scan["public_id"])["status"] == "approved"

        rejected = create_scan(
            connection,
            location_public_id=workshop["public_id"],
            data=b"\xff\xd8\xffscan-two",
            declared_type="image/jpeg",
            width=None,
            height=None,
        )
        connection.execute(
            "UPDATE ai_scan_proposals SET status = 'pending', proposal_json = ? "
            "WHERE public_id = ?",
            (json.dumps(proposal("Tape measure")), rejected["public_id"]),
        )
        photo_path = tmp_path / "ai-scans" / f"{rejected['public_id']}.jpg"
        assert photo_path.exists()
        reject_scan(connection, rejected["public_id"])
        assert not photo_path.exists()
        assert get_scan(connection, rejected["public_id"])["status"] == "rejected"
    finally:
        connection.close()
