"""Versioned, bounded, retry-safe import execution; preview uses the same executor."""

from __future__ import annotations

import hashlib
import json
import math
import sqlite3
import time
from decimal import Decimal
from typing import Any

from pydantic import ValidationError

from .db import transaction
from .inventory import ConflictError, NotFoundError
from .operations_contract import LOCATION_REFERENCES, validate_revision, validate_shape
from .schemas import QuantityAdjustment

MAX_OPERATIONS = 1000
MAX_IMPORT_BYTES = 4 * 1024 * 1024
MAX_NESTING = 32
MAX_SECONDS = 30
POLICIES = ("error", "skip", "merge_quantity", "replace")
ORDERINGS = ("input", "dependencies")
ACTIONS = ("add", "modify", "delete", "move", "split", "merge")


class ImportFailure(ValueError):
    def __init__(self, message: str, code="invalid_value", field=None, **context):
        super().__init__(message)
        self.details = {"error_code": code, "field": field, **context}


def strict_json(raw: bytes | str) -> dict[str, Any]:
    if len(raw.encode() if isinstance(raw, str) else raw) > MAX_IMPORT_BYTES:
        raise ImportFailure("Import exceeds the 4 MiB limit", "file_too_large")

    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise ImportFailure(f"Duplicate JSON key: {key}", "duplicate_key", key)
            result[key] = value
        return result

    def constant(value):
        raise ImportFailure(f"Invalid JSON number: {value}", "invalid_json")

    try:
        result = json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)
    except (json.JSONDecodeError, UnicodeDecodeError, RecursionError) as exc:
        raise ImportFailure(f"Invalid strict JSON: {exc}", "invalid_json") from exc
    if not isinstance(result, dict):
        raise ImportFailure("Import must be a JSON object", "wrong_type")
    validate_depth(result)
    return result


def validate_depth(value, depth=0):
    if isinstance(value, float) and not math.isfinite(value):
        raise ImportFailure("Non-finite JSON number", "invalid_json")
    if depth > MAX_NESTING:
        raise ImportFailure("Import nesting exceeds 32 levels", "nesting_limit")
    if isinstance(value, dict):
        for child in value.values():
            validate_depth(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            validate_depth(child, depth + 1)


def identity(payload):
    semantic = {
        key: value
        for key, value in payload.items()
        if key
        in ("format", "schema_version", "duplicate_policy", "ordering", "operations", "tables")
    }
    encoded = json.dumps(semantic, sort_keys=True, separators=(",", ":"), allow_nan=False)
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    import_id = payload.get("import_id", f"sha256:{digest}")
    if not isinstance(import_id, str) or not 1 <= len(import_id) <= 120 or not import_id.strip():
        raise ImportFailure(
            "import_id must be a nonempty string of at most 120 characters",
            "invalid_import_id",
            "import_id",
        )
    return import_id, digest


def validate_envelope(payload):
    validate_revision(payload)
    validate_depth(payload)
    if len(json.dumps(payload).encode()) > MAX_IMPORT_BYTES:
        raise ImportFailure("Import exceeds the 4 MiB limit", "file_too_large")
    operations = payload.get("operations")
    if not isinstance(operations, list):
        raise ImportFailure("operations must be an array", "wrong_type", "operations")
    if len(operations) > MAX_OPERATIONS:
        raise ImportFailure(
            "At most 1,000 operations per import; split larger files into batches",
            "operation_limit",
            "operations",
        )
    if payload.get("duplicate_policy", "error") not in POLICIES:
        raise ImportFailure("Unknown duplicate_policy", "invalid_enum", "duplicate_policy")
    if payload.get("ordering", "input") not in ORDERINGS:
        raise ImportFailure("Unknown ordering", "invalid_enum", "ordering")
    allowed = {
        "format",
        "schema_version",
        "import_id",
        "duplicate_policy",
        "ordering",
        "operations",
        "instructions",
        "app_version",
        "$defs",
    }
    unknown = [key for key in payload if key not in allowed and not key.startswith("_")]
    if unknown:
        raise ImportFailure(
            f"Unsupported envelope field: {unknown[0]}", "unsupported_field", unknown[0]
        )
    identity(payload)


def error_detail(exc, index):
    message = str(exc)
    detail = {
        "operation_index": index,
        "error_code": "invalid_value",
        "field": None,
        "conflicting_item_id": None,
        "message": message,
    }
    if isinstance(exc, ImportFailure):
        detail.update(exc.details)
    elif isinstance(exc, ValidationError):
        fields = [
            {
                "field": ".".join(str(v) for v in error["loc"]),
                "error_code": error["type"],
                "message": error["msg"],
            }
            for error in exc.errors(include_url=False)
        ]
        detail.update(error_code="field_validation", field=fields[0]["field"], fields=fields)
    elif "ambiguous" in message.lower():
        detail["error_code"] = "ambiguous_match"
    elif "not found" in message.lower() or isinstance(exc, NotFoundError):
        detail["error_code"] = "missing_reference"
    elif "Unsupported" in message or "Unknown" in message:
        detail["error_code"] = "unsupported_field"
    elif "cycle" in message.lower() or "descendant" in message.lower():
        detail["error_code"] = "circular_dependency"
    return detail


def receipt(connection, payload):
    import_id, digest = identity(payload)
    row = connection.execute(
        "SELECT * FROM import_receipts WHERE import_id=?", (import_id,)
    ).fetchone()
    if row and row["payload_hash"] != digest:
        raise ImportFailure(
            "This import_id was already used for different content. Use a new ID.",
            "import_id_conflict",
            "import_id",
        )
    if row:
        return {
            **json.loads(row["result_json"]),
            "replayed": True,
            "undone": bool(row["undone_at"]),
        }
    return None


def _snapshot(connection, entity, match):
    from . import extended as ex

    if entity == "item":
        return ex._item_snapshot(connection, ex._item_public_id_from_match(connection, match))
    if entity == "location":
        return ex._location_snapshot(
            connection, ex._location_public_id_from_match(connection, match)
        )
    return ex._category_snapshot(connection, ex._category_id_from_match(connection, match))


def _undo_before(entity, before, op):
    action = "update" if op != "delete" else "restore" if entity != "category" else "create"
    return {
        "entity": entity,
        "action": action,
        "data": before,
        **(
            {"id": before["id"], "path": before["path"]}
            if entity == "category"
            else {"public_id": before["public_id"]}
        ),
    }


def _primitive(connection, operation, undo):
    from . import extended as ex

    op, entity = operation["op"], operation["type"]
    before = _snapshot(connection, entity, operation.get("match", {})) if op != "add" else None
    if op == "add" and entity == "category":
        data = operation["data"]
        existing = ex._existing_category_for_add(
            connection, data["name"].strip(), ex._category_parent_from_data(connection, data)
        )
        if existing:
            before = ex._category_snapshot(connection, existing["id"])
    apply = {
        "item": ex._apply_item_operation,
        "category": ex._apply_category_operation,
        "location": ex._apply_location_operation,
    }[entity]
    applied = apply(connection, op, operation)
    if before:
        undo.append(_undo_before(entity, before, "modify" if op == "add" else op))
    elif applied and op == "add":
        undo.append(
            {
                "entity": entity,
                "action": "delete",
                **(
                    {"id": int(applied), "path": ex.category_path(connection, int(applied))}
                    if entity == "category"
                    else {"public_id": str(applied)}
                ),
            }
        )
    after = None
    if entity == "item":
        public_id = str(applied) if op == "add" else before["public_id"]
        after = ex._preview_item_fields(connection, ex._item_snapshot(connection, public_id))
        before = ex._preview_item_fields(connection, before) if before else None
    elif entity == "location" and op != "delete":
        if applied and op == "add":
            after = ex._location_snapshot(connection, str(applied))
        elif before:
            after = ex._location_snapshot(connection, before["public_id"])
    elif entity == "category" and op != "delete":
        after = ex._category_snapshot(
            connection, int(applied) if applied and op == "add" else before["id"]
        )
    return {"before": before, "after": after, "status": op if applied else "skip"}


def _modify(public_id, **data):
    return {"op": "modify", "type": "item", "match": {"public_id": public_id}, "data": data}


def _quantity(value):
    return QuantityAdjustment.model_validate({"delta": value, "expected_version": 1}).delta


def _collision(connection, duplicate):
    from . import extended as ex

    item = ex._preview_item_fields(
        connection, ex._item_snapshot(connection, duplicate["public_id"])
    )
    return ImportFailure(
        "Duplicate item by name and category at the same location: "
        + ex._item_identity_description(connection, duplicate)
        + f"; quantity {item['quantity']} {item['unit']}",
        "duplicate_item",
        "data.location",
        conflicting_item_id=item["public_id"],
        conflicting_item=item,
    )


def _add_item(connection, operation, policy, undo):
    from . import extended as ex

    values, _ = ex._normalized_item_values(
        connection, operation["data"], include_default_location=True
    )
    ex.validate_item_values(values, adding=True)
    duplicate = ex._duplicate_item_for_add(connection, values)
    if not duplicate:
        return _primitive(connection, operation, undo)
    if policy == "error":
        raise _collision(connection, duplicate)
    existing = ex._preview_item_fields(
        connection, ex._item_snapshot(connection, duplicate["public_id"])
    )
    if policy == "skip":
        return {"status": "skip", "before": existing, "after": existing}
    data = dict(operation["data"])
    if policy == "merge_quantity":
        if values.get("unit", "pcs") != existing["unit"]:
            raise ImportFailure(
                "Cannot merge quantities with different units", "unit_mismatch", "data.unit"
            )
        data = {"quantity_delta": data.get("quantity", 1)}
    result = _primitive(connection, _modify(existing["public_id"], **data), undo)
    result["status"] = "merge" if policy == "merge_quantity" else "replace"
    return result


def _transfer(connection, operation, policy, undo):
    from . import extended as ex

    op, data = operation["op"], operation.get("data", {})
    allowed = {*LOCATION_REFERENCES, "quantity"}
    if set(data) - allowed:
        raise ImportFailure(
            "move/split accepts only a destination and optional quantity",
            "unsupported_field",
            "data",
        )
    refs = [key for key in LOCATION_REFERENCES if key in data]
    if len(refs) != 1:
        raise ImportFailure(
            "move/split requires exactly one destination reference",
            "missing_required",
            "data.location",
        )
    source = _snapshot(connection, "item", operation["match"])
    target = ex._resolve_location_public_id(connection, data[refs[0]]) or "unassigned"
    if target == source["location_public_id"]:
        raise ImportFailure(
            "Source and destination places are the same", "same_location", "data.location"
        )
    if op == "split" and "quantity" not in data:
        raise ImportFailure("split requires quantity", "missing_required", "data.quantity")
    quantity = _quantity(data.get("quantity", source["quantity"]))
    total = Decimal(source["quantity"])
    if quantity <= 0 or quantity > total or (op == "split" and quantity == total):
        raise ImportFailure(
            (
                "Move quantity must be positive and no more than stock; split must "
                "leave stock at source"
            ),
            "out_of_range",
            "data.quantity",
        )
    values = {**source, "location_public_id": target}
    duplicate = ex._duplicate_item_for_add(connection, values)
    if duplicate and policy == "error":
        raise _collision(connection, duplicate)
    if duplicate and policy == "skip":
        return {
            "status": "skip",
            "before": ex._preview_item_fields(connection, source),
            "after": ex._preview_item_fields(connection, source),
        }
    if duplicate and policy == "replace":
        raise ImportFailure(
            "Transfers require error, skip or merge_quantity; replace could lose stock",
            "invalid_policy",
            "duplicate_policy",
        )
    if quantity == total and not duplicate:
        result = _primitive(connection, _modify(source["public_id"], location=target), undo)
        result.update(status="move", moved=True)
        return result
    if duplicate:
        destination = ex._item_snapshot(connection, duplicate["public_id"])
        if destination["unit"] != source["unit"]:
            raise ImportFailure(
                "Cannot transfer between different units", "unit_mismatch", "data.location"
            )
        destination_result = _primitive(
            connection, _modify(destination["public_id"], quantity_delta=str(quantity)), undo
        )
    else:
        from .schemas import ItemCreate

        new_data = {key: value for key, value in values.items() if key in ItemCreate.model_fields}
        new_data.update(quantity=str(quantity), tags=source["tags"])
        destination_result = _primitive(
            connection, {"op": "add", "type": "item", "data": new_data}, undo
        )
    source_result = _primitive(
        connection, _modify(source["public_id"], quantity_delta=str(-quantity)), undo
    )
    return {
        "status": "split" if quantity < total else "move",
        "moved": True,
        "before": ex._preview_item_fields(connection, source),
        "after": destination_result["after"],
        "source_after": source_result["after"],
        "destination_before": destination_result["before"],
        "transferred_quantity": str(quantity),
        "warnings": [
            (
                "Split copies item fields and tags; photos, documents, lots and "
                "relationships remain on the source record."
            )
        ]
        if not duplicate
        else [],
    }


def _merge(connection, operation, undo):
    from . import extended as ex

    data = operation.get("data", {})
    if set(data) not in ({"source"}, {"quantity"}):
        raise ImportFailure(
            "merge requires either source match or positive quantity", "invalid_fields", "data"
        )
    target = _snapshot(connection, "item", operation["match"])
    if "quantity" in data:
        quantity = _quantity(data["quantity"])
        if quantity <= 0:
            raise ImportFailure("merge.quantity must be positive", "out_of_range", "data.quantity")
    else:
        validate_shape({"match": data["source"], "data": {}}, "modify", "item")
        source = _snapshot(connection, "item", data["source"])
        if source["public_id"] == target["public_id"]:
            raise ImportFailure("Cannot merge an item into itself", "same_item", "data.source")
        keys = ("category_id", "location_public_id", "unit")
        if any(source[key] != target[key] for key in keys) or any(
            source[key].strip().casefold() != target[key].strip().casefold()
            for key in ("name", "serial_number")
        ):
            raise ImportFailure(
                "Merge records must have the same name, category, place, serial and unit",
                "identity_mismatch",
                "data.source",
            )
        quantity = Decimal(source["quantity"])
        _primitive(connection, _modify(source["public_id"], quantity=0), undo)
        _primitive(connection, {"op": "delete", "type": "item", "match": data["source"]}, undo)
    result = _primitive(
        connection, _modify(target["public_id"], quantity_delta=str(quantity)), undo
    )
    result["status"] = "merge"
    if "source" in data:
        result["source_before"] = ex._preview_item_fields(connection, source)
        result["warnings"] = [
            (
                "Only quantity is merged. Other metadata stays on the archived "
                "source and target records."
            )
        ]
    return result


def execute(connection, operation, index, policy, undo):
    if not isinstance(operation, dict):
        raise ImportFailure("Operation must be an object", "wrong_type")
    unknown = set(operation) - {"op", "type", "match", "data"}
    if unknown:
        raise ImportFailure(
            f"Unsupported operation field: {sorted(unknown)[0]}",
            "unsupported_field",
            sorted(unknown)[0],
        )
    for key in ("op", "type"):
        if key not in operation:
            raise ImportFailure(f"Operation requires {key}", "missing_required", key)
        if not isinstance(operation[key], str):
            raise ImportFailure(f"{key} must be a string", "wrong_type", key)
    for key in ("data", "match"):
        if key in operation and not isinstance(operation[key], dict):
            raise ImportFailure(f"{key} must be an object", "wrong_type", key)
    op, entity = operation.get("op"), operation.get("type")
    from .extension_schemas import ENTITY_MODELS

    if entity in ENTITY_MODELS:
        from .extensions import apply_entity

        return apply_entity(connection, operation, index, undo)

    if op not in ACTIONS or entity not in ("item", "category", "location"):
        raise ImportFailure("Unsupported op or type", "invalid_enum", "op/type")
    if op in ("move", "split", "merge"):
        if entity != "item":
            raise ImportFailure("move/split/merge only support items", "invalid_enum", "type")
        validate_shape({"match": operation.get("match"), "data": {}}, "modify", "item")
        result = (
            _merge(connection, operation, undo)
            if op == "merge"
            else _transfer(connection, operation, policy, undo)
        )
    else:
        validate_shape(operation, op, entity)
        result = (
            _add_item(connection, operation, policy, undo)
            if op == "add" and entity == "item"
            else _primitive(connection, operation, undo)
        )
    warnings = result.setdefault("warnings", [])
    after = result.get("after")
    if entity == "location" and after and after["kind"] == "room" and after["parent_public_id"]:
        parent = _snapshot(connection, "location", {"public_id": after["parent_public_id"]})
        if parent["kind"] in ("box", "drawer", "container"):
            warnings.append(
                f"Unusual hierarchy: room {after['path']} is inside a {parent['kind']}."
            )
    if entity == "item" and after and not after["category_id"]:
        warnings.append("Item has no category; check whether an existing category fits.")
    if result.get("before") and after and entity == "item":
        result["moved"] = (
            result.get("moved")
            or result["before"]["location_public_id"] != after["location_public_id"]
        )
    label = f"Operation #{index}: {op} {entity}"
    return {
        **result,
        "index": index,
        "operation_index": index,
        "entity": entity,
        "action": op,
        "label": label,
        "validation_status": "warning" if warnings else "valid",
        "message": f"Will {result['status']} {entity}.",
        "temporary_identity": op == "add" and result["status"] == "add",
    }


def _run(connection, payload):
    started = time.monotonic()
    undo, details, errors = [], [], []
    pending = list(enumerate(payload["operations"], 1))
    dependencies = payload.get("ordering") == "dependencies"
    if dependencies:
        pending.sort(
            key=lambda pair: (
                0
                if isinstance(pair[1], dict)
                and pair[1].get("op") == "add"
                and pair[1].get("type")
                in ("category", "location", "category_field", "compatibility_target", "project")
                else 1
            )
        )
    origins = {}
    while pending:
        deferred = []
        progress = False
        for index, operation in pending:
            checkpoint = len(undo)
            try:
                if time.monotonic() - started > MAX_SECONDS:
                    raise ImportFailure(
                        "Import exceeded 30 seconds; split it into smaller batches", "time_limit"
                    )
                with transaction(connection):
                    detail = execute(
                        connection, operation, index, payload.get("duplicate_policy", "error"), undo
                    )
                progress = True
                after = detail.get("after")
                if detail["status"] == "add" and after and after.get("public_id"):
                    origins[after["public_id"]] = index
                details.append(detail)
            except (
                ValueError,
                ConflictError,
                NotFoundError,
                KeyError,
                TypeError,
                sqlite3.Error,
            ) as exc:
                del undo[checkpoint:]
                error = error_detail(exc, index)
                if dependencies and error["error_code"] == "missing_reference":
                    deferred.append((index, operation, error))
                    continue
                if error.get("conflicting_item_id") in origins:
                    previous = origins[error["conflicting_item_id"]]
                    error.update(conflicting_operation_index=previous)
                    error["message"] += f" (created by earlier Operation #{previous})"
                errors.append(error)
                details.append(
                    {
                        "index": index,
                        "operation_index": index,
                        "entity": operation.get("type", "unknown")
                        if isinstance(operation, dict)
                        else "unknown",
                        "action": "invalid",
                        "status": "error",
                        "validation_status": "failed",
                        "label": f"Operation #{index}",
                        "message": error["message"],
                        "error": error,
                    }
                )
        if deferred and not progress:
            for index, operation, error in deferred:
                error["error_code"] = "unresolved_dependency"
                error["message"] += (
                    "; missing or circular dependency; no dependency-safe ordering exists"
                )
                errors.append(error)
                details.append(
                    {
                        "index": index,
                        "operation_index": index,
                        "entity": operation["type"],
                        "action": operation["op"],
                        "status": "error",
                        "validation_status": "failed",
                        "label": f"Operation #{index}",
                        "message": error["message"],
                        "error": error,
                    }
                )
            break
        pending = [(index, operation) for index, operation, _ in deferred]
    counts = {
        "operations": len(details),
        "items_added": 0,
        "items_moved": 0,
        "merged": 0,
        "replaced": 0,
        "skipped": 0,
        "locations_created": 0,
        "categories_created": 0,
        "warnings": 0,
        "errors": len(errors),
        "items": 0,
        "locations": 0,
        "categories": 0,
    }
    for detail in details:
        if detail["status"] == "error":
            continue
        entity = detail["entity"]
        count_key = {"item": "items", "location": "locations", "category": "categories"}.get(
            entity, entity + "s"
        )
        counts[count_key] = counts.get(count_key, 0) + (detail["status"] != "skip")
        counts["items_added"] += entity == "item" and detail["status"] == "add"
        counts["items_moved"] += bool(detail.get("moved"))
        counts["locations_created"] += entity == "location" and detail["status"] == "add"
        counts["categories_created"] += entity == "category" and detail["status"] == "add"
        counts["merged"] += detail["status"] == "merge"
        counts["replaced"] += detail["status"] == "replace"
        counts["skipped"] += detail["status"] == "skip"
        counts["warnings"] += len(detail.get("warnings", []))
    return {
        "valid": not errors,
        "mode": "operations",
        "atomic": True,
        "counts": counts,
        "errors": [
            f"Operation #{error['operation_index']}: {error['message']}" for error in errors
        ],
        "validation_errors": errors,
        "details": details,
        "execution_order": [detail["index"] for detail in details],
        "note": (
            "Atomic import: if any operation fails, the whole batch rolls back."
            " Nothing is committed by preview."
        ),
    }, undo


def preview_v2(connection, payload):
    validate_envelope(payload)
    previous = receipt(connection, payload)
    if previous:
        return {
            **previous,
            "dry_run": True,
            "note": (
                "This import was already applied. Apply will return its receipt "
                "without writing again."
            ),
        }
    clone = sqlite3.connect(":memory:")
    clone.row_factory = sqlite3.Row
    clone.execute("PRAGMA foreign_keys = ON")
    connection.backup(clone)
    try:
        result, _ = _run(clone, payload)
        return {**result, "dry_run": True, "import_id": identity(payload)[0]}
    finally:
        clone.close()


def apply_v2(connection, payload):
    from .extended import _record_import_batch

    validate_envelope(payload)
    with transaction(connection):
        previous = receipt(connection, payload)
        if previous:
            return previous
        result, undo = _run(connection, payload)
        if not result["valid"]:
            raise ImportFailure(
                "; ".join(result["errors"]),
                "batch_failed",
                validation_errors=result["validation_errors"],
            )
        batch_id = _record_import_batch(
            connection, mode="operations", summary=result["counts"], undo_ops=undo, payload=payload
        )
        import_id, digest = identity(payload)
        result.update(
            created=result["counts"], import_public_id=batch_id, import_id=import_id, replayed=False
        )
        connection.execute(
            (
                "INSERT INTO "
                "import_receipts(import_id,payload_hash,batch_public_id,result_json)"
                " VALUES(?,?,?,?)"
            ),
            (import_id, digest, batch_id, json.dumps(result)),
        )
        for detail in result["details"]:
            if detail["status"] == "skip":
                continue
            objects = [
                detail.get(key) for key in ("after", "before", "source_after", "source_before")
            ]
            seen = set()
            for obj in objects:
                object_id = str(obj.get("public_id", obj.get("id", ""))) if obj else ""
                if object_id and object_id not in seen:
                    seen.add(object_id)
                    connection.execute(
                        (
                            "INSERT INTO "
                            "import_provenance(import_id,operation_index,entity,object_id,action,detail_json)"
                            " VALUES(?,?,?,?,?,?)"
                        ),
                        (
                            import_id,
                            detail["index"],
                            detail["entity"],
                            object_id,
                            detail["action"],
                            json.dumps(detail),
                        ),
                    )
        return result
