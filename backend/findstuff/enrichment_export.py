"""A handover file for enriching a branch of the inventory elsewhere.

One category or one place is packed up with what it holds: the fields that branch
records, every item in it with its own values, and the operations guide the import
reads. The point is to hand the file to an assistant, have it look the products up
and answer with a changes file, and feed that answer straight back into the
existing import — so nothing here needs to know how the answer was produced.

History is deliberately left out: it is long, it is not needed to describe a
product, and it is the part of the inventory least worth sending anywhere.
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from typing import Any

from .custom_fields import category_fields, item_values

EXPORT_FORMAT = "findstuff-enrichment-request"
EXPORT_VERSION = 1

# What the file asks the assistant to do, in the order the import expects.
INSTRUCTIONS = [
    "Each item below is real stock already in this inventory. Look the product up"
    " and fill in what is missing or wrong.",
    "Answer with a findstuff-ops-v1 changes file, the format described under"
    ' "guide" in this file. Import it through Tools → Data → Import.',
    "Match every change by the item's public_id. Never create a second item for"
    " one that is already listed here.",
    "Only state what the product actually is. Leave a field out rather than"
    " guessing it, and put the source of anything unobvious in the item's notes.",
    "custom_fields holds the fields this branch records. Use those keys exactly;"
    " a value outside a field's allowed choices is rejected by the import.",
    "Quantities, places and containers describe where this stock sits today."
    " Do not change them; this file is about what the products are.",
]


def _category_row(connection: sqlite3.Connection, category_id: int) -> dict[str, Any]:
    from .inventory import NotFoundError, list_categories

    for category in list_categories(connection):
        if category["id"] == category_id:
            return category
    raise NotFoundError("Category not found")


def _location_row(connection: sqlite3.Connection, public_id: str) -> dict[str, Any]:
    from .inventory import NotFoundError, location_path

    row = connection.execute(
        "SELECT id, public_id, name FROM locations WHERE public_id = ?", (public_id,)
    ).fetchone()
    if row is None:
        raise NotFoundError("Location not found")
    return {
        "id": row[0],
        "public_id": row[1],
        "name": row[2],
        "path": location_path(connection, row[0]),
    }


def _items_with_values(
    connection: sqlite3.Connection, rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Each item as the inventory holds it, plus the values of its own fields."""
    items = []
    for row in rows:
        identifier = connection.execute(
            "SELECT id FROM items WHERE public_id = ?", (row["public_id"],)
        ).fetchone()
        item = {key: value for key, value in row.items() if key != "history"}
        item["custom_fields"] = item_values(connection, identifier[0]) if identifier else {}
        items.append(item)
    return items


def _fields_for_categories(
    connection: sqlite3.Connection, category_ids: set[int]
) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for category_id in sorted(category_ids):
        for field in category_fields(connection, category_id):
            seen.setdefault(field["value_field_id"], field)
    return list(seen.values())


# The guide the import reads describes the whole inventory. For one branch most of
# that is noise, and the listings are megabytes, so the catalogues are dropped and
# the ones this branch needs are put back trimmed to scope.
_BULK_KEYS = ("_available_categories", "_available_items", "_available_locations",
              "_available_category_fields", "_available_projects", "_field_definitions")


def _guide_for_scope(
    connection: sqlite3.Connection, category_ids: set[int], place_ids: set[str]
) -> dict[str, Any]:
    from .operations_contract import operations_template

    guide = {
        key: value
        for key, value in operations_template(connection).items()
        if key not in _BULK_KEYS
    }
    from .inventory import list_categories

    guide["_categories_in_scope"] = [
        {"id": category["id"], "name": category["name"], "path": category["path"]}
        for category in list_categories(connection)
        if category["id"] in category_ids
    ]
    if place_ids:
        from .inventory import location_path

        placeholders = ", ".join("?" for _ in place_ids)
        guide["_places_in_scope"] = [
            {"public_id": row[1], "name": row[2], "path": location_path(connection, row[0])}
            for row in connection.execute(
                f"SELECT id, public_id, name FROM locations WHERE public_id IN ({placeholders})",
                tuple(sorted(place_ids)),
            )
        ]
    guide["_catalogues_omitted"] = (
        "The full category, place and item catalogues are left out of this file."
        " Everything you need to answer is under scope, custom_fields and items."
    )
    return guide


def _package(
    connection: sqlite3.Connection, scope: dict[str, Any], rows: list[dict[str, Any]]
) -> dict[str, Any]:
    items = _items_with_values(connection, rows)
    category_ids = {item["category_id"] for item in items if item.get("category_id")}
    if scope.get("category_id"):
        category_ids.add(int(scope["category_id"]))
    return {
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "scope": scope,
        "instructions": INSTRUCTIONS,
        "custom_fields": _fields_for_categories(connection, category_ids),
        "items": items,
        "guide": _guide_for_scope(
            connection,
            category_ids,
            {item["location_public_id"] for item in items if item.get("location_public_id")},
        ),
    }


def export_category(
    connection: sqlite3.Connection, category_id: int, *, include_children: bool = True
) -> dict[str, Any]:
    """Everything filed under a category, ready to be described by an assistant."""
    from .inventory import list_items

    category = _category_row(connection, category_id)
    rows = list_items(connection, category_id=category_id, limit=10_000)
    if not include_children:
        rows = [row for row in rows if row.get("category_id") == category_id]
    return _package(
        connection,
        {
            "kind": "category",
            "category_id": category["id"],
            "name": category["name"],
            "path": category["path"],
            "includes_child_categories": include_children,
        },
        rows,
    )


def export_location(
    connection: sqlite3.Connection, public_id: str, *, include_children: bool = True
) -> dict[str, Any]:
    """Everything stored in a place, ready to be described by an assistant."""
    from .inventory import list_items, location_descendant_ids

    location = _location_row(connection, public_id)
    places = [public_id]
    if include_children:
        identifier = connection.execute(
            "SELECT id FROM locations WHERE public_id = ?", (public_id,)
        ).fetchone()
        inside = location_descendant_ids(connection, identifier[0])
        places = [
            row[0]
            for row in connection.execute(
                f"SELECT public_id FROM locations WHERE id IN ({', '.join('?' for _ in inside)})",
                tuple(inside),
            )
        ]
    rows: list[dict[str, Any]] = []
    for place in places:
        rows.extend(list_items(connection, location_public_id=place, limit=10_000))
    return _package(
        connection,
        {
            "kind": "location",
            "location_public_id": location["public_id"],
            "name": location["name"],
            "path": location["path"],
            "includes_child_places": include_children,
        },
        rows,
    )
