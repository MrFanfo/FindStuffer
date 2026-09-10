"""Additional operation contracts using the executor's shared policy and limit constants."""

from __future__ import annotations

import uuid

from .import_protocol import (
    ACTIONS,
    MAX_IMPORT_BYTES,
    MAX_NESTING,
    MAX_OPERATIONS,
    MAX_SECONDS,
    ORDERINGS,
    POLICIES,
)
from .operations_contract import LOCATION_REFERENCES, MATCH_FIELDS


def augment_template(template):
    import_id = str(uuid.uuid4())
    template.update(import_id=import_id, duplicate_policy="error", ordering="input")
    template["instructions"]["output"].update(
        import_id=import_id, duplicate_policy="error", ordering="input"
    )
    template["_batch_contract"] = {
        "allowed_operations": list(ACTIONS),
        "import_id": {
            "type": "string",
            "maxLength": 120,
            "description": (
                "Unique ID for this intended batch. Preserve it across retries. A "
                "missing ID uses a SHA-256 hash of semantic content. Reusing an ID "
                "with different content is rejected. Generate a new ID only for a "
                "deliberately new batch, including a repeated stock increment."
            ),
        },
        "duplicate_policy": {"enum": list(POLICIES), "default": "error"},
        "ordering": {"enum": list(ORDERINGS), "default": "input"},
        "atomic": (
            "Version 2 always commits the whole batch or rolls it all back. "
            "Preview never commits. Legacy version 1 reports partial success "
            "and retains completed operations; prefer version 2."
        ),
        "idempotency": (
            "Successful batch receipts persist beyond the five undoable "
            "snapshots. An identical retry returns its original receipt without"
            " applying stock changes again. Undo marks the receipt undone; "
            "replay does not reapply an undone batch."
        ),
        "provenance": (
            "Committed version 2 operations record the import ID, original "
            "operation index, affected object IDs and before/after details. "
            "Item provenance is available through the API."
        ),
        "limits": {
            "max_operations": MAX_OPERATIONS,
            "max_file_bytes": MAX_IMPORT_BYTES,
            "max_json_nesting": MAX_NESTING,
            "execution_budget_seconds": MAX_SECONDS,
        },
        "large_batches": (
            "Split more than 1,000 operations into separately reviewed batches."
            " In particular a 5,000-operation file is rejected before "
            "execution. Preview and execution stop between operations after 30 "
            "seconds; a commit timeout rolls back. The UI waits 45 seconds and "
            "retries are safe with the same ID. Imports run outside the API "
            "event loop; simultaneous writes can wait for SQLite's write lock."
        ),
        "strict_json": (
            "UTF-8 JSON object only: no comments, trailing commas, duplicate "
            "keys, NaN or Infinity. Unknown operation/data/match fields are "
            "rejected. Known template helper sections (underscore-prefixed "
            "keys, instructions, app_version and $defs) are ignored; do not "
            "emit them."
        ),
        "dependency_order": (
            "input preserves the exact array order: create parents before "
            "children, then items referencing them. dependencies stably "
            "prioritizes category/place additions and retries missing "
            "references after ready operations. Original operation numbers "
            "remain in results; execution_order shows actual execution. "
            "Unresolved or circular chains fail the whole batch. Prefer "
            "returning correctly ordered input rather than relying on "
            "reordering."
        ),
        "path_escaping": (
            "There is no escape syntax for > in paths. Use IDs for existing "
            "names containing >; do not use invented backslash escaping. To "
            "create and reference a new separator-containing name, import that "
            "structure first, export its generated ID, then reference it in a "
            "second batch."
        ),
        "normalization": (
            "Names have outer whitespace trimmed on creation and matching; "
            "matching uses SQLite NOCASE (ASCII case-insensitive). Internal "
            "whitespace and spelling are significant. ADXL245 and adxl245 "
            "match. The importer never invents suffixes or changes canonical "
            "spelling to bypass uniqueness. Explicit name "
            "modifications/replacements are allowed."
        ),
    }
    template["_duplicate_rules"].update(
        {
            "identity": (
                "Active item: outer-trimmed case-insensitive name + category ID "
                "(null is a category value) + location public ID + outer-trimmed "
                "case-insensitive serial number. Different nonempty serials "
                "distinguish physical assets. Barcode identifies a product, not one"
                " stock location. Units must agree before quantity merge."
            ),
            "policies": {
                "error": (
                    "Reject an exact item add collision with the conflicting record and"
                    " operation number. Different places are valid."
                ),
                "skip": (
                    "Validate the proposed fields, then leave existing exact stock "
                    "unchanged. Show skip in preview."
                ),
                "merge_quantity": (
                    "For an exact item add collision, increment existing stock by "
                    "data.quantity (default 1). Keep existing metadata, name and ID. "
                    "Units must match. For a move/split destination collision, transfer"
                    " the specified stock into that exact destination record."
                ),
                "replace": (
                    "On item add collision, update only explicitly supplied fields of "
                    "the existing record, preserving its public ID. Supplied quantity "
                    "replaces stock; omitted fields stay unchanged. This is not "
                    "delete-and-recreate. Not permitted for colliding move/split "
                    "operations."
                ),
            },
            "scope": (
                "Policy is per batch, applies to item adds and transfer "
                "destinations, and is simulated against both existing DB state and "
                "earlier successful operations. Category/place additions reuse "
                "same-parent identities; category metadata supplied on add can "
                "update that existing category, while existing place metadata stays"
                " unchanged."
            ),
        }
    )
    item = template["_schemas"]["item"]
    for action in ("move", "split"):
        item[action] = {
            "required": ["match", "data"],
            "match_by": list(MATCH_FIELDS["item"]),
            "allowed_fields": [*LOCATION_REFERENCES, "quantity"],
            "required_data": ["exactly one location reference"]
            + (["quantity"] if action == "split" else []),
            "effect": (
                "Transfer the whole record if quantity is omitted; preserve "
                "public_id when no destination collision. A partial quantity leaves"
                " the source ID with the remainder and creates destination stock or"
                " merges by selected policy. split requires a positive quantity "
                "strictly less than source stock; move allows the whole quantity. "
                "Never rename the product. No implicit unit conversion."
            ),
            "attachments": (
                "A newly split record copies item fields and tags. Photos, "
                "documents, lots and relationships stay at source; preview warns. "
                "Full moves preserve these on the same record. A full quantity "
                "transfer into existing destination stock leaves the source record "
                "at zero."
            ),
        }
    item["merge"] = {
        "required": ["match", "data"],
        "match_by": list(MATCH_FIELDS["item"]),
        "allowed_fields": ["quantity", "source"],
        "effect": (
            "Exactly one of data.quantity (positive increment into matched "
            "stock) or data.source (another item match). Source-record merge "
            "requires equal name, category, location, serial and unit. Add "
            "source stock to target, zero and archive source. Target keeps its "
            "ID and metadata. Source attachments and metadata stay recoverable "
            "on the archived source. Never merge a record into itself."
        ),
    }
    template["_field_definitions"]["item"]["source"] = {
        "type": "object",
        "match_by": list(MATCH_FIELDS["item"]),
        "nullable": False,
        "merge_only": True,
        "description": "Exact match selecting the source stock record to merge and archive.",
    }
    for entity, fields in template["_field_definitions"].items():
        for name, field in fields.items():
            if "alias_of" in field:
                inherited = dict(fields[field["alias_of"]])
                fields[name] = field = {**inherited, **field}
            field.setdefault("matchable", name in MATCH_FIELDS[entity])
            field.setdefault("modifiable", not field.get("match_only", False))
            field["duplicate_identity"] = entity == "item" and (
                name
                in (
                    "name",
                    "serial_number",
                    "category",
                    "category_id",
                    "category_path",
                    "category_name",
                    *LOCATION_REFERENCES,
                )
            )
            field.setdefault("omitted_on_modify", "unchanged")
            field.setdefault(
                "null_behavior", "clear/reset" if field.get("nullable") else "rejected"
            )
            kind = field.get("type")
            if not kind:
                kind = next(
                    (
                        option.get("type")
                        for option in field.get("anyOf", [])
                        if option.get("type") != "null"
                    ),
                    None,
                )
            example = field.get("default")
            if example is None or example == "":
                example = {
                    "string": "Example",
                    "integer": 1,
                    "number": 1,
                    "array": [],
                    "object": {},
                }.get(kind if isinstance(kind, str) else "object")
            if field.get("reference") == "location":
                example = "Workshop > Box A"
            elif field.get("reference") == "category":
                example = "Hobbies > 3D Printing"
            elif field.get("format") == "date" or name == "expiration_date":
                example = "2027-12-31"
            elif name in ("purchase_currency", "estimated_price_currency"):
                example = "EUR"
            elif name == "public_id":
                example = (
                    "itm_REPLACE_WITH_EXPORTED_ID"
                    if entity == "item"
                    else "loc_REPLACE_WITH_EXPORTED_ID"
                )
            elif name == "metadata_enabled" or field.get("alias_of") == "metadata_enabled":
                example = {"fullness": True}
            elif name == "source":
                example = {"public_id": "itm_REPLACE_WITH_EXPORTED_ID"}
            field.setdefault("examples", [example])
    item["move"]["quantity"] = {
        "type": ["number", "string"],
        "decimal_places": 3,
        "nullable": False,
        "omitted": "move entire stock",
        "exclusiveMinimum": 0,
        "maximum": "current source quantity",
    }
    item["split"]["quantity"] = {
        **item["move"]["quantity"],
        "omitted": "error",
        "maximum": "strictly less than source quantity",
    }
    item["merge"]["quantity"] = {
        "type": ["number", "string"],
        "decimal_places": 3,
        "nullable": False,
        "exclusiveMinimum": 0,
        "meaning": "increment target stock",
    }
    template["_preview_contract"] = {
        "per_operation": [
            "operation_index",
            "action",
            "entity",
            "status",
            "validation_status",
            "before",
            "after",
            "warnings",
        ],
        "status": ["add", "modify", "delete", "skip", "merge", "replace", "move", "split", "error"],
        "validation_status": ["valid", "warning", "failed"],
        "validation_errors": [
            "operation_index",
            "error_code",
            "field",
            "message",
            "conflicting_item_id",
            "conflicting_item",
            "conflicting_operation_index",
        ],
        "field_errors": (
            "Pydantic failures include a fields array with exact field path and"
            " validator error_code, such as missing, decimal_max_places, "
            "greater_than_equal, int_from_float, or string_type."
        ),
        "warnings": (
            "Warnings do not prevent apply; failures prevent the entire version"
            " 2 batch. Examples: uncategorised item, unusual room nesting, and "
            "attachment behavior on splits. Inspect the before/after paths and "
            "stock totals."
        ),
    }
    template["_examples"].update(
        {
            "explicit_move": {
                "op": "move",
                "type": "item",
                "match": {"public_id": "itm_REPLACE_WITH_EXPORTED_ID"},
                "data": {"location": "Workshop > Box B"},
            },
            "split_five_of_fourteen": {
                "op": "split",
                "type": "item",
                "match": {"public_id": "itm_REPLACE_WITH_EXPORTED_ID"},
                "data": {"quantity": 5, "location": "Workshop > Box B"},
            },
            "merge_stock_increment": {
                "op": "merge",
                "type": "item",
                "match": {"public_id": "itm_REPLACE_WITH_EXPORTED_ID"},
                "data": {"quantity": 5},
            },
            "merge_two_records": {
                "op": "merge",
                "type": "item",
                "match": {"public_id": "itm_TARGET_ID"},
                "data": {"source": {"public_id": "itm_SOURCE_ID"}},
            },
        }
    )
    template["_validation_checklist"].extend(
        [
            (
                "Preserve import_id on retries; choose duplicate_policy "
                "deliberately and review its simulated effects."
            ),
            (
                "Check source and destination stock on every transfer, split or "
                "merge; inspect attachment warnings."
            ),
        ]
    )
    return template
