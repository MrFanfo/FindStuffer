from __future__ import annotations

import re
import sqlite3
from difflib import SequenceMatcher
from typing import Any

from .db import transaction
from .inventory import new_public_id

BUILTIN_SYNONYMS = {
    "screwdriver": ("driver", "phillips driver", "flathead driver"),
    "screwdrivers": ("screwdriver", "driver", "phillips driver", "flathead driver"),
    "torch": ("flashlight",),
    "flashlight": ("torch",),
    "cellphone": ("phone", "mobile"),
    "mobile": ("phone", "cellphone"),
    "adapter": ("adaptor", "charger"),
    "adaptor": ("adapter", "charger"),
    "cable": ("cord", "lead"),
    "cord": ("cable", "lead"),
}


def normalize_query(value: str) -> str:
    return " ".join(re.findall(r"[\w-]+", value.casefold(), flags=re.UNICODE))[:300]


def _variants(connection: sqlite3.Connection, query: str) -> tuple[list[str], list[sqlite3.Row]]:
    normalized = normalize_query(query)
    variants = [normalized]
    for token in normalized.split():
        variants.extend(BUILTIN_SYNONYMS.get(token, ()))
        if len(token) > 3 and token.endswith("s"):
            variants.append(token[:-1])
    aliases = connection.execute(
        "SELECT * FROM search_aliases WHERE alias = ? COLLATE NOCASE ORDER BY id",
        (normalized,),
    ).fetchall()
    variants.extend(row["replacement"] for row in aliases if row["replacement"])
    return list(dict.fromkeys(value for value in variants if value)), aliases


def _fuzzy_score(query: str, item: dict[str, Any]) -> float:
    fields = [
        item["name"],
        item.get("brand", ""),
        item.get("model", ""),
        item.get("category_path") or "",
        item.get("location_path", ""),
        " ".join(item.get("tags", [])),
    ]
    query_tokens = set(query.split())
    best = 0.0
    for field in fields:
        normalized = normalize_query(str(field))
        if not normalized:
            continue
        ratio = SequenceMatcher(None, query, normalized).ratio()
        field_tokens = set(normalized.split())
        overlap = len(query_tokens & field_tokens) / max(len(query_tokens), 1)
        contained = 1.0 if query in normalized or normalized in query else 0.0
        best = max(best, ratio * 0.55 + overlap * 0.3 + contained * 0.15)
    return best


def human_search(
    connection: sqlite3.Connection,
    query: str,
    *,
    include_zero: bool = False,
    limit: int = 100,
    cursor: str | None = None,
) -> dict[str, Any]:
    from .inventory_query import query_inventory

    result = query_inventory(
        connection, query=query, include_zero=include_zero, limit=limit, cursor=cursor
    )
    if cursor:
        return result
    normalized = normalize_query(query)
    _, aliases = _variants(connection, query)
    with transaction(connection):
        dismissed = connection.execute(
            "SELECT 1 FROM dismissed_search_observations WHERE normalized_query = ?",
            (normalized,),
        ).fetchone()
        if dismissed is None:
            connection.execute(
                """
                INSERT INTO search_observations(
                    normalized_query, original_query, result_count, search_count
                ) VALUES (?, ?, ?, 1)
                ON CONFLICT(normalized_query) DO UPDATE SET
                    original_query = excluded.original_query,
                    result_count = excluded.result_count,
                    search_count = search_count + 1,
                    last_searched_at = CURRENT_TIMESTAMP
                """,
                (normalized, query[:300], result["total"]),
            )
        if aliases:
            connection.executemany(
                "UPDATE search_aliases SET use_count = use_count + 1, "
                "updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                [(row["id"],) for row in aliases],
            )
    return result


def list_aliases(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    return [
        dict(row)
        for row in connection.execute(
            "SELECT public_id, alias, target_type, replacement, target_public_id, "
            "source, use_count, created_at, updated_at FROM search_aliases "
            "ORDER BY alias COLLATE NOCASE"
        )
    ]


def search_learning_candidates(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    return [
        dict(row)
        for row in connection.execute(
            """
            SELECT normalized_query, original_query, result_count, search_count,
                   last_searched_at
            FROM search_observations
            WHERE result_count = 0 AND search_count >= 2
            ORDER BY search_count DESC, last_searched_at DESC
            LIMIT 30
            """
        )
    ]


def delete_search_observation(connection: sqlite3.Connection, query: str) -> None:
    normalized = normalize_query(query)
    if not normalized:
        raise ValueError("Search suggestion not found")
    with transaction(connection):
        connection.execute(
            "INSERT OR IGNORE INTO dismissed_search_observations(normalized_query) VALUES (?)",
            (normalized,),
        )
        cursor = connection.execute(
            "DELETE FROM search_observations WHERE normalized_query = ?", (normalized,)
        )
    if cursor.rowcount != 1:
        raise ValueError("Search suggestion not found")


def save_alias(connection: sqlite3.Connection, values: dict[str, Any]) -> dict[str, Any]:
    alias = normalize_query(values["alias"])
    if not alias:
        raise ValueError("Alias cannot be empty")
    target_type = values["target_type"]
    target_public_id = values.get("target_public_id") or None
    replacement = normalize_query(values.get("replacement", ""))
    if target_type == "term" and not replacement:
        raise ValueError("Term aliases require a replacement")
    if target_type in {"item", "location"} and not target_public_id:
        raise ValueError("Entity aliases require a target")
    public_id = new_public_id("alias")
    with transaction(connection):
        connection.execute(
            """
            INSERT INTO search_aliases(
                public_id, alias, target_type, replacement, target_public_id, source
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(alias, target_type, target_public_id) DO UPDATE SET
                replacement = excluded.replacement,
                source = excluded.source,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                public_id,
                alias,
                target_type,
                replacement,
                target_public_id,
                values.get("source", "manual"),
            ),
        )
    row = connection.execute(
        "SELECT * FROM search_aliases WHERE alias = ? COLLATE NOCASE "
        "AND target_type = ? AND target_public_id IS ?",
        (alias, target_type, target_public_id),
    ).fetchone()
    return dict(row)


def delete_alias(connection: sqlite3.Connection, public_id: str) -> None:
    with transaction(connection):
        cursor = connection.execute("DELETE FROM search_aliases WHERE public_id = ?", (public_id,))
    if cursor.rowcount != 1:
        raise ValueError("Search alias not found")
