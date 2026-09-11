"""Complete inventory search/filtering with counts and scoped keyset cursors."""

from __future__ import annotations

import base64
import hashlib
import json
import sqlite3
from datetime import date, timedelta
from typing import Any

from .human_search import _fuzzy_score, _variants, normalize_query
from .inventory import _fts_expression, serialize_item_rows
from .inventory_formula import compile_formula

SOURCE = """
WITH RECURSIVE
place_paths(id, path) AS (
    SELECT id, name FROM locations WHERE parent_id IS NULL
    UNION ALL SELECT l.id, p.path || ' > ' || l.name
    FROM locations l JOIN place_paths p ON l.parent_id = p.id
),
category_paths(id, path) AS (
    SELECT id, name FROM categories WHERE parent_id IS NULL
    UNION ALL SELECT c.id, p.path || ' > ' || c.name
    FROM categories c JOIN category_paths p ON c.parent_id = p.id
),
records AS (
    SELECT items.*, l.public_id AS location_public_id, l.name AS location_name,
        c.name AS category_name, c.slug AS category_slug, c.parent_id AS category_parent_id,
        COALESCE(cp.path, '') AS category_path, COALESCE(lp.path, '') AS location_path,
        COALESCE(NULLIF(items.barcode_override, ''), products.barcode, '') AS barcode,
        (SELECT json_group_array(tags.name) FROM tags
          JOIN item_tags t ON t.tag_id = tags.id WHERE t.item_id = items.id) AS tags_json,
        CASE WHEN items.low_stock_milli IS NOT NULL
          AND items.quantity_milli <= items.low_stock_milli THEN 'true' ELSE 'false'
          END AS low_stock_text,
        CASE WHEN EXISTS(SELECT 1 FROM photos WHERE photos.item_id = items.id)
          THEN 'true' ELSE 'false' END AS has_photo_text,
        CASE WHEN l.public_id = 'unassigned' THEN 'true' ELSE 'false'
          END AS missing_location_text
    FROM items JOIN locations l ON l.id = items.location_id
    LEFT JOIN categories c ON c.id = items.category_id
    LEFT JOIN products ON products.id = items.product_id
    LEFT JOIN place_paths lp ON lp.id = l.id
    LEFT JOIN category_paths cp ON cp.id = c.id
)
"""
SORTS = {
    "updated": ("i.updated_at", "DESC"),
    "name": ("lower(i.name)", "ASC"),
    "location": ("lower(i.location_path)", "ASC"),
    "quantity-asc": ("i.quantity_milli", "ASC"),
    "quantity-desc": ("i.quantity_milli", "DESC"),
    "expiration": ("COALESCE(i.expiration_date, '9999-12-31')", "ASC"),
}


def _filter_sql(kind: str) -> tuple[str, list[Any]]:
    today = date.today()
    day = lambda offset: (today + timedelta(days=offset)).isoformat()  # noqa: E731
    clauses: dict[str, tuple[str, list[Any]]] = {
        "all": ("1", []),
        "low": ("i.low_stock_text = 'true'", []),
        "details": ("i.location_public_id = 'unassigned'", []),
        "zero": ("i.quantity_milli = 0", []),
        "in-stock": ("i.quantity_milli > 0 AND i.low_stock_text = 'false'", []),
        "expired": ("i.expiration_date < ?", [day(0)]),
        "expiring": (
            "i.expiration_date <= ? OR EXISTS (SELECT 1 FROM item_lots lot "
            "WHERE lot.item_id=i.id AND lot.quantity_milli > 0 "
            "AND lot.expiration_date <= ?)",
            [day(14), day(14)],
        ),
        "expiring-week": ("i.expiration_date BETWEEN ? AND ?", [day(0), day(7)]),
        "expiring-30": ("i.expiration_date BETWEEN ? AND ?", [day(0), day(30)]),
        "expiry-8-30": ("i.expiration_date > ? AND i.expiration_date <= ?", [day(7), day(30)]),
        "expiry-31-90": ("i.expiration_date > ? AND i.expiration_date <= ?", [day(30), day(90)]),
        "expiry-later": ("i.expiration_date > ?", [day(90)]),
        "no-expiry": ("i.expiration_date IS NULL", []),
        "missing-photo": ("i.has_photo_text = 'false'", []),
        "uncategorized": ("i.category_id IS NULL", []),
        "missing-notes": ("trim(i.description) = '' AND trim(i.notes) = ''", []),
        "priced": ("COALESCE(i.estimated_price_minor, i.purchase_price_minor) IS NOT NULL", []),
        "added-30": ("date(i.created_at) >= ?", [day(-30)]),
        "added-90": ("date(i.created_at) < ? AND date(i.created_at) >= ?", [day(-30), day(-90)]),
        "added-365": ("date(i.created_at) < ? AND date(i.created_at) >= ?", [day(-90), day(-365)]),
        "added-older": ("date(i.created_at) < ?", [day(-365)]),
    }
    if kind not in clauses:
        raise ValueError("Unknown inventory filter")
    return clauses[kind]


def _search_sql(
    connection: sqlite3.Connection, query: str
) -> tuple[str, list[Any], list[str], bool]:
    if not query.strip():
        return "1", [], [], False
    if query.casefold().startswith("parts for "):
        from .compatibility import compatible_item_ids

        ids = compatible_item_ids(connection, query[10:].strip())
        return (
            "i.id IN (SELECT value FROM json_each(?))",
            [json.dumps(ids)],
            ["compatible parts"],
            False,
        )
    variants, aliases = _variants(connection, query)
    clauses, parameters, matched_by = [], [], []
    for variant in variants:
        expression = _fts_expression(variant)
        if (
            expression
            and connection.execute(
                "SELECT 1 FROM item_fts JOIN items ON items.id = item_fts.item_id "
                "WHERE item_fts MATCH ? AND items.archived_at IS NULL LIMIT 1",
                (expression,),
            ).fetchone()
        ):
            clauses.append("i.id IN (SELECT item_id FROM item_fts WHERE item_fts MATCH ?)")
            parameters.append(expression)
            if variant != normalize_query(query):
                matched_by.append(f"related term: {variant}")
    for alias in aliases:
        if alias["target_type"] == "item" and alias["target_public_id"]:
            clauses.append("i.public_id = ?")
            parameters.append(alias["target_public_id"])
            matched_by.append("item alias")
        elif alias["target_type"] == "location" and alias["target_public_id"]:
            clauses.append(
                "i.location_id IN (WITH RECURSIVE subtree(id) AS ("
                "SELECT id FROM locations WHERE public_id = ? UNION ALL "
                "SELECT l.id FROM locations l JOIN subtree s ON l.parent_id = s.id"
                ") SELECT id FROM subtree)"
            )
            parameters.append(alias["target_public_id"])
            matched_by.append("place alias")
    if clauses:
        return "(" + " OR ".join(clauses) + ")", parameters, matched_by, False
    # Fuzzy fallback examines every active record; it must not drop older items.
    ids = []
    for row in connection.execute(SOURCE + "SELECT i.* FROM records i WHERE i.archived_at IS NULL"):
        candidate = dict(row)
        candidate["tags"] = json.loads(row["tags_json"] or "[]")
        if _fuzzy_score(normalize_query(query), candidate) >= 0.46:
            ids.append(row["id"])
    return (
        "i.id IN (SELECT value FROM json_each(?))",
        [json.dumps(ids)],
        ["typo-tolerant match"] if ids else [],
        bool(ids),
    )


def query_inventory(
    connection: sqlite3.Connection,
    *,
    query: str = "",
    filter_name: str = "all",
    sort: str = "updated",
    location: str | None = None,
    category_id: int | None = None,
    tag: str = "",
    compatibility: str = "",
    include_zero: bool = False,
    formula: Any = None,
    limit: int = 100,
    cursor: str | None = None,
) -> dict[str, Any]:
    if sort not in SORTS:
        raise ValueError("Unknown inventory sort")
    if len(query) > 300 or len(tag) > 240:
        raise ValueError("Search or tag is too long")
    limit = max(1, min(limit, 250))
    formula_condition, formula_values = compile_formula(formula)
    scope = hashlib.sha256(
        json.dumps(
            [
                query,
                filter_name,
                sort,
                location,
                category_id,
                tag,
                compatibility,
                include_zero,
                formula_condition,
                formula_values,
            ],
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()[:24]
    condition, values = _filter_sql(filter_name)
    conditions = ["i.archived_at IS NULL", f"({condition})"]
    if not include_zero and filter_name not in {"low", "zero"}:
        conditions.append("i.quantity_milli > 0")
    if location:
        conditions.append(
            "i.location_id IN (WITH RECURSIVE subtree(id) AS ("
            "SELECT id FROM locations WHERE public_id = ? UNION ALL "
            "SELECT l.id FROM locations l JOIN subtree s ON l.parent_id = s.id"
            ") SELECT id FROM subtree)"
        )
        values.append(location)
    if category_id is not None:
        conditions.append(
            "i.category_id IN (WITH RECURSIVE subtree(id) AS ("
            "SELECT id FROM categories WHERE id = ? UNION ALL "
            "SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id"
            ") SELECT id FROM subtree)"
        )
        values.append(category_id)
    if compatibility:
        from .compatibility import compatible_item_ids

        conditions.append("i.id IN (SELECT value FROM json_each(?))")
        values.append(json.dumps(compatible_item_ids(connection, compatibility)))
    if tag:
        conditions.append("EXISTS (SELECT 1 FROM json_each(i.tags_json) WHERE value = ?)")
        values.append(tag)
    conditions.append(f"({formula_condition})")
    values.extend(formula_values)
    search_condition, search_values, matched_by, fuzzy = _search_sql(connection, query)
    conditions.append(search_condition)
    values.extend(search_values)
    where = " AND ".join(conditions)
    total = connection.execute(
        SOURCE + f"SELECT count(*) FROM records i WHERE {where}", values
    ).fetchone()[0]
    sort_expression, direction = SORTS[sort]
    rank_expression = (
        "CASE WHEN instr(lower(i.name), (SELECT needle FROM search_input))>0 THEN 0 ELSE 1 END"
    )
    ranked_source = SOURCE.replace(
        "WITH RECURSIVE", "WITH RECURSIVE search_input(needle) AS (VALUES (?)),", 1
    )
    if cursor:
        try:
            data = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
            version, cursor_scope, value, item_id, rank = data
            if (
                version != 2
                or rank not in (0, 1)
                or cursor_scope != scope
                or not isinstance(item_id, int)
            ):
                raise ValueError
            if not isinstance(value, (str, int, float)):
                raise ValueError
        except (ValueError, TypeError, UnicodeError) as exc:
            raise ValueError("Invalid inventory cursor or changed filters") from exc
        comparison = "<" if direction == "DESC" else ">"
        where += (
            f" AND ({rank_expression} > ? OR ({rank_expression} = ? AND "
            f"({sort_expression} {comparison} ? OR "
            f"({sort_expression} = ? AND i.id {comparison} ?))))"
        )
        values.extend((rank, rank, value, value, item_id))
    rows = connection.execute(
        ranked_source + f"SELECT i.*, {sort_expression} AS cursor_value, "
        f"{rank_expression} AS match_rank FROM records i WHERE {where} "
        f"ORDER BY match_rank ASC, {sort_expression} {direction}, i.id {direction} LIMIT ?",
        [query.strip().lower(), *values, limit + 1],
    ).fetchall()
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = None
    if has_more:
        payload = json.dumps(
            [2, scope, rows[-1]["cursor_value"], rows[-1]["id"], rows[-1]["match_rank"]]
        ).encode()
        next_cursor = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    return {
        "available_tags": [
            row[0]
            for row in connection.execute(
                "SELECT DISTINCT tags.name FROM tags JOIN item_tags t ON t.tag_id=tags.id "
                "JOIN items ON items.id=t.item_id "
                "WHERE items.archived_at IS NULL ORDER BY tags.name"
            )
        ],
        "query": query,
        "normalized_query": normalize_query(query),
        "count": total,
        "total": total,
        "items": serialize_item_rows(connection, rows),
        "next_cursor": next_cursor,
        "has_more": has_more,
        "matched_by": matched_by,
        "fuzzy": fuzzy,
        "can_add": total == 0,
        "can_mark_lost": total == 0,
    }
