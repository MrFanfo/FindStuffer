from __future__ import annotations

import json
import re
import sqlite3
from decimal import Decimal
from typing import Any

from .db import transaction
from .inventory import (
    ConflictError,
    adjust_quantity,
    create_item,
    get_item,
    get_item_row,
    set_item_tags,
)

OPERATION_ID_PATTERN = re.compile(r"^[A-Za-z0-9:_-]{8,120}$")


def _claim_operation(
    connection: sqlite3.Connection, operation_id: str, kind: str
) -> dict[str, Any] | None:
    if not OPERATION_ID_PATTERN.fullmatch(operation_id):
        raise ValueError("Offline operation ID is invalid")
    existing = connection.execute(
        "SELECT kind, status, result_json FROM offline_operations WHERE operation_id = ?",
        (operation_id,),
    ).fetchone()
    if existing:
        if existing["kind"] != kind:
            raise ConflictError("Offline operation ID was already used for another action")
        if existing["status"] == "applied" and existing["result_json"]:
            return json.loads(existing["result_json"])
        if existing["status"] == "processing":
            raise ConflictError(
                "This offline change may already have been applied; "
                "review the inventory before retrying"
            )
        with transaction(connection):
            connection.execute(
                """
                UPDATE offline_operations
                SET status = 'processing', error = NULL
                WHERE operation_id = ?
                """,
                (operation_id,),
            )
        return None
    with transaction(connection):
        connection.execute(
            "INSERT INTO offline_operations(operation_id, kind) VALUES (?, ?)",
            (operation_id, kind),
        )
    return None


def apply_offline_operation(
    connection: sqlite3.Connection,
    operation_id: str,
    kind: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    replay = _claim_operation(connection, operation_id, kind)
    if replay is not None:
        return {"operation_id": operation_id, "status": "applied", "result": replay}
    try:
        if kind == "create_item":
            values = dict(payload)
            tags = values.pop("tags", [])
            if not isinstance(tags, list):
                raise ValueError("Offline item tags must be a list")
            name = str(values.get("name") or "").strip()
            category_id = values.get("category_id")
            existing = connection.execute(
                """
                SELECT public_id
                FROM items
                WHERE archived_at IS NULL
                  AND name = ? COLLATE NOCASE
                  AND (
                    (category_id IS NULL AND ? IS NULL)
                    OR category_id = ?
                  )
                ORDER BY id DESC
                LIMIT 1
                """,
                (name, category_id, category_id),
            ).fetchone()
            item = (
                get_item(connection, existing["public_id"])
                if existing
                else create_item(connection, values, source="offline")
            )
            if tags:
                item = set_item_tags(
                    connection,
                    item["public_id"],
                    [str(tag) for tag in tags],
                    int(item["version"]),
                )
            result = item
        elif kind == "adjust_quantity":
            item_public_id = str(payload.get("item_public_id") or "")
            delta = Decimal(str(payload.get("delta") or "0"))
            if not item_public_id or delta == 0:
                raise ValueError("Offline quantity change needs an item and non-zero delta")
            row = get_item_row(connection, item_public_id)
            result = adjust_quantity(
                connection,
                item_public_id,
                delta,
                int(row["version"]),
                source="offline",
            )
        else:
            raise ValueError("Unsupported offline operation")
    except Exception as exc:
        with transaction(connection):
            connection.execute(
                """
                UPDATE offline_operations
                SET status = 'failed', error = ?
                WHERE operation_id = ?
                """,
                (str(exc), operation_id),
            )
        raise
    serialized = json.dumps(result, default=str, separators=(",", ":"))
    with transaction(connection):
        connection.execute(
            """
            UPDATE offline_operations
            SET status = 'applied', result_json = ?, error = NULL,
                applied_at = CURRENT_TIMESTAMP
            WHERE operation_id = ?
            """,
            (serialized, operation_id),
        )
    return {
        "operation_id": operation_id,
        "status": "applied",
        "result": get_item(connection, result["public_id"]),
    }
