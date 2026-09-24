"""A handover file for enriching a branch of the inventory elsewhere.

One category or one place is packed up with what it holds: the categories and places
involved with the fields each category records, every item in it with its complete
detail, and the operations guide the import reads. The point is to hand the file to
an assistant, have it look the products up and answer with a changes file, and feed
that answer straight back into the existing import — so nothing here needs to know
how the answer was produced.

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

# Extracted document text can run to whole manuals; enough of it is kept to identify
# the product without letting one PDF outweigh the rest of the file.
DOCUMENT_TEXT_LIMIT = 4000

# What the file asks the assistant to do, in the order the import expects.
INSTRUCTIONS = [
    "Each item below is real stock already in this inventory. Look the product up"
    " and fill in what is missing or wrong: description, brand, model, barcode,"
    " dimensions, weight, prices, links, tags and custom fields.",
    "Answer with a findstuff-ops-v1 changes file, the format described under"
    ' "guide" in this file. Import it through Tools → Data → Import.',
    "Match every change by the item's public_id. Never create a second item for"
    " one that is already listed here.",
    "Only state what the product actually is. Leave a field out rather than"
    " guessing it, and put the source of anything unobvious in the item's notes.",
    "Each item's custom_fields lists every field its category records, empty ones"
    " as null. The item's category under categories describes those fields: type,"
    " unit, allowed values and constraints. Write them back under"
    " data.custom_fields using those keys exactly; a value outside a field's"
    " allowed choices or constraints is rejected by the import.",
    "guide._field_definitions.item explains the standard item fields, including"
    " units (weight_g is grams, dimensions are millimetres, prices are minor"
    " currency units such as cents).",
    "Quantities, places, containers, lots and reservations describe where this"
    " stock sits today. Do not change them; this file is about what the products"
    " are.",
    "photos, documents and enrichment show what is already known about an item."
    " Photo and document URLs are relative to the inventory server and cannot be"
    " opened from outside it.",
]


def _category_row(connection: sqlite3.Connection, category_id: int) -> dict[str, Any]:
    from .inventory import NotFoundError, list_categories

    for category in list_categories(connection):
        if category["id"] == category_id:
            return category
    raise NotFoundError("Category not found")


def _location_row(connection: sqlite3.Connection, public_id: str) -> dict[str, Any]:
    from .inventory import NotFoundError, get_location_row, serialize_location

    try:
        return serialize_location(connection, get_location_row(connection, public_id))
    except NotFoundError as error:
        raise NotFoundError("Location not found") from error


def _custom_values(
    connection: sqlite3.Connection,
    item_id: int,
    fields: list[dict[str, Any]],
) -> dict[str, Any]:
    """Values keyed by field key, with every field of the category present.

    Empty fields are listed as null so the gaps worth filling are visible without
    cross-referencing the definitions. Values kept from an earlier category stay
    visible under their field id.
    """
    stored = item_values(connection, item_id)
    values = {field["key"]: stored.pop(field["value_field_id"], None) for field in fields}
    values.update(stored)
    return values


def _item_detail(
    connection: sqlite3.Connection,
    public_id: str,
    fields_by_category: dict[int, list[dict[str, Any]]],
) -> dict[str, Any]:
    """An item as its detail screen shows it, apart from its history."""
    from .documents import list_documents
    from .enrichment import list_enrichment
    from .extended import list_item_reservations
    from .inventory import (
        get_item,
        get_item_row,
        list_item_lots,
        list_item_relationships,
        list_maintenance_tasks,
    )
    from .photos import list_photos

    row = get_item_row(connection, public_id)
    item = {
        key: value
        for key, value in get_item(connection, public_id).items()
        # Definitions travel once per category under "categories", not per item.
        if key not in ("history", "field_definitions")
    }
    category_id = row["category_id"]
    if category_id is not None and category_id not in fields_by_category:
        fields_by_category[category_id] = category_fields(connection, category_id)
    item["custom_fields"] = _custom_values(
        connection, row["id"], fields_by_category.get(category_id, [])
    )
    item["photos"] = [
        # The file path is where the server keeps the photo, not something to share.
        {key: value for key, value in photo.items() if key != "file_path"}
        for photo in list_photos(connection, public_id)
    ]
    documents = []
    for document in list_documents(connection, public_id):
        text = document.get("extracted_text") or ""
        if len(text) > DOCUMENT_TEXT_LIMIT:
            document["extracted_text"] = text[:DOCUMENT_TEXT_LIMIT]
            document["extracted_text_truncated"] = True
        documents.append(document)
    item["documents"] = documents
    item["lots"] = list_item_lots(connection, public_id)
    item["related"] = list_item_relationships(connection, public_id)
    item["maintenance"] = list_maintenance_tasks(connection, public_id)
    item["reservations"] = list_item_reservations(connection, public_id)
    enrichment = list_enrichment(connection, public_id)
    item["enrichment"] = {
        "product": enrichment.get("product"),
        "candidates": enrichment.get("candidates", []),
    }
    return item


def _categories(
    connection: sqlite3.Connection,
    category_ids: set[int],
    fields_by_category: dict[int, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    from .inventory import list_categories

    categories = []
    for category in list_categories(connection):
        if category["id"] not in category_ids:
            continue
        if category["id"] not in fields_by_category:
            fields_by_category[category["id"]] = category_fields(connection, category["id"])
        categories.append(
            {
                key: category.get(key)
                for key in (
                    "id",
                    "name",
                    "path",
                    "parent_id",
                    "item_count",
                    "total_item_count",
                    "capabilities",
                    "default_location",
                )
            }
            | {"custom_fields": fields_by_category[category["id"]]}
        )
    return categories


def _places(connection: sqlite3.Connection, place_ids: set[str]) -> list[dict[str, Any]]:
    from .inventory import get_location_row, serialize_location

    return sorted(
        (
            serialize_location(connection, get_location_row(connection, public_id))
            for public_id in place_ids
        ),
        key=lambda place: place["path"].casefold(),
    )


# The guide the import reads describes the whole inventory. For one branch most of
# that is noise, and the listings are megabytes, so the catalogues are dropped; the
# categories and places this branch needs are at the top of the file instead.
_BULK_KEYS = (
    "_available_categories",
    "_available_items",
    "_available_locations",
    "_available_category_fields",
    "_available_projects",
    "_field_definitions",
)
# Item field definitions are what tell the assistant that weight_g is grams and prices
# are minor units, so they are kept even though the rest of _field_definitions is not.
_KEPT_DEFINITIONS = ("item",)


def _guide(connection: sqlite3.Connection) -> dict[str, Any]:
    from .operations_contract import operations_template

    template = operations_template(connection)
    guide = {key: value for key, value in template.items() if key not in _BULK_KEYS}
    guide["_field_definitions"] = {
        entity: template["_field_definitions"][entity]
        for entity in _KEPT_DEFINITIONS
        if entity in template.get("_field_definitions", {})
    }
    guide["_catalogues_omitted"] = (
        "The full category, place and item catalogues are left out of this file."
        " Everything you need to answer is under scope, categories, places and items."
    )
    return guide


def _package(
    connection: sqlite3.Connection,
    scope: dict[str, Any],
    public_ids: list[str],
    *,
    category_ids: set[int],
    place_ids: set[str],
) -> dict[str, Any]:
    fields_by_category: dict[int, list[dict[str, Any]]] = {}
    items = [_item_detail(connection, public_id, fields_by_category) for public_id in public_ids]
    category_ids = category_ids | {item["category_id"] for item in items if item.get("category_id")}
    place_ids = place_ids | {
        place
        for item in items
        for place in (item.get("location_public_id"), item.get("direct_location_public_id"))
        if place
    }
    return {
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "scope": scope | {"item_count": len(items)},
        "instructions": INSTRUCTIONS,
        "categories": _categories(connection, category_ids, fields_by_category),
        "places": _places(connection, place_ids),
        "items": items,
        "guide": _guide(connection),
    }


def _unique(public_ids: list[str]) -> list[str]:
    return list(dict.fromkeys(public_ids))


def export_category(
    connection: sqlite3.Connection, category_id: int, *, include_children: bool = True
) -> dict[str, Any]:
    """Everything filed under a category, ready to be described by an assistant."""
    from .inventory import category_descendant_ids

    category = _category_row(connection, category_id)
    category_ids = (
        category_descendant_ids(connection, category_id) if include_children else [category_id]
    )
    placeholders = ", ".join("?" for _ in category_ids)
    public_ids = [
        row[0]
        for row in connection.execute(
            f"SELECT public_id FROM items WHERE archived_at IS NULL "
            f"AND category_id IN ({placeholders}) ORDER BY name COLLATE NOCASE, id",
            tuple(category_ids),
        )
    ]
    return _package(
        connection,
        {
            "kind": "category",
            "category_id": category["id"],
            "name": category["name"],
            "path": category["path"],
            "includes_child_categories": include_children,
        },
        _unique(public_ids),
        category_ids=set(category_ids),
        place_ids=set(),
    )


def export_location(
    connection: sqlite3.Connection, public_id: str, *, include_children: bool = True
) -> dict[str, Any]:
    """Everything stored in a place, including inside boxes kept there."""
    from .inventory import location_descendant_ids

    location = _location_row(connection, public_id)
    identifier = connection.execute(
        "SELECT id FROM locations WHERE public_id = ?", (public_id,)
    ).fetchone()[0]
    location_ids = (
        location_descendant_ids(connection, identifier) if include_children else [identifier]
    )
    placeholders = ", ".join("?" for _ in location_ids)
    # items.location_id is the effective place, so stock inside a box kept here counts.
    public_ids = [
        row[0]
        for row in connection.execute(
            f"SELECT public_id FROM items WHERE archived_at IS NULL "
            f"AND location_id IN ({placeholders}) ORDER BY name COLLATE NOCASE, id",
            tuple(location_ids),
        )
    ]
    place_ids = {
        row[0]
        for row in connection.execute(
            f"SELECT public_id FROM locations WHERE id IN ({placeholders})",
            tuple(location_ids),
        )
    }
    return _package(
        connection,
        {
            "kind": "location",
            "location_public_id": location["public_id"],
            "name": location["name"],
            "kind_of_place": location.get("kind"),
            "description": location.get("description", ""),
            "path": location["path"],
            "includes_child_places": include_children,
        },
        _unique(public_ids),
        category_ids=set(),
        place_ids=place_ids,
    )
