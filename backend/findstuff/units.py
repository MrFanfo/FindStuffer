"""Shared unit settings used by the API and operations contract."""

import json
import sqlite3

from .db import transaction

DEFAULT_UNITS = [
    "pcs",
    "box",
    "pack",
    "bag",
    "tin",
    "spool",
    "g",
    "kg",
    "ml",
    "l",
    "m",
    "cm",
    "mm",
    "roll",
    "pair",
    "set",
]


def inventory_units(database: sqlite3.Connection) -> list[str]:
    row = database.execute(
        "SELECT value_json FROM app_settings WHERE key = 'inventory_units'"
    ).fetchone()
    if row is None:
        return DEFAULT_UNITS
    try:
        stored = json.loads(row["value_json"])
    except json.JSONDecodeError:
        return DEFAULT_UNITS
    if not isinstance(stored, list):
        return DEFAULT_UNITS
    cleaned = [str(unit).strip() for unit in stored if isinstance(unit, str) and str(unit).strip()]
    return list(dict.fromkeys([*DEFAULT_UNITS, *cleaned]))[:80]


def save_inventory_units(database: sqlite3.Connection, units: list[str]) -> list[str]:
    cleaned = [unit.strip() for unit in units if unit.strip() and len(unit.strip()) <= 24]
    merged = list(dict.fromkeys([*DEFAULT_UNITS, *cleaned]))[:80]
    with transaction(database):
        database.execute(
            """
            INSERT INTO app_settings(key, value_json)
            VALUES ('inventory_units', ?)
            ON CONFLICT(key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (json.dumps(merged, separators=(",", ":")),),
        )
    return merged
