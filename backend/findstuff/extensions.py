"""Shared entity dispatch, snapshots and item metadata for API and imports."""

from __future__ import annotations

from .compatibility import item_compatibility, resolve_target, save_target, serialize_target
from .custom_fields import category_fields, item_values, save_field, serialize_field
from .extension_schemas import ENTITY_MODELS, ENTITY_TABLES
from .inventory import NotFoundError, get_item_row
from .projects import (
    project_detail,
    requirement_detail,
    resolve_project,
    resolve_requirement,
    save_project,
    save_requirement,
)

MATCH_KEYS = {
    "category_field": ("public_id", "category", "key"),
    "compatibility_target": ("public_id", "name"),
    "project": ("public_id", "name"),
    "project_requirement": ("public_id", "name", "project"),
}


def entity_snapshot(connection, entity, match):
    if not isinstance(match, dict) or not match or set(match) - set(MATCH_KEYS[entity]):
        raise ValueError(f"Invalid {entity} match; allowed: {', '.join(MATCH_KEYS[entity])}")
    reference = match.get("public_id") or match.get("name")
    if entity == "project":
        return project_detail(connection, resolve_project(connection, reference)["public_id"])
    if entity == "project_requirement":
        return requirement_detail(
            connection, resolve_requirement(connection, reference, match.get("project"))
        )
    if entity == "compatibility_target":
        return serialize_target(connection, resolve_target(connection, reference))
    if match.get("public_id"):
        row = connection.execute(
            "SELECT * FROM category_fields WHERE public_id=?", (match["public_id"],)
        ).fetchone()
    else:
        from .extended import _resolve_category_id

        category = _resolve_category_id(connection, match.get("category"))
        row = connection.execute(
            "SELECT * FROM category_fields WHERE category_id=? AND key=? COLLATE NOCASE",
            (category, match.get("key")),
        ).fetchone()
    if row is None:
        raise NotFoundError("Category field not found; use its public_id or source category + key")
    return serialize_field(connection, row)


def save_entity(connection, entity, values, public_id=None):
    return {
        "project": save_project,
        "project_requirement": save_requirement,
        "category_field": save_field,
        "compatibility_target": save_target,
    }[entity](connection, values, public_id)


def apply_entity(connection, operation, index, undo):
    entity, op = operation["type"], operation["op"]
    if op not in ("add", "modify", "delete"):
        raise ValueError(f"{entity} supports add, modify and delete only")
    data, match = operation.get("data", {}), operation.get("match", {})
    model = ENTITY_MODELS[entity]
    if not isinstance(data, dict):
        raise ValueError("Operation data must be an object")
    unsupported = sorted(set(data) - set(model.model_fields))
    if unsupported:
        from .import_protocol import ImportFailure

        raise ImportFailure(
            f"Unsupported {entity} fields: {unsupported}",
            "unsupported_field",
            f"data.{unsupported[0]}",
        )
    if op == "add" and match or op == "delete" and data:
        raise ValueError("Add accepts data only; delete accepts match only")
    before = entity_snapshot(connection, entity, match) if op != "add" else None
    values = {key: before[key] for key in model.model_fields} if before else {}
    values.update(data)
    if op == "delete":
        values["status" if entity in ("project", "project_requirement") else "active"] = (
            "archived"
            if entity == "project"
            else "cancelled"
            if entity == "project_requirement"
            else False
        )
    result = save_entity(connection, entity, values, before["public_id"] if before else None)
    undo.append(
        {
            "entity": entity,
            "action": "update" if before else "erase",
            "public_id": result["public_id"],
            "data": before,
        }
    )
    warnings = []
    if entity == "category_field" and before:
        warnings.append(
            f"Definition affects {before['affected_items']} stored item values; "
            "deactivation retains them."
        )
    if entity == "project_requirement":
        warnings.extend(result["warnings"])
    return {
        "index": index,
        "operation_index": index,
        "entity": entity,
        "action": op,
        "status": op,
        "validation_status": "warning" if warnings else "valid",
        "label": f"Operation #{index}: {op} {entity}",
        "message": f"Will {op} {entity}: {result.get('name', result.get('label', ''))}",
        "before": before,
        "after": result,
        "warnings": warnings,
    }


def undo_entity(connection, operation):
    entity = operation["entity"]
    if operation["action"] == "erase":
        connection.execute(
            f"DELETE FROM {ENTITY_TABLES[entity]} WHERE public_id=?", (operation["public_id"],)
        )
    else:
        values = {key: operation["data"][key] for key in ENTITY_MODELS[entity].model_fields}
        save_entity(connection, entity, values, operation["public_id"])


def item_extensions(connection, public_id):
    row = get_item_row(connection, public_id)
    definitions = category_fields(connection, row["category_id"], include_inactive=True)
    applicable = {field["value_field_id"] for field in definitions}
    stored = item_values(connection, row["id"])
    for field_id in set(stored) - applicable:
        field = connection.execute(
            "SELECT * FROM category_fields WHERE public_id=?", (field_id,)
        ).fetchone()
        if field:
            definitions.append({**serialize_field(connection, field), "retained": True})
    from .compatibility import represented_targets

    return {
        "compatibility_targets": represented_targets(connection, row["id"]),
        "custom_fields": stored,
        "field_definitions": definitions,
        "compatibility": item_compatibility(connection, row["id"]),
        "projects": [
            dict(entry)
            for entry in connection.execute(
                "SELECT p.public_id,p.name,p.status,r.public_id AS requirement_public_id, "
                "r.name AS requirement_name FROM project_requirements r JOIN projects p "
                "ON p.id=r.project_id WHERE r.item_id=? ORDER BY p.name,r.name",
                (row["id"],),
            )
        ],
    }
