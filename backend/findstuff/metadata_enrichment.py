from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any

from .db import transaction
from .inventory import (
    ConflictError,
    NotFoundError,
    get_item_row,
    list_items,
    new_public_id,
    record_event,
    reindex_item,
    serialize_item,
)
from .network_security import validate_http_url

REQUEST_SCHEMA = "findstuff.enrichment_request.v1"
RESPONSE_SCHEMA = "findstuff.enrichment_response.v1"
AUTO_ACCEPT_CONFIDENCE = 0.95

PROTECTED_PREFIXES = ("/inventory/", "/private/", "/purchase/", "/identity/")
PROTECTED_PATHS = {
    "/core/location",
    "/core/location_path",
    "/core/location_public_id",
    "/core/notes",
    "/core/purchase_currency",
    "/core/purchase_price_minor",
    "/core/quantity",
    "/core/serial_number",
    "/core/unit",
}
CORE_PATCH_FIELDS = {
    "/core/barcode": "barcode_override",
    "/core/brand": "brand",
    "/core/model": "model",
    "/core/weight_g": "weight_g",
}
SAFE_SOURCE_TYPES = {
    "isbn_database",
    "manufacturer",
    "official",
    "official_api",
    "open_food_facts",
    "publisher",
}
LOCKED_METADATA_STATUSES = {"confirmed", "locked", "manual"}


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def _loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def item_metadata(connection: sqlite3.Connection, item_id: int) -> dict[str, Any]:
    rows = connection.execute(
        """
        SELECT path, value_json, value_type, confidence, sources_json, status
        FROM item_metadata WHERE item_id = ?
        """,
        (item_id,),
    ).fetchall()
    return {
        row["path"]: {
            "confidence": row["confidence"],
            "sources": _loads(row["sources_json"], []),
            "status": row["status"],
            "value": _loads(row["value_json"], None),
            "value_type": row["value_type"],
        }
        for row in rows
    }


def set_item_metadata(
    connection: sqlite3.Connection,
    item_public_id: str,
    path: str,
    value: Any,
    *,
    value_type: str | None = None,
    confidence: float = 1.0,
    sources: list[dict[str, Any]] | None = None,
    status: str = "confirmed",
) -> dict[str, Any]:
    if not path.startswith("/metadata/"):
        raise ConflictError("Metadata paths must start with /metadata/")
    item = get_item_row(connection, item_public_id)
    source_list = sources or [{"source_type": "mcp", "label": "FindStuff MCP"}]
    with transaction(connection):
        _apply_value(
            connection,
            item,
            path,
            value,
            _value_type(value, value_type),
            max(0.0, min(float(confidence), 1.0)),
            source_list,
            status=status,
        )
    return item_metadata(connection, item["id"])[path]


def exportable_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    """Return only metadata that is useful context and not user-confirmed/locked."""
    return {
        path: value
        for path, value in metadata.items()
        if str(value.get("status") or "").casefold() not in LOCKED_METADATA_STATUSES
    }


def _weak_fields(item: dict[str, Any], metadata: dict[str, Any]) -> list[str]:
    hints = " ".join(
        [
            item.get("category_path") or "",
            item.get("category_name") or "",
            item.get("name") or "",
            " ".join(item.get("tags", [])),
        ]
    ).casefold()
    fields = [
        path
        for path, key in {
            "/core/barcode": "barcode",
            "/core/brand": "brand",
            "/core/model": "model",
            "/core/weight_g": "weight_g",
        }.items()
        if not item.get(key)
    ]
    if not any(item.get(key) for key in ("length_mm", "width_mm", "height_mm")):
        fields.append("/core/dimensions_mm")
    if any(term in hints for term in ("electronics", "esp", "microcontroller", "board")):
        fields += [
            "/metadata/electronics/chipset",
            "/metadata/electronics/connector",
            "/metadata/electronics/datasheet_url",
            "/metadata/electronics/power_requirements",
            "/metadata/electronics/voltage",
        ]
    elif any(term in hints for term in ("tool", "drill", "saw", "driver")):
        fields += [
            "/metadata/tools/compatible_accessories",
            "/metadata/tools/material",
            "/metadata/tools/power_type",
            "/metadata/tools/size",
        ]
    elif any(term in hints for term in ("groceries", "food", "pasta", "milk")):
        fields += [
            "/metadata/groceries/allergens",
            "/metadata/groceries/ingredients",
            "/metadata/groceries/nutrition",
            "/metadata/groceries/storage_type",
        ]
    elif "book" in hints:
        fields += [
            "/metadata/books/author",
            "/metadata/books/cover_image_url",
            "/metadata/books/edition",
            "/metadata/books/isbn",
            "/metadata/books/publisher",
        ]
    else:
        fields += [
            "/metadata/generic/dimensions",
            "/metadata/generic/manual_url",
            "/metadata/generic/material",
        ]
    fields += ["/metadata/market/estimated_price_italy", "/metadata/media/image_url"]
    return [field for field in dict.fromkeys(fields) if field not in metadata]


def create_export_request(
    connection: sqlite3.Connection,
    *,
    categories: list[str] | None = None,
    limit: int = 50,
    include_photos: bool = True,
) -> dict[str, Any]:
    category_filter = {entry.casefold() for entry in categories or []}
    selected: list[dict[str, Any]] = []
    for item in list_items(connection, limit=min(max(limit, 1), 250)):
        category_labels = {
            label.casefold()
            for label in (item.get("category_name"), item.get("category_path"))
            if label
        }
        if category_filter and not category_filter.intersection(category_labels):
            continue
        row = get_item_row(connection, item["public_id"])
        metadata = item_metadata(connection, row["id"])
        visible_metadata = exportable_metadata(metadata)
        weak = _weak_fields(item, metadata)
        if not weak:
            continue
        photos = []
        if include_photos:
            photos = [
                {
                    "caption": "",
                    "ocr_text": "",
                    "photo_public_id": photo["public_id"],
                    "url": f"/api/v1/photos/{photo['public_id']}/content",
                }
                for photo in connection.execute(
                    """
                    SELECT public_id FROM photos
                    WHERE item_id = ? ORDER BY sort_order, id LIMIT 3
                    """,
                    (row["id"],),
                )
            ]
        selected.append(
            {
                "category": item["category_name"],
                "category_path": item.get("category_path"),
                "context": {
                    "updated_at": item["updated_at"],
                },
                "description": item["description"],
                "existing_metadata": {
                    "core": {
                        "barcode": item["barcode"],
                        "brand": item["brand"],
                        "dimensions_mm": {
                            "height": item["height_mm"],
                            "length": item["length_mm"],
                            "width": item["width_mm"],
                        },
                        "model": item["model"],
                        "weight_g": item["weight_g"],
                    },
                    "flexible": visible_metadata,
                },
                "item_public_id": item["public_id"],
                "item_version": item["version"],
                "missing_or_weak_fields": weak,
                "name": item["name"],
                "photos": photos,
                "tags": item["tags"],
            }
        )
    public_id = new_public_id("enx")
    document = {
        "created_at": datetime.now(UTC).isoformat(),
        "export_id": public_id,
        "instructions": {
            "privacy": "Inventory-state, private, purchase, and locked fields are omitted.",
            "goal": "Suggest missing or weak metadata as patch suggestions only.",
            "market_focus": "Italy / EU for prices, retailers, manuals, and product pages.",
            "response_schema": RESPONSE_SCHEMA,
        },
        "items": selected,
        "schema_version": REQUEST_SCHEMA,
    }
    with transaction(connection):
        connection.execute(
            """
            INSERT INTO enrichment_exports(public_id, criteria_json, item_count)
            VALUES (?, ?, ?)
            """,
            (
                public_id,
                _json({"categories": categories or [], "include_photos": include_photos}),
                len(selected),
            ),
        )
    return document


def _sources(patch: dict[str, Any]) -> list[dict[str, Any]]:
    sources = patch.get("sources", [])
    if not isinstance(sources, list):
        return []
    validated: list[dict[str, Any]] = []
    for source in sources[:20]:
        if not isinstance(source, dict):
            continue
        try:
            url = validate_http_url(str(source.get("url") or ""))
        except ValueError:
            continue
        validated.append(
            {
                **source,
                "url": url,
                "label": str(source.get("label") or "")[:240],
                "source_type": str(source.get("source_type") or "")[:80],
            }
        )
    return validated


def _value_type(value: Any, supplied: str | None = None) -> str:
    if supplied:
        return supplied
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, list):
        return "list"
    if isinstance(value, dict):
        return "object"
    return "string"


def _safety_flags(path: str, patch: dict[str, Any]) -> list[str]:
    flags = []
    if path in PROTECTED_PATHS or any(path.startswith(prefix) for prefix in PROTECTED_PREFIXES):
        flags.append("protected_path")
    if patch.get("op") != "set":
        flags.append("unsupported_op")
    if not _sources(patch):
        flags.append("missing_source")
    if float(patch.get("confidence") or 0) < 0.5:
        flags.append("low_confidence")
    if path.startswith("/metadata/market/") or "price" in path:
        flags.append("price_review_required")
    if not (path.startswith("/metadata/") or path in CORE_PATCH_FIELDS):
        if path != "/core/dimensions_mm":
            flags.append("unsupported_path")
    return flags


def _metadata_locked(connection: sqlite3.Connection, item: sqlite3.Row, path: str) -> bool:
    if not path.startswith("/metadata/"):
        return False
    row = connection.execute(
        "SELECT status FROM item_metadata WHERE item_id = ? AND path = ?",
        (item["id"], path),
    ).fetchone()
    if row is None:
        return False
    return str(row["status"] or "").casefold() in LOCKED_METADATA_STATUSES


def _target_empty(connection: sqlite3.Connection, item: sqlite3.Row, path: str) -> bool:
    if path in CORE_PATCH_FIELDS:
        return item[CORE_PATCH_FIELDS[path]] in (None, "")
    if path == "/core/dimensions_mm":
        return not any(item[key] for key in ("length_mm", "width_mm", "height_mm"))
    if path.startswith("/metadata/"):
        return (
            connection.execute(
                "SELECT 1 FROM item_metadata WHERE item_id = ? AND path = ?",
                (item["id"], path),
            ).fetchone()
            is None
        )
    return False


def _safe_auto_accept(
    connection: sqlite3.Connection,
    item: sqlite3.Row,
    path: str,
    patch: dict[str, Any],
    flags: list[str],
) -> bool:
    if flags or float(patch.get("confidence") or 0) < AUTO_ACCEPT_CONFIDENCE:
        return False
    if not _target_empty(connection, item, path):
        return False
    source_types = {str(source.get("source_type", "")).casefold() for source in _sources(patch)}
    return bool(source_types & SAFE_SOURCE_TYPES)


def _apply_value(
    connection: sqlite3.Connection,
    item: sqlite3.Row,
    path: str,
    value: Any,
    value_type: str,
    confidence: float,
    sources: list[dict[str, Any]],
    *,
    status: str,
) -> None:
    if path in CORE_PATCH_FIELDS or path == "/core/dimensions_mm":
        before = serialize_item(connection, item)
        if path == "/core/dimensions_mm":
            if not isinstance(value, dict):
                raise ConflictError("dimensions_mm must be an object")
            connection.execute(
                """
                UPDATE items SET length_mm = ?, width_mm = ?, height_mm = ?,
                    version = version + 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (value.get("length"), value.get("width"), value.get("height"), item["id"]),
            )
        else:
            connection.execute(
                f"""
                UPDATE items SET {CORE_PATCH_FIELDS[path]} = ?,
                    version = version + 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (value, item["id"]),
            )
        after = serialize_item(connection, get_item_row(connection, item["public_id"]))
        record_event(connection, item["id"], "update", before, after, source="enrichment_import")
        reindex_item(connection, item["id"])
        return
    if path.startswith("/metadata/"):
        connection.execute(
            """
            INSERT INTO item_metadata(
                path, item_id, value_json, value_type, confidence, sources_json,
                status, confirmed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(item_id, path) DO UPDATE SET
                value_json = excluded.value_json,
                value_type = excluded.value_type,
                confidence = excluded.confidence,
                sources_json = excluded.sources_json,
                status = excluded.status,
                confirmed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            """,
            (path, item["id"], _json(value), value_type, confidence, _json(sources), status),
        )


def import_response(connection: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("schema_version") != RESPONSE_SCHEMA:
        raise ValueError(f"schema_version must be {RESPONSE_SCHEMA}")
    import_public_id = new_public_id("eni")
    imported = unsafe = auto_accepted = 0
    with transaction(connection):
        cursor = connection.execute(
            """
            INSERT INTO enrichment_imports(public_id, export_public_id, agent_json, raw_json)
            VALUES (?, ?, ?, ?)
            """,
            (
                import_public_id,
                payload.get("export_id"),
                _json(payload.get("agent") or {}),
                _json(payload),
            ),
        )
        import_id = cursor.lastrowid
        for bundle in payload.get("suggestions", []):
            item = get_item_row(connection, str(bundle.get("item_public_id") or ""))
            for patch in bundle.get("patches", []):
                path = str(patch.get("path") or "")
                value = patch.get("value")
                confidence = float(patch.get("confidence") or 0)
                sources = _sources(patch)
                value_type = _value_type(value, patch.get("value_type"))
                flags = _safety_flags(path, patch)
                if _metadata_locked(connection, item, path):
                    flags.append("manually_confirmed_field")
                status = (
                    "unsafe"
                    if (
                        "protected_path" in flags
                        or "unsupported_path" in flags
                        or "manually_confirmed_field" in flags
                    )
                    else "pending"
                )
                if status == "unsafe":
                    unsafe += 1
                if _safe_auto_accept(connection, item, path, patch, flags):
                    _apply_value(
                        connection,
                        item,
                        path,
                        value,
                        value_type,
                        confidence,
                        sources,
                        status="auto_accepted",
                    )
                    status = "auto_accepted"
                    auto_accepted += 1
                connection.execute(
                    """
                    INSERT INTO enrichment_suggestions(
                        public_id, import_id, item_id, op, path, value_json, value_type,
                        confidence, sources_json, uncertainty, rationale, status,
                        safety_flags_json, decided_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        CASE
                          WHEN ? IN ('auto_accepted', 'unsafe') THEN CURRENT_TIMESTAMP
                          ELSE NULL
                        END)
                    """,
                    (
                        new_public_id("ens"),
                        import_id,
                        item["id"],
                        patch.get("op", "set"),
                        path,
                        _json(value),
                        value_type,
                        confidence,
                        _json(sources),
                        str(patch.get("uncertainty") or ""),
                        str(patch.get("rationale") or ""),
                        status,
                        _json(flags),
                        status,
                    ),
                )
                imported += 1
    return {
        "auto_accepted": auto_accepted,
        "import_public_id": import_public_id,
        "suggestions": imported,
        "unsafe": unsafe,
    }


def list_suggestions(
    connection: sqlite3.Connection, status: str = "pending"
) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT enrichment_suggestions.*, items.public_id AS item_public_id,
               items.name AS item_name, locations.name AS location_name
        FROM enrichment_suggestions
        JOIN items ON items.id = enrichment_suggestions.item_id
        JOIN locations ON locations.id = items.location_id
        WHERE (? = 'all' OR enrichment_suggestions.status = ?)
        ORDER BY enrichment_suggestions.created_at DESC, enrichment_suggestions.id DESC
        LIMIT 250
        """,
        (status, status),
    ).fetchall()
    return [
        {
            "confidence": row["confidence"],
            "created_at": row["created_at"],
            "item_name": row["item_name"],
            "item_public_id": row["item_public_id"],
            "location_name": row["location_name"],
            "op": row["op"],
            "path": row["path"],
            "public_id": row["public_id"],
            "rationale": row["rationale"],
            "safety_flags": _loads(row["safety_flags_json"], []),
            "sources": _loads(row["sources_json"], []),
            "status": row["status"],
            "uncertainty": row["uncertainty"],
            "value": _loads(row["value_json"], None),
            "value_type": row["value_type"],
        }
        for row in rows
    ]


def accept_suggestion(
    connection: sqlite3.Connection,
    public_id: str,
    edited_value: Any | None = None,
) -> dict[str, Any]:
    row = connection.execute(
        """
        SELECT enrichment_suggestions.*, items.public_id AS item_public_id
        FROM enrichment_suggestions
        JOIN items ON items.id = enrichment_suggestions.item_id
        WHERE enrichment_suggestions.public_id = ?
        """,
        (public_id,),
    ).fetchone()
    if row is None:
        raise NotFoundError("Suggestion not found")
    if row["status"] == "unsafe":
        raise ConflictError("Unsafe suggestions cannot be accepted")
    if row["status"] not in {"pending", "edited"}:
        raise ConflictError(f"Suggestion is already {row['status']}")
    item = get_item_row(connection, row["item_public_id"])
    value = edited_value if edited_value is not None else _loads(row["value_json"], None)
    with transaction(connection):
        _apply_value(
            connection,
            item,
            row["path"],
            value,
            row["value_type"],
            float(row["confidence"]),
            _loads(row["sources_json"], []),
            status="confirmed",
        )
        connection.execute(
            """
            UPDATE enrichment_suggestions
            SET status = ?, value_json = ?, decided_at = CURRENT_TIMESTAMP
            WHERE public_id = ?
            """,
            ("edited" if edited_value is not None else "accepted", _json(value), public_id),
        )
    return serialize_item(connection, get_item_row(connection, row["item_public_id"]))


def reject_suggestion(connection: sqlite3.Connection, public_id: str) -> None:
    with transaction(connection):
        cursor = connection.execute(
            """
            UPDATE enrichment_suggestions
            SET status = 'rejected', decided_at = CURRENT_TIMESTAMP
            WHERE public_id = ? AND status IN ('pending', 'edited', 'unsafe')
            """,
            (public_id,),
        )
    if cursor.rowcount != 1:
        raise NotFoundError("Pending suggestion not found")
