from __future__ import annotations

import json
import sqlite3
from collections import Counter
from datetime import UTC, datetime
from typing import Any

from .db import transaction
from .inventory import ConflictError, get_category_row, get_item, list_categories

FORMAT = "findstuff.off-category-mappings.v1"


def category_label(tag: str) -> str:
    value = tag.strip()
    if ":" in value and len(value.split(":", 1)[0]) <= 3:
        value = value.split(":", 1)[1]
    return value.replace("-", " ").strip()


def observe_categories(
    connection: sqlite3.Connection,
    tags: list[str],
    barcode: str = "",
    leaf_tags: list[str] | None = None,
) -> None:
    cleaned = list(dict.fromkeys(tag.strip() for tag in tags if tag.strip()))
    if not cleaned:
        return
    leaves = set(leaf_tags or cleaned[-1:])
    with transaction(connection):
        for tag in cleaned:
            connection.execute(
                """
                INSERT INTO off_category_observations(off_tag, label, scan_count)
                VALUES (?, ?, 1)
                ON CONFLICT(off_tag) DO UPDATE SET
                    label = excluded.label,
                    scan_count = off_category_observations.scan_count + 1,
                    last_seen_at = CURRENT_TIMESTAMP
                """,
                (tag, category_label(tag)),
            )
            if barcode:
                connection.execute(
                    """
                    INSERT INTO off_category_product_tags(barcode, off_tag, is_leaf)
                    VALUES (?, ?, ?)
                    ON CONFLICT(barcode, off_tag) DO UPDATE SET
                        is_leaf = excluded.is_leaf,
                        last_seen_at = CURRENT_TIMESTAMP
                    """,
                    (barcode, tag, 1 if tag in leaves else 0),
                )


def backfill_observations(connection: sqlite3.Connection) -> None:
    counts: Counter[str] = Counter()
    products: list[tuple[str, list[str], list[str]]] = []
    for row in connection.execute(
        "SELECT response_json FROM external_cache WHERE provider = 'barcode_lookup'"
    ):
        try:
            envelope = json.loads(row["response_json"] or "{}")
        except json.JSONDecodeError:
            continue
        product = envelope.get("product") if isinstance(envelope, dict) else None
        if not isinstance(product, dict):
            continue
        tags = product.get("categories") or product.get("categories_tags") or []
        if isinstance(tags, list):
            cleaned = list(dict.fromkeys(str(tag).strip() for tag in tags if str(tag).strip()))
            counts.update(cleaned)
            if cleaned:
                direct = product.get("direct_categories")
                leaves = (
                    [str(tag) for tag in direct if str(tag).strip()]
                    if isinstance(direct, list) and direct
                    else cleaned[-1:]
                )
                products.append(
                    (
                        str(product.get("barcode") or product.get("code") or ""),
                        cleaned,
                        leaves,
                    )
                )
    if not counts:
        return
    with transaction(connection):
        for tag, count in counts.items():
            connection.execute(
                """
                INSERT INTO off_category_observations(off_tag, label, scan_count)
                VALUES (?, ?, ?)
                ON CONFLICT(off_tag) DO NOTHING
                """,
                (tag, category_label(tag), count),
            )
        for barcode, tags, leaves in products:
            if not barcode:
                continue
            for tag in tags:
                connection.execute(
                    """
                    INSERT INTO off_category_product_tags(barcode, off_tag, is_leaf)
                    VALUES (?, ?, ?)
                    ON CONFLICT(barcode, off_tag) DO NOTHING
                    """,
                    (barcode, tag, 1 if tag in leaves else 0),
                )


def _automatic_category(categories: list[dict[str, Any]], tags: list[str]) -> dict[str, Any] | None:
    labels = [category_label(tag).casefold() for tag in tags]
    source_text = " ".join(labels)
    ranked: list[tuple[int, dict[str, Any]]] = []
    for category in categories:
        name = str(category["name"]).casefold()
        exact = any(label == name or label.endswith(f" {name}") for label in labels)
        contained = bool(name and name in source_text)
        if exact or contained:
            ranked.append(((100 if exact else 40) + int(category["depth"]), category))
    if ranked:
        return max(ranked, key=lambda entry: entry[0])[1]
    if any(term in source_text for term in ("food", "grocery", "beverage", "drink", "nut")):
        return next(
            (
                category
                for category in categories
                if "grocer" in f"{category['slug']} {category['name']}".casefold()
            ),
            None,
        )
    return None


def resolve_category(connection: sqlite3.Connection, tags: list[str]) -> dict[str, Any] | None:
    cleaned = list(dict.fromkeys(tag.strip() for tag in tags if tag.strip()))
    if not cleaned:
        return None
    categories = list_categories(connection)
    by_id = {int(category["id"]): category for category in categories}
    placeholders = ", ".join("?" for _ in cleaned)
    explicit_rows = connection.execute(
        f"""
        SELECT off_tag, category_id FROM off_category_mappings
        WHERE off_tag IN ({placeholders})
        """,
        cleaned,
    ).fetchall()
    explicit = {row["off_tag"]: by_id.get(int(row["category_id"])) for row in explicit_rows}
    explicit_matches = [
        (index, tag, explicit[tag])
        for index, tag in enumerate(cleaned)
        if tag in explicit and explicit[tag] is not None
    ]
    if explicit_matches:
        _, tag, category = max(
            explicit_matches,
            key=lambda entry: (len(category_label(entry[1])), entry[0]),
        )
        return {
            "id": category["id"],
            "name": category["name"],
            "path": category["path"],
            "default_location": category["default_location"],
            "source": "explicit",
            "off_tag": tag,
        }
    category = _automatic_category(categories, cleaned)
    if category is None:
        return None
    return {
        "id": category["id"],
        "name": category["name"],
        "path": category["path"],
        "default_location": category["default_location"],
        "source": "automatic",
        "off_tag": None,
    }


def list_mappings(connection: sqlite3.Connection) -> dict[str, Any]:
    backfill_observations(connection)
    categories = list_categories(connection)
    rows = connection.execute(
        """
        SELECT observations.off_tag, observations.label, observations.scan_count,
               observations.first_seen_at, observations.last_seen_at,
               mappings.category_id
        FROM off_category_observations AS observations
        LEFT JOIN off_category_mappings AS mappings ON mappings.off_tag = observations.off_tag
        WHERE mappings.category_id IS NOT NULL OR EXISTS (
            SELECT 1 FROM off_category_product_tags AS product_tags
            WHERE product_tags.off_tag = observations.off_tag AND product_tags.is_leaf = 1
        )
        ORDER BY observations.last_seen_at DESC, observations.off_tag
        """
    ).fetchall()
    entries = []
    for row in rows:
        explicit = next(
            (category for category in categories if category["id"] == row["category_id"]),
            None,
        )
        automatic = _automatic_category(categories, [row["off_tag"]])
        effective = explicit or automatic
        entries.append(
            {
                **dict(row),
                "explicit_category": _category_summary(explicit),
                "automatic_category": _category_summary(automatic),
                "effective_category": _category_summary(effective),
                "mapping_source": "explicit"
                if explicit
                else "automatic"
                if automatic
                else "unmapped",
            }
        )
    return {"format": FORMAT, "mappings": entries}


def _normalize_barcode(value: str) -> str:
    digits = "".join(character for character in value if character.isdigit())
    stripped = digits.lstrip("0") or "0"
    if len(stripped) <= 7:
        return stripped.zfill(8)
    if len(stripped) <= 12:
        return stripped.zfill(13)
    return digits


def items_for_category(connection: sqlite3.Connection, off_tag: str) -> list[dict[str, Any]]:
    barcodes = {
        _normalize_barcode(str(row["barcode"]))
        for row in connection.execute(
            "SELECT barcode FROM off_category_product_tags WHERE off_tag = ?",
            (off_tag,),
        )
    }
    if not barcodes:
        return []
    rows = connection.execute(
        """
        SELECT items.public_id,
               COALESCE(NULLIF(items.barcode_override, ''), products.barcode, '') AS barcode
        FROM items LEFT JOIN products ON products.id = items.product_id
        WHERE items.archived_at IS NULL
        ORDER BY items.updated_at DESC
        """
    ).fetchall()
    return [
        get_item(connection, row["public_id"])
        for row in rows
        if row["barcode"] and _normalize_barcode(str(row["barcode"])) in barcodes
    ]


def _category_summary(category: dict[str, Any] | None) -> dict[str, Any] | None:
    if category is None:
        return None
    return {"id": category["id"], "name": category["name"], "path": category["path"]}


def set_mapping(
    connection: sqlite3.Connection, off_tag: str, category_id: int | None
) -> dict[str, Any]:
    tag = off_tag.strip()
    if not tag:
        raise ConflictError("Open Food Facts category is required")
    with transaction(connection):
        connection.execute(
            """
            INSERT INTO off_category_observations(off_tag, label, scan_count)
            VALUES (?, ?, 0) ON CONFLICT(off_tag) DO NOTHING
            """,
            (tag, category_label(tag)),
        )
        if category_id is None:
            connection.execute("DELETE FROM off_category_mappings WHERE off_tag = ?", (tag,))
        else:
            get_category_row(connection, category_id)
            connection.execute(
                """
                INSERT INTO off_category_mappings(off_tag, category_id)
                VALUES (?, ?)
                ON CONFLICT(off_tag) DO UPDATE SET
                    category_id = excluded.category_id,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (tag, category_id),
            )
    return next(entry for entry in list_mappings(connection)["mappings"] if entry["off_tag"] == tag)


def export_mappings(connection: sqlite3.Connection) -> dict[str, Any]:
    data = list_mappings(connection)
    return {
        "format": FORMAT,
        "exported_at": datetime.now(UTC).isoformat(),
        "instructions": {
            "assigned_category_path": (
                "Set this to one of our_categories.path values, or null to remove "
                "an explicit mapping."
            ),
            "import": "Import this JSON from Settings > Open Food Facts category mapping.",
        },
        "our_categories": [
            {"id": category["id"], "name": category["name"], "path": category["path"]}
            for category in list_categories(connection)
        ],
        "mappings": [
            {
                "off_tag": entry["off_tag"],
                "off_label": entry["label"],
                "scan_count": entry["scan_count"],
                "automatic_category_path": (
                    entry["automatic_category"]["path"] if entry["automatic_category"] else None
                ),
                "assigned_category_path": (
                    entry["explicit_category"]["path"] if entry["explicit_category"] else None
                ),
            }
            for entry in data["mappings"]
        ],
    }


def import_mappings(
    connection: sqlite3.Connection, payload: dict[str, Any], *, apply: bool = False
) -> dict[str, Any]:
    if payload.get("format") != FORMAT or not isinstance(payload.get("mappings"), list):
        raise ConflictError(f"Import must use format {FORMAT}")
    categories = list_categories(connection)
    by_path = {str(category["path"]).casefold(): category for category in categories}
    details: list[dict[str, Any]] = []
    changes: list[tuple[str, int | None]] = []
    seen: set[str] = set()
    for index, mapping in enumerate(payload["mappings"]):
        if not isinstance(mapping, dict):
            details.append(
                {"index": index, "status": "error", "message": "Mapping must be an object"}
            )
            continue
        tag = str(mapping.get("off_tag") or "").strip()
        path = mapping.get("assigned_category_path")
        if not tag or tag in seen:
            details.append(
                {
                    "index": index,
                    "off_tag": tag,
                    "status": "error",
                    "message": "Missing or duplicate off_tag",
                }
            )
            continue
        seen.add(tag)
        category = None if path in (None, "") else by_path.get(str(path).strip().casefold())
        if path not in (None, "") and category is None:
            details.append(
                {
                    "index": index,
                    "off_tag": tag,
                    "status": "error",
                    "message": f"Unknown category path: {path}",
                }
            )
            continue
        changes.append((tag, int(category["id"]) if category else None))
        details.append(
            {
                "index": index,
                "off_tag": tag,
                "status": "ready",
                "message": category["path"] if category else "Use automatic mapping",
            }
        )
    errors = sum(1 for detail in details if detail["status"] == "error")
    if apply and not errors:
        for tag, category_id in changes:
            set_mapping(connection, tag, category_id)
    return {
        "ready": len(changes),
        "errors": errors,
        "applied": len(changes) if apply and not errors else 0,
        "details": details,
    }
