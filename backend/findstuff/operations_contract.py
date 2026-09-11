"Shared operation field contract and AI template, derived from API validation models."

from __future__ import annotations

from typing import Any, get_args

from .schemas import CategoryCreate, ItemCreate, ItemPatch, LocationCreate, QuantityAdjustment

SCHEMA_VERSION = 3
CATEGORY_REFERENCES = ("category_id", "category", "category_path", "category_name")
LOCATION_REFERENCES = ("location_public_id", "location", "location_path", "location_name")
CATEGORY_PARENTS = ("parent_id", "parent", "parent_path", "parent_name")
LOCATION_PARENTS = ("parent_public_id", "parent", "parent_path", "parent_name")
CATEGORY_DEFAULTS = ("default_location_public_id", "default_location", "default_location_path")
CATEGORY_METADATA = ("metadata_enabled", "required_metadata", "capabilities")
QUANTITY_CHANGES = ("quantity_delta", "add_quantity", "remove_quantity")
MATCH_FIELDS = {
    "item": (
        "public_id",
        "id",
        "barcode",
        "name",
        "serial_number",
        "container_item_id",
        *CATEGORY_REFERENCES,
        *LOCATION_REFERENCES,
    ),
    "category": ("id", "category_id", "path", "name", "category"),
    "location": ("public_id", "location_public_id", "path", "name", "location"),
}
DATA_FIELDS = {
    "item": tuple(ItemCreate.model_fields)
    + ("tags",)
    + CATEGORY_REFERENCES[1:]
    + LOCATION_REFERENCES[1:]
    + QUANTITY_CHANGES,
    "category": ("name", *CATEGORY_PARENTS, *CATEGORY_DEFAULTS, *CATEGORY_METADATA),
    "location": ("name", "kind", "description", *LOCATION_PARENTS),
}
ALIASES = {
    "item": (CATEGORY_REFERENCES, LOCATION_REFERENCES, ("quantity", *QUANTITY_CHANGES)),
    "category": (CATEGORY_PARENTS, CATEGORY_DEFAULTS, CATEGORY_METADATA),
    "location": (LOCATION_PARENTS,),
}


def validate_revision(payload: dict[str, Any]) -> None:
    revision = payload.get("schema_version", 1)
    if type(revision) is not int or revision not in (1, 2, SCHEMA_VERSION):
        raise ValueError(
            "Unsupported operations schema_version. Export a current template (version 3)."
        )
    if payload.get("format", "findstuff-ops-v1") != "findstuff-ops-v1":
        raise ValueError("Unsupported operations format; expected findstuff-ops-v1")


def validate_shape(operation: dict[str, Any], op: str, entity: str) -> None:
    from .import_protocol import ImportFailure

    data = operation.get("data", {})
    match = operation.get("match", {})
    if not isinstance(data, dict) or not isinstance(match, dict):
        raise ValueError("data and match must be objects")
    unknown = set(data) - set(DATA_FIELDS[entity])
    if unknown:
        raise ImportFailure(
            f"Unsupported {entity} data fields: {', '.join(sorted(unknown))}",
            "unsupported_field",
            f"data.{sorted(unknown)[0]}",
        )
    unknown_match = set(match) - set(MATCH_FIELDS[entity])
    if unknown_match:
        raise ImportFailure(
            f"Unsupported {entity} match fields: {', '.join(sorted(unknown_match))}",
            "unsupported_field",
            f"match.{sorted(unknown_match)[0]}",
        )
    if op == "delete" and data:
        raise ValueError("Delete accepts match only; remove data fields")
    if op == "add" and match:
        raise ValueError("Add accepts data only; use modify to update an existing object")
    if op == "add" and (not isinstance(data.get("name"), str) or not data["name"].strip()):
        raise ImportFailure(
            f"{entity.title()} add needs a nonempty data.name",
            "missing_required"
            if "name" not in data
            else "wrong_type"
            if not isinstance(data["name"], str)
            else "bad_range",
            "data.name",
        )
    if op != "add" and not match:
        raise ValueError(f"{entity.title()} {op} needs an exact match")
    for aliases in ALIASES[entity]:
        if sum(key in data for key in aliases) > 1:
            raise ValueError(f"Use only one of: {', '.join(aliases)}")
    for aliases in (CATEGORY_REFERENCES, LOCATION_REFERENCES) if entity == "item" else ():
        if sum(key in match for key in aliases) > 1:
            raise ValueError(f"Use only one matching reference from: {', '.join(aliases)}")
    if "name" in data and (not isinstance(data["name"], str) or not data["name"].strip()):
        raise ValueError("Name must be a non-empty string")
    if entity == "item":
        if op == "add" and any(key in data for key in QUANTITY_CHANGES):
            raise ValueError("Quantity changes require modify; add.quantity is the initial stock")
        if "tags" in data and (
            not isinstance(data["tags"], list)
            or any(not isinstance(tag, str) for tag in data["tags"])
        ):
            raise ValueError("tags must be an array of strings; use [] to clear")
        for key in QUANTITY_CHANGES:
            if key in data:
                amount = QuantityAdjustment.model_validate(
                    {"delta": data[key], "expected_version": 1}
                ).delta
                if key != "quantity_delta" and amount < 0:
                    raise ValueError(
                        f"{key} must be nonnegative; use quantity_delta for signed changes"
                    )
        for key, field in ItemCreate.model_fields.items():
            if (
                key in data
                and data[key] is None
                and None.__class__ not in get_args(field.annotation)
            ):
                if key != "location_public_id":
                    raise ValueError(f"{key} cannot be null; omit it to leave unchanged")
    elif entity == "category":
        if "name" in data:
            CategoryCreate.model_validate({"name": data["name"]})
    else:
        values = {key: data[key] for key in ("name", "kind", "description") if key in data}
        LocationCreate.model_validate({"name": "Validation placeholder", **values})


def validate_item_values(values: dict[str, Any], *, adding: bool) -> dict[str, Any]:
    if adding:
        return ItemCreate.model_validate(values).model_dump()
    clean = {key: value for key, value in values.items() if key not in QUANTITY_CHANGES}
    validated = ItemPatch.model_validate({**clean, "expected_version": 1}).model_dump(
        exclude_unset=True
    )
    validated.pop("expected_version")
    return validated


ITEM_DESCRIPTIONS = {
    "is_container": (
        "Boolean physical containment capability. Quantity belongs to the "
        "container itself and never totals its contents. Move contents out "
        "before disabling or archiving."
    ),
    "container_item_id": (
        "Containing item's stable public ID (preferred), numeric ID or "
        "unambiguous exact name. Parent must be an active is_container item. "
        "Create parents earlier in the same batch. Null detaches to the "
        "current effective place unless a new location is supplied; omitted "
        "on modify preserves containment. Do not also assign a direct "
        "location. Cycles are rejected. Location is inherited recursively; "
        "container participates in duplicate identity."
    ),
    "name": "Canonical human-readable name. Keep the same product name across different places.",
    "description": "Concise description of what the item is; empty string clears it.",
    "notes": (
        "Owner notes and useful specifications without dedicated fields; empty string clears."
    ),
    "category_id": (
        "Category reference. A numeric ID, full path, or unambiguous name; null clears category."
    ),
    "location_public_id": (
        "Physical stock location. Prefer its stable public_id; null or empty assigns Unassigned."
    ),
    "quantity": (
        "Absolute stock amount, not a delta. Nonnegative; zero is legal; up to 3 decimal places."
    ),
    "unit": (
        "Unit label, 1–24 characters. Recommended units are exported; custom "
        "labels are accepted. No conversion occurs."
    ),
    "purchase_price_minor": (
        "Purchase price in minor currency units (for example 1299 means 12.99"
        " in a two-decimal currency)."
    ),
    "purchase_currency": (
        "Three-letter currency code, normalized uppercase; pair with purchase price."
    ),
    "estimated_price_minor": "Estimated replacement/value price in minor currency units.",
    "estimated_price_currency": "Three-letter estimated-price currency code; normalized uppercase.",
    "weight_g": "Weight in whole grams. Not kilograms. Null clears the measurement.",
    "length_mm": "Length in whole millimetres. Null clears.",
    "width_mm": "Width in whole millimetres. Null clears.",
    "height_mm": "Height in whole millimetres. Null clears.",
    "serial_number": (
        "Individual object serial number; use to distinguish separate physical objects."
    ),
    "model": "Manufacturer model identifier. Do not invent one from appearance.",
    "brand": "Actual brand, preserving explicit user information.",
    "expiration_date": "Calendar date in YYYY-MM-DD format; null clears.",
    "low_stock_threshold": (
        "Inclusive low-stock warning threshold in the same unit as quantity; null disables it."
    ),
    "fullness_percent": (
        "Remaining fill level of one container, independently of stock "
        "quantity. Integer 0–100 or null."
    ),
    "barcode": (
        "Exact product barcode text, preserving leading zeros. Multiple stock records can share it."
    ),
    "links": "Replacement array of {label,url} objects. Only validated HTTP(S) URLs; [] clears.",
}


ENTITY_DESCRIPTIONS = {
    "item": ITEM_DESCRIPTIONS,
    "category": {
        "name": (
            "Category label, unique among siblings under the same parent. Reuse the "
            "existing taxonomy; never use a stock location as a category name."
        ),
    },
    "location": {
        "name": (
            "Physical place label, unique among siblings under the same parent. The same"
            " label may appear under different parents."
        ),
        "description": (
            "Description of this physical place and how to find or use it; empty string clears."
        ),
    },
}


def _field_definitions() -> dict[str, dict[str, Any]]:
    definitions = {}
    for entity, model in (
        ("item", ItemCreate),
        ("category", CategoryCreate),
        ("location", LocationCreate),
    ):
        schema = model.model_json_schema()
        fields = {}
        for name, rule in schema["properties"].items():
            nullable = any(option.get("type") == "null" for option in rule.get("anyOf", []))
            fields[name] = {
                **{key: value for key, value in rule.items() if key != "title"},
                "description": ENTITY_DESCRIPTIONS[entity].get(
                    name,
                    {
                        "parent_id": (
                            "Category parent reference; null creates or moves to top level."
                        ),
                        "parent_public_id": (
                            "Place parent reference; null creates or moves to top level."
                        ),
                        "kind": (
                            "Descriptive place kind; custom kinds are accepted. Does not restrict"
                            " nesting."
                        ),
                    }.get(name, f"{entity.title()} {name.replace('_', ' ')}"),
                ),
                "required_on_add": name in schema.get("required", []),
                "nullable": nullable or name == "location_public_id",
                "modifiable": True,
                "matchable": name in MATCH_FIELDS[entity],
                "empty_string_allowed": name
                in (
                    "description",
                    "notes",
                    "brand",
                    "model",
                    "serial_number",
                    "barcode",
                    "category_id",
                    "location_public_id",
                    "parent_id",
                    "parent_public_id",
                ),
                "omitted_on_modify": "unchanged",
            }
        definitions[entity] = fields
    definitions["item"]["tags"] = {
        "type": "array",
        "items": {"type": "string"},
        "description": "Replacement set of tags; trimmed, empty entries discarded, [] clears.",
        "default": [],
        "nullable": False,
        "modifiable": True,
        "required_on_add": False,
    }
    for key in QUANTITY_CHANGES:
        definitions["item"][key] = {
            "anyOf": [{"type": "number"}, {"type": "string"}],
            "description": {
                "quantity_delta": "Signed stock increment; negative consumes stock.",
                "add_quantity": "Nonnegative amount to add to existing stock.",
                "remove_quantity": "Nonnegative amount to subtract from existing stock.",
            }[key],
            "decimal_places": 3,
            "nullable": False,
            "modify_only": True,
            "mutually_exclusive_with": [
                "quantity",
                *[entry for entry in QUANTITY_CHANGES if entry != key],
            ],
            "result_minimum": 0,
        }
    for entity, groups in ALIASES.items():
        for group in groups:
            if group[0] == "quantity":
                continue
            canonical = group[0]
            if canonical not in definitions[entity]:
                definitions[entity][canonical] = {
                    "description": (
                        "Default place reference; null removes the explicit category default rule."
                    )
                    if group == CATEGORY_DEFAULTS
                    else (
                        "Category capability overrides; boolean flags control which item "
                        "details are shown. null or {} resets to inherited defaults."
                    ),
                    "nullable": True,
                    "modifiable": True,
                    "required_on_add": False,
                }
            for alias in group[1:]:
                definitions[entity][alias] = {
                    "alias_of": canonical,
                    "mutually_exclusive_with": list(group),
                    "required_on_add": False,
                }
    from .inventory import CATEGORY_DATA_FIELDS

    for entity, group in (
        ("item", CATEGORY_REFERENCES),
        ("item", LOCATION_REFERENCES),
        ("category", CATEGORY_PARENTS),
        ("category", CATEGORY_DEFAULTS),
        ("location", LOCATION_PARENTS),
    ):
        field = definitions[entity][group[0]]
        field.pop("type", None)
        field["anyOf"] = [{"type": "string"}, {"type": "null"}]
        if group in (CATEGORY_REFERENCES, CATEGORY_PARENTS):
            field["anyOf"].append({"type": "integer", "minimum": 1})
        field["reference"] = (
            "category" if group in (CATEGORY_REFERENCES, CATEGORY_PARENTS) else "location"
        )
    definitions["category"]["metadata_enabled"].update(
        {
            "type": ["object", "null"],
            "properties": {key: {"type": "boolean"} for key in CATEGORY_DATA_FIELDS},
            "additionalProperties": False,
        }
    )
    for entity, keys in MATCH_FIELDS.items():
        for key in keys:
            if key not in definitions[entity]:
                definitions[entity][key] = {
                    "type": "integer" if key == "id" else "string",
                    "description": (
                        "Exact matching selector; not a writable data field. See _matching_rules."
                    ),
                    "matchable": True,
                    "modifiable": False,
                    "match_only": True,
                    "required_on_add": False,
                    "nullable": False,
                }
    return definitions


def operations_template(connection) -> dict[str, Any]:
    from . import __version__
    from .inventory import (
        CATEGORY_DATA_FIELDS,
        list_categories,
        list_location_tree,
        list_location_types,
    )
    from .units import inventory_units

    categories = list_categories(connection)
    locations = []

    def flatten(nodes):
        for node in nodes:
            locations.append(
                {
                    key: node.get(key)
                    for key in ("public_id", "name", "path", "parent_public_id", "kind")
                }
            )
            flatten(node.get("children", []))

    flatten(list_location_tree(connection))
    definitions = _field_definitions()
    schemas = {}
    for entity in DATA_FIELDS:
        fields = list(dict.fromkeys(DATA_FIELDS[entity]))
        schemas[entity] = {
            "add": {
                "required": ["name"],
                "optional": [
                    key for key in fields if key != "name" and key not in QUANTITY_CHANGES
                ],
                "immutable": ["id"] + ([] if entity == "category" else ["public_id"]),
                "omitted_fields": (
                    "Use documented defaults; item location defaults to Unassigned, not "
                    "category default."
                ),
            },
            "modify": {
                "required": ["match", "data"],
                "match_by": list(MATCH_FIELDS[entity]),
                "allowed_fields": fields,
                "immutable": ["id"]
                + ([] if entity == "category" else ["public_id"])
                + (["version"] if entity == "item" else []),
                "omitted_fields": "Leave unchanged; provide one reference alias only.",
                "clearable": [
                    key
                    for key, field in definitions[entity].items()
                    if field.get("nullable")
                    or field.get("empty_string_allowed")
                    or field.get("type") == "array"
                ],
            },
            "delete": {
                "required": ["match"],
                "match_by": list(MATCH_FIELDS[entity]),
                "allowed_data_fields": [],
                "effect": "Archive item (recoverable)"
                if entity == "item"
                else "Delete empty category only"
                if entity == "category"
                else "Archive empty place only; system Unassigned cannot be deleted",
            },
        }
    template = {
        "format": "findstuff-ops-v1",
        "schema_version": SCHEMA_VERSION,
        "app_version": __version__,
        "instructions": {
            "purpose": (
                "Use this contract plus the owner request to generate safe inventory "
                "changes. Return only strict JSON containing format, schema_version "
                "and operations; no Markdown fences, comments or trailing commas."
            ),
            "output": {
                "format": "findstuff-ops-v1",
                "schema_version": SCHEMA_VERSION,
                "operations": [],
            },
            "helpers": (
                "Do not return instructions, _schemas, _available_* or other helper "
                "sections. They are context, not operations."
            ),
            "versions": (
                "format versions the wire envelope. schema_version versions supported"
                " semantics and validation. Missing schema_version means legacy 1. "
                "This server accepts 1, 2 and 3; unknown versions are rejected. Version "
                "2 and 3 apply a valid batch atomically; legacy 1 may report partial "
                "success. Always export a fresh template after an upgrade."
            ),
        },
        "_schemas": schemas,
        "_field_definitions": definitions,
        "$defs": ItemCreate.model_json_schema().get("$defs", {}),
        "_matching_rules": {
            "item": {
                "preferred": ["public_id", "id"],
                "fallback": ["barcode", "name"],
                "qualifiers": ["category", "location", "serial_number"],
                "semantics": (
                    "A supplied public_id or numeric id takes identity precedence; every "
                    "additional supplied qualifier must also match. Without ID, barcode "
                    "or name is required. Match must identify exactly one active item; "
                    "ambiguity is an error with candidates. Name matching trims outer "
                    "whitespace and ignores case; barcode is exact text. Internal id is "
                    "database-local; prefer public_id."
                ),
            },
            "category": {
                "priority": list(MATCH_FIELDS["category"]),
                "semantics": (
                    "Numeric ID (or digit string), full path, or unambiguous leaf name. "
                    "No category public_id exists. Case-insensitive path/name matching; "
                    "trim outer whitespace. Use just one matching key."
                ),
            },
            "location": {
                "priority": list(MATCH_FIELDS["location"]),
                "semantics": (
                    "Exact public_id, otherwise case-insensitive full path or unambiguous"
                    " leaf name. Numeric IDs are not accepted. Use one matching key."
                ),
            },
            "references": (
                'Prefer existing stable IDs, otherwise full paths separated by " > ".'
                " New categories/places created earlier in this batch can be "
                "referenced by full path. Never fabricate generated IDs. Repeated "
                "leaf names are valid under different immediate parents, including "
                "within the same larger tree; same-parent names collide."
            ),
        },
        "_value_semantics": {
            "omitted": "On modify, leave unchanged. On add, use the field default.",
            "null": (
                "Allowed only for nullable fields. Clears optional item "
                "metadata/category; item location null/empty explicitly assigns "
                "Unassigned; parent null/empty moves to top level; category default "
                "place null clears its explicit default; metadata_enabled null clears"
                " overrides."
            ),
            "empty_string": (
                "Clears text fields whose schema allows empty strings. Not valid for "
                "required name/unit/kind, dates or numbers. Empty reference strings "
                "behave as null."
            ),
            "zero": (
                "A real numeric value, never treated as absent. Quantity 0 is legal; "
                "fullness 0 means empty."
            ),
            "empty_array": (
                "tags: [] and links: [] replace and clear the corresponding "
                "collections. Null is not an array."
            ),
            "quantity": (
                "Accept JSON numbers or decimal strings, up to 3 fractional digits; "
                "no negatives for absolute quantity or threshold. Add defaults to 1. "
                "Modify.quantity replaces stock; "
                "quantity_delta/add_quantity/remove_quantity adjust it. Specify "
                "exactly one quantity instruction; resulting stock cannot be "
                "negative. Unit changes are labels only and never convert quantity."
            ),
            "fullness": (
                "Integer 0–100 or null, defaults null. This is separate from "
                "quantity. Category capabilities.fullness controls whether the UI "
                "shows it; the database/importer accepts and retains it even when "
                "hidden. Prefer setting it only for an appropriate category. Category"
                " capabilities are display flags, not required-field validators."
            ),
            "move": (
                "modify.location moves a whole record without merging. Prefer explicit move "
                "or split when specifying a transfer quantity or destination duplicate policy. "
                "See _schemas.item.move/split/merge for quantity and attachment behavior."
            ),
        },
        "_duplicate_rules": {
            "items": (
                "An add is a duplicate only when normalized name + category + "
                "resolved physical location + immediate container (null for direct stock) "
                "+ serial_number match an active record. "
                "Separate non-empty serials remain distinct. Same name/category in "
                "different locations or containers is valid; retain the same canonical name. Shared"
                " barcode is valid and does not merge stock."
            ),
            "same_location": (
                "Exact duplicate adds follow the batch duplicate_policy: error by default, "
                "skip, merge_quantity, or replace. See policy definitions. "
                "Explicit modify with quantity_delta or add_quantity also supports restocking."
            ),
            "batch": (
                "Preview runs sequentially against a temporary database, including "
                "earlier successful operations. Collisions show the current operation"
                " number and the earlier operation when applicable. Apply "
                "revalidates; version 2 rolls back the entire batch on any failure."
            ),
            "hierarchy": (
                "An add of an existing same-parent category or place is "
                "reused/skipped. Category add may still update explicitly supplied "
                "capability/default-place metadata. To change an existing place use "
                "modify. Never append location names to product names to bypass "
                "duplicate checks."
            ),
            "raw_exports": (
                "findstuff-export-v1 merges by immutable public_id for items/places "
                "and category identity mapping, preserving separate records even with"
                " identical names. It never infers stock increments from names."
            ),
        },
        "_location_rules": {
            "kinds": (
                "Descriptive, not a containment permission system. Recommended kinds "
                "are listed below; custom 1–40 character kinds are accepted."
            ),
            "hierarchy": (
                "Places may contain both items and child places. Missing parents, "
                "cycles, self-parenting and same-parent duplicate names are rejected."
                " A room inside a drawer/box/container is allowed but warned during "
                "preview. Prefer physical containment over taxonomy. Use short "
                "physical names; identical drawers under different parents are valid."
            ),
            "unassigned": (
                'System place public_id "unassigned" holds stock without an assigned '
                "place. It cannot be renamed, moved or deleted."
            ),
        },
        "_operational_guidelines": operational_guidelines(),
        "_validation_checklist": [
            "Use documented operations and types; move/split/merge support items only.",
            "Check every data field against the operation schema; do not invent fields.",
            "Use one alias per reference and one quantity instruction per operation.",
            (
                "Resolve all references against available metadata or earlier "
                "operations; avoid ambiguous leaf names."
            ),
            (
                "Preserve canonical names across locations; inspect existing matching"
                " stock before adding."
            ),
            (
                "Validate null/empty/default semantics, decimal precision, units, "
                "integer dimensions, dates, URLs and capability flags."
            ),
            (
                "Create parents before children, then stock; empty children/stock "
                "before deleting a place or category."
            ),
            (
                "Preview and review all item destinations, warnings and changes. "
                "After any edit or rejection, preview again before applying."
            ),
        ],
        "_available_units": inventory_units(connection),
        "_available_location_kinds": [row["name"] for row in list_location_types(connection)],
        "_location_kind_descriptions": {
            "room": "Physical room",
            "shelf": "Shelf or rack surface",
            "drawer": "Pull-out drawer",
            "box": "Storage box",
            "container": "Portable storage container",
            "display": "Display unit",
            "location": "General place; custom kinds are descriptive",
        },
        "_category_capability_fields": list(CATEGORY_DATA_FIELDS),
        "_available_categories": [
            {
                key: category.get(key)
                for key in ("id", "name", "path", "parent_id", "capabilities", "default_location")
            }
            for category in categories
        ],
        "_available_locations": locations,
        "_available_items": [
            dict(row)
            for row in connection.execute(
                "SELECT items.id, items.public_id, items.name, items.category_id, "
                "locations.public_id AS location_public_id, items.serial_number, "
                "items.quantity_milli / 1000.0 AS quantity, items.unit, "
                "COALESCE(NULLIF(items.barcode_override, ''), products.barcode, '') "
                "AS barcode FROM items JOIN locations ON "
                "locations.id=items.location_id LEFT JOIN products ON "
                "products.id=items.product_id WHERE items.archived_at IS NULL ORDER "
                "BY items.name, items.id"
            )
        ],
        "_examples": examples(),
        "operations": [],
    }

    from .extension_template import extend_template
    from .import_template import augment_template

    return extend_template(connection, augment_template(template))


def operational_guidelines():
    return {
        "category_selection": [
            (
                "Search existing categories first; reuse the most specific accurate "
                "category by primary function."
            ),
            (
                "Create only when existing categories are materially inadequate; "
                "choose the narrowest sensible parent and sibling naming style."
            ),
            (
                "Avoid junk near-duplicates such as Printer Spares/3D Printing Stuff "
                "when the established 3D Printing category fits."
            ),
            (
                "Avoid brand-specific categories unless the existing taxonomy does "
                "that intentionally. Preserve repeated leaf names under different "
                "parents."
            ),
        ],
        "item_naming": [
            (
                "Preserve clear explicit names. Normalize retailer titles "
                "conservatively and remove marketing fluff."
            ),
            (
                "Use Brand + Model + useful variant when known: Flipper Zero; Samsung"
                " Galaxy S23 Ultra 256GB; Bambu Lab PLA Basic Black 1kg; ESP32-C6 "
                "SuperMini."
            ),
            (
                "Keep meaningful capacity/size/color/revision/connectors only when "
                "distinguishing. Never invent model numbers or append place names for"
                " uniqueness."
            ),
        ],
        "web_enrichment": {
            "when": (
                "Only for identifiable commercial products: brand/model, part number,"
                " SKU, UPC/EAN/ISBN or recognized product name. The template itself "
                "performs no research."
            ),
            "sources": [
                "Official manufacturer",
                "Official manual/datasheet",
                "Trusted product database",
                "Reputable retailer only if necessary",
            ],
            "supported_fields": [
                "name",
                "brand",
                "model",
                "barcode",
                "weight_g",
                "length_mm",
                "width_mm",
                "height_mm",
                "description",
                "notes",
                "links",
            ],
            "unsupported_dedicated_fields": [
                "manufacturer",
                "sku",
                "part_number",
                "color",
                "capacity",
                "voltage",
                "wattage",
                "connector_type",
                "material",
                "release_year",
            ],
            "rules": [
                "Never overwrite explicit user information with research.",
                (
                    "Only add sourced relevant facts; include HTTP(S) source links and "
                    "put useful unsupported specifications in notes/description."
                ),
                (
                    "Do not research generic objects without value, guess an exact model "
                    "from vague descriptions, or invent technical specs, codes or "
                    "barcodes."
                ),
            ],
        },
        "confidence": {
            "high": "Proceed with supported metadata and exact references.",
            "medium": (
                "Prefer existing generic structures and conservative metadata; avoid new taxonomy."
            ),
            "low": (
                "Do not invent structure or specifications. Use less-specific "
                "accurate metadata or leave optional fields absent."
            ),
        },
        "workflow": [
            "Parse requested changes",
            "Resolve physical places",
            "Search existing categories and stock",
            "Identify useful, reliably identifiable product research",
            "Enrich conservatively with sources",
            "Preserve canonical names",
            "Create only justified missing structures",
            "Emit operations in dependency order",
            "Validate fields, matching, quantities and duplicate rules",
            "Return only strict operation payload JSON; owner previews and applies",
        ],
    }


def examples():
    def operation(op, entity, data=None, match=None):
        return {
            "op": op,
            "type": entity,
            **({"match": match} if match else {}),
            **({"data": data} if data is not None else {}),
        }

    exact = {"public_id": "itm_REPLACE_WITH_EXPORTED_ID"}
    return {
        "note": (
            "Independent examples, not one executable batch. Replace example "
            "paths and IDs with exported values. Dependency examples contain "
            "complete ordered arrays. Never copy placeholder IDs."
        ),
        "add_minimal": operation("add", "item", {"name": "ESP32-C6 SuperMini"}),
        "add_placed": operation(
            "add",
            "item",
            {
                "name": "PTFE Push-Fit Pneumatic Fittings",
                "category": "Hobbies > 3D Printing > PTFE Tubes & Pneumatic Fittings",
                "location": "Scatola Verde 1",
                "quantity": "3",
                "unit": "pcs",
            },
        ),
        "same_product_other_place": operation(
            "add",
            "item",
            {
                "name": "PTFE Push-Fit Pneumatic Fittings",
                "category": "Hobbies > 3D Printing > PTFE Tubes & Pneumatic Fittings",
                "location": "Scatola Verde 2",
                "quantity": "14",
                "unit": "pcs",
            },
        ),
        "fill_a_container": [
            operation(
                "add",
                "item",
                {
                    "name": "Toolbox A",
                    "location": "Workshop > Shelf B",
                    "quantity": "1",
                    "unit": "pcs",
                    "is_container": True,
                },
            ),
            operation(
                "add",
                "item",
                {
                    "name": "PTFE Push-Fit Pneumatic Fittings",
                    "container_item_id": "Toolbox A",
                    "quantity": "14",
                    "unit": "pcs",
                },
            ),
        ],
        "move_item_into_existing_container": operation(
            "modify", "item", {"container_item_id": "itm_REPLACE_WITH_EXPORTED_ID"}, exact
        ),
        "take_item_out_of_its_container": operation(
            "modify",
            "item",
            {"container_item_id": None, "location": "Workshop > Shelf B"},
            exact,
        ),
        "move_container_with_everything_inside": operation(
            "modify", "item", {"location": "Garage > Rack 2"}, exact
        ),
        "set_quantity": operation("modify", "item", {"quantity": "0"}, exact),
        "increment_stock": operation("modify", "item", {"quantity_delta": "2.5"}, exact),
        "move_whole_record": operation("modify", "item", {"location": "Workshop > Shelf B"}, exact),
        "rename_item": operation("modify", "item", {"name": "Canonical replacement name"}, exact),
        "change_category": operation(
            "modify", "item", {"category": "Electronics > Development Boards"}, exact
        ),
        "clear_optional_fields": operation(
            "modify",
            "item",
            {
                "expiration_date": None,
                "fullness_percent": None,
                "notes": "",
                "tags": [],
                "links": [],
            },
            exact,
        ),
        "set_fullness": operation("modify", "item", {"fullness_percent": 75}, exact),
        "archive_item": operation("delete", "item", match=exact),
        "qualified_name": operation(
            "modify",
            "item",
            {"add_quantity": "2"},
            {
                "name": "PTFE Push-Fit Pneumatic Fittings",
                "category": "Hobbies > 3D Printing > PTFE Tubes & Pneumatic Fittings",
                "location": "Scatola Verde 2",
            },
        ),
        "add_category": operation("add", "category", {"name": "My supplies"}),
        "nested_category": operation(
            "add", "category", {"name": "Consumables", "parent": "Workshop supplies"}
        ),
        "rename_category": operation(
            "modify", "category", {"name": "Replacement name"}, {"id": 123}
        ),
        "delete_empty_category": operation(
            "delete", "category", match={"path": "Workshop supplies > Empty category"}
        ),
        "category_capabilities": operation(
            "modify",
            "category",
            {"metadata_enabled": {"fullness": True, "expiration": True}},
            {"id": 123},
        ),
        "category_default_place": operation(
            "modify", "category", {"default_location": "Workshop > Shelf B"}, {"id": 123}
        ),
        "add_location": operation("add", "location", {"name": "Workshop", "kind": "room"}),
        "nested_location": operation(
            "add", "location", {"name": "Drawer", "parent": "Workshop > Shelf B", "kind": "drawer"}
        ),
        "move_rename_location": operation(
            "modify",
            "location",
            {"name": "Drawer A", "parent": "Workshop > Shelf B"},
            {"public_id": "loc_REPLACE_WITH_EXPORTED_ID"},
        ),
        "delete_empty_place": operation(
            "delete", "location", match={"path": "Workshop > Empty box"}
        ),
        "same_batch_references": [
            operation("add", "category", {"name": "Example supplies"}),
            operation("add", "category", {"name": "Consumables", "parent": "Example supplies"}),
            operation("add", "location", {"name": "Example workshop", "kind": "room"}),
            operation(
                "add",
                "location",
                {"name": "Drawer", "parent": "Example workshop", "kind": "drawer"},
            ),
            operation(
                "add",
                "item",
                {
                    "name": "Example cable",
                    "category": "Example supplies > Consumables",
                    "location": "Example workshop > Drawer",
                    "quantity": "1",
                },
            ),
        ],
        "invalid_examples": [
            {"data": {"fullness_percent": 101}, "error": "Maximum is 100"},
            {"data": {"fullness_percent": 12.5}, "error": "Must be an integer"},
            {"data": {"quantity": -1}, "error": "Absolute stock cannot be negative"},
            {"data": {"quantity": 4, "add_quantity": 2}, "error": "Use one quantity instruction"},
            {
                "data": {"manufacturer": "Example"},
                "error": "Unsupported field; use brand if appropriate or notes",
            },
        ],
    }
