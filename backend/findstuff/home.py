"""Home preferences and actionable reminders for the single-owner inventory."""

import json
import sqlite3
from typing import Any

from .db import transaction

DEFAULTS = {"pinned_places": [], "favorite_categories": [], "show_shopping": True}


def preferences(connection: sqlite3.Connection) -> dict[str, Any]:
    row = connection.execute(
        "SELECT value_json FROM app_settings WHERE key='home_preferences'"
    ).fetchone()
    return {**DEFAULTS, **(json.loads(row[0]) if row else {})}


def save_preferences(connection: sqlite3.Connection, values: dict[str, Any]) -> dict[str, Any]:
    if set(values) - DEFAULTS.keys():
        raise ValueError("Unknown Home preference")
    for key, value in values.items():
        if key == "show_shopping":
            if not isinstance(value, bool):
                raise ValueError("Shopping visibility must be true or false")
        elif (
            not isinstance(value, list)
            or len(value) > 100
            or any(
                not isinstance(entry, int if key == "favorite_categories" else str)
                for entry in value
            )
        ):
            raise ValueError("Invalid favorites")
    with transaction(connection):
        result = {**preferences(connection), **values}
        connection.execute(
            "INSERT INTO app_settings(key,value_json) VALUES('home_preferences',?) "
            "ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, "
            "updated_at=CURRENT_TIMESTAMP",
            (json.dumps(result),),
        )
    return result


def attention(connection: sqlite3.Connection) -> dict[str, Any]:
    rows = connection.execute("""
        SELECT 'maintenance' AS kind, i.public_id AS item_id, i.name AS item_name,
               m.title AS title, m.next_due_at AS due
        FROM maintenance_tasks m JOIN items i ON i.id=m.item_id
        WHERE m.archived_at IS NULL AND i.archived_at IS NULL
          AND date(m.next_due_at) <= date('now', '+14 days')
        UNION ALL
        SELECT 'loan', i.public_id, i.name, 'Loan: ' || l.person, l.due_date
        FROM loans l JOIN items i ON i.id=l.item_id
        WHERE l.returned_at IS NULL AND date(l.due_date) <= date('now', '+14 days')
          AND i.archived_at IS NULL
        UNION ALL
        SELECT 'warranty', i.public_id, i.name, 'Warranty ends', d.warranty_expires_at
        FROM item_documents d JOIN items i ON i.id=d.item_id
        WHERE i.archived_at IS NULL
          AND date(d.warranty_expires_at) BETWEEN date('now') AND date('now', '+30 days')
        ORDER BY due
    """).fetchall()
    return {
        "reminders": [dict(row) for row in rows],
        "ai_pending": connection.execute(
            "SELECT count(*) FROM ai_scan_proposals WHERE status IN ('pending','failed')"
        ).fetchone()[0],
    }
