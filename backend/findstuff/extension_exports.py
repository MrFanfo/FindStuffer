"""Portable merge of structured metadata and project relations with stable ID remapping."""

from __future__ import annotations

import json

from .compatibility import resolve_target, save_target, set_item_compatibility
from .custom_fields import (
    category_fields,
    item_values,
    restore_item_values,
    save_field,
    serialize_field,
    validate_value,
)
from .extension_schemas import ProjectRequirement
from .inventory import NotFoundError, from_milli
from .projects import resolve_project, save_project, save_requirement

TABLES = (
    "category_fields",
    "item_field_values",
    "compatibility_targets",
    "compatibility_names",
    "item_compatibility",
    "project_compatibility",
    "project_requirements",
    "requirement_compatibility",
    "projects",
    "project_reservations",
)


def merge_extensions(connection, tables, categories, items, undo):
    from .extended import _item_snapshot

    target_ids, field_ids, project_ids = {}, {}, {}
    pending = list(tables.get("compatibility_targets", []))
    while pending:
        progress = False
        for row in pending[:]:
            if row.get("parent_id") is not None and row["parent_id"] not in target_ids:
                continue
            try:
                existing = resolve_target(connection, row["public_id"])
            except NotFoundError:
                try:
                    existing = resolve_target(connection, row["name"])
                except NotFoundError:
                    existing = None
            if existing:
                target_ids[row["id"]] = existing["id"]
            else:
                parent_id = target_ids.get(row.get("parent_id"))
                parent = connection.execute(
                    "SELECT public_id FROM compatibility_targets WHERE id=?", (parent_id,)
                ).fetchone()
                values = {
                    key: row.get(key, "") for key in ("name", "manufacturer", "model", "type")
                }
                values.update(
                    parent=parent[0] if parent else None,
                    active=bool(row.get("active", 1)),
                    aliases=[
                        entry["name"]
                        for entry in tables.get("compatibility_names", [])
                        if entry["target_id"] == row["id"] and not entry["canonical"]
                    ],
                )
                result = save_target(connection, values)
                connection.execute(
                    "UPDATE compatibility_targets SET public_id=? WHERE public_id=?",
                    (row["public_id"], result["public_id"]),
                )
                target_ids[row["id"]] = resolve_target(connection, row["public_id"])["id"]
                undo.append(
                    {
                        "entity": "compatibility_target",
                        "action": "erase",
                        "public_id": row["public_id"],
                    }
                )
            pending.remove(row)
            progress = True
        if not progress:
            raise ValueError("Compatibility export has missing parents or a cycle")
    pending = list(tables.get("category_fields", []))
    while pending:
        progress = False
        for row in pending[:]:
            if row.get("overrides_id") is not None and row["overrides_id"] not in field_ids:
                continue
            if row["category_id"] not in categories:
                raise ValueError("Custom field references a missing exported category")
            existing = connection.execute(
                "SELECT id FROM category_fields WHERE public_id=? OR (category_id=? AND key=?)",
                (row["public_id"], categories[row["category_id"]], row["key"]),
            ).fetchone()
            if existing:
                field_ids[row["id"]] = existing[0]
            else:
                base = connection.execute(
                    "SELECT public_id FROM category_fields WHERE id=?",
                    (field_ids.get(row.get("overrides_id")),),
                ).fetchone()
                values = {
                    key: row[key]
                    for key in ("key", "label", "description", "type", "unit", "sort_order")
                }
                values.update(
                    category=categories[row["category_id"]],
                    overrides=base[0] if base else None,
                    **{key: bool(row[key]) for key in ("required", "nullable", "active")},
                    default=json.loads(row["default_json"]) if row.get("default_json") else None,
                    allowed_values=json.loads(row["allowed_values_json"]),
                    constraints=json.loads(row["constraints_json"]),
                )
                created = save_field(connection, values)
                connection.execute(
                    "UPDATE category_fields SET public_id=? WHERE public_id=?",
                    (row["public_id"], created["public_id"]),
                )
                field_ids[row["id"]] = connection.execute(
                    "SELECT id FROM category_fields WHERE public_id=?", (row["public_id"],)
                ).fetchone()[0]
                undo.append(
                    {"entity": "category_field", "action": "erase", "public_id": row["public_id"]}
                )
            pending.remove(row)
            progress = True
        if not progress:
            raise ValueError("Field export has missing override definitions or a cycle")
    # Preserve local metadata; only fill relationships/values not already present.
    touched = set()
    for row in tables.get("item_field_values", []):
        if row["item_id"] not in items or row["field_id"] not in field_ids:
            raise ValueError("Custom value references a missing item or field")
        item_id, field_id = items[row["item_id"]], field_ids[row["field_id"]]
        if connection.execute(
            "SELECT 1 FROM item_field_values WHERE item_id=? AND field_id=?", (item_id, field_id)
        ).fetchone():
            continue
        _remember_item(connection, item_id, touched, undo, _item_snapshot)
        field = connection.execute(
            "SELECT * FROM category_fields WHERE id=?", (field_id,)
        ).fetchone()
        category_id = connection.execute(
            "SELECT category_id FROM items WHERE id=?", (item_id,)
        ).fetchone()[0]
        effective = next(
            (
                entry
                for entry in category_fields(connection, category_id)
                if entry["value_field_id"] == field["public_id"]
            ),
            serialize_field(connection, field),
        )
        value = validate_value(effective, json.loads(row["value_json"]))
        values = item_values(connection, item_id)
        values[field["public_id"]] = value
        restore_item_values(connection, item_id, values)
    for row in tables.get("item_compatibility", []):
        if row["item_id"] not in items or row["target_id"] not in target_ids:
            raise ValueError("Compatibility relation references a missing item or target")
        item_id, target_id = items[row["item_id"]], target_ids[row["target_id"]]
        if connection.execute(
            "SELECT 1 FROM item_compatibility WHERE item_id=? AND target_id=?", (item_id, target_id)
        ).fetchone():
            continue
        _remember_item(connection, item_id, touched, undo, _item_snapshot)
        from .compatibility import item_compatibility

        current = [
            {key: relation[key] for key in ("target", "status", "notes", "source_url", "adapter")}
            for relation in item_compatibility(connection, item_id)
        ]
        target = connection.execute(
            "SELECT public_id FROM compatibility_targets WHERE id=?", (target_id,)
        ).fetchone()[0]
        current.append(
            {
                "target": target,
                **{key: row[key] for key in ("status", "notes", "source_url", "adapter")},
            }
        )
        set_item_compatibility(connection, item_id, current, allow_inactive=True)
        if row.get("public_id"):
            connection.execute(
                "UPDATE item_compatibility SET public_id=? WHERE item_id=? AND target_id=?",
                (row["public_id"], item_id, target_id),
            )
    for row in tables.get("projects", []):
        try:
            existing = resolve_project(connection, row["public_id"])
        except NotFoundError:
            existing = None
        if existing:
            project_ids[row["id"]] = existing["id"]
            _merge_export_links(
                connection,
                "project",
                existing["public_id"],
                _export_target_refs(
                    connection,
                    tables.get("project_compatibility", []),
                    "project_id",
                    row["id"],
                    target_ids,
                ),
                undo,
            )
            continue
        compatibility = _export_target_refs(
            connection, tables.get("project_compatibility", []), "project_id", row["id"], target_ids
        )
        created = save_project(
            connection,
            {
                "name": row["name"],
                "description": row.get("description", ""),
                "notes": row.get("notes", ""),
                "status": row["status"],
                "compatibility": compatibility,
            },
        )
        connection.execute(
            "UPDATE projects SET public_id=? WHERE public_id=?",
            (row["public_id"], created["public_id"]),
        )
        project_ids[row["id"]] = resolve_project(connection, row["public_id"])["id"]
        undo.append({"entity": "project", "action": "erase", "public_id": row["public_id"]})
    for row in tables.get("project_requirements", []):
        if connection.execute(
            "SELECT 1 FROM project_requirements WHERE public_id=?", (row["public_id"],)
        ).fetchone():
            _merge_export_links(
                connection,
                "project_requirement",
                row["public_id"],
                _export_target_refs(
                    connection,
                    tables.get("requirement_compatibility", []),
                    "requirement_id",
                    row["id"],
                    target_ids,
                ),
                undo,
            )
            continue
        project = connection.execute(
            "SELECT public_id FROM projects WHERE id=?", (project_ids.get(row["project_id"]),)
        ).fetchone()
        if project is None:
            raise ValueError("Requirement references a missing project")
        item = connection.execute(
            "SELECT public_id FROM items WHERE id=?", (items.get(row.get("item_id")),)
        ).fetchone()
        if row.get("item_id") is not None and item is None:
            raise ValueError("Requirement references a missing item")
        if row.get("category_id") is not None and row["category_id"] not in categories:
            raise ValueError("Requirement references a missing exported category")
        values = {key: row[key] for key in ("name", "unit", "notes", "status")}
        values.update(
            project=project[0],
            item=item[0] if item else None,
            category=categories.get(row.get("category_id")),
            reserve=bool(row["reserve"]),
            compatibility=_export_target_refs(
                connection,
                tables.get("requirement_compatibility", []),
                "requirement_id",
                row["id"],
                target_ids,
            ),
        )
        for field, column in (
            ("required_quantity", "required_milli"),
            ("inventory_quantity", "allocated_milli"),
            ("purchased_quantity", "purchased_milli"),
            ("acquired_quantity", "acquired_milli"),
        ):
            values[field] = from_milli(row[column])
        created = save_requirement(
            connection, ProjectRequirement.model_validate(values).model_dump()
        )
        connection.execute(
            "UPDATE project_requirements SET public_id=? WHERE public_id=?",
            (row["public_id"], created["public_id"]),
        )
        undo.append(
            {"entity": "project_requirement", "action": "erase", "public_id": row["public_id"]}
        )

    for row in tables.get("project_reservations", []):
        project_id, item_id = project_ids.get(row["project_id"]), items.get(row["item_id"])
        if project_id is None or item_id is None:
            raise ValueError("Reservation references a missing exported item or project")
        if connection.execute(
            "SELECT 1 FROM project_reservations WHERE project_id=? AND item_id=?",
            (project_id, item_id),
        ).fetchone():
            continue
        if not isinstance(row["quantity_milli"], int) or row["quantity_milli"] <= 0:
            raise ValueError(
                "Exported reservation quantity must be a positive integer in milli-units"
            )
        # Preserve historical reservations even when physical stock has subsequently changed.
        connection.execute(
            "INSERT INTO project_reservations(project_id,item_id,quantity_milli) VALUES(?,?,?)",
            (project_id, item_id, row["quantity_milli"]),
        )
        undo.append(
            {
                "entity": "project_reservation",
                "action": "delete",
                "project_id": project_id,
                "item_id": item_id,
            }
        )


def _export_target_refs(connection, rows, owner, owner_id, mapping):
    references = []
    for row in rows:
        if row[owner] != owner_id:
            continue
        target = connection.execute(
            "SELECT public_id FROM compatibility_targets WHERE id=?",
            (mapping.get(row["target_id"]),),
        ).fetchone()
        if target is None:
            raise ValueError("Missing compatibility target in export")
        references.append(target[0])
    return references


def _remember_item(connection, item_id, touched, undo, snapshot):
    if item_id in touched:
        return
    public_id = connection.execute("SELECT public_id FROM items WHERE id=?", (item_id,)).fetchone()[
        0
    ]
    undo.append(
        {
            "entity": "item",
            "action": "update",
            "public_id": public_id,
            "data": snapshot(connection, public_id),
        }
    )
    touched.add(item_id)


def _merge_export_links(connection, entity, public_id, incoming, undo):
    from .compatibility import set_target_links
    from .extensions import entity_snapshot

    before = entity_snapshot(connection, entity, {"public_id": public_id})
    combined = list(dict.fromkeys([*before["compatibility"], *incoming]))
    if combined == before["compatibility"]:
        return
    undo.append({"entity": entity, "action": "update", "public_id": public_id, "data": before})
    table, owner = (
        ("project_compatibility", "project_id")
        if entity == "project"
        else ("requirement_compatibility", "requirement_id")
    )
    source = "projects" if entity == "project" else "project_requirements"
    owner_id = connection.execute(
        f"SELECT id FROM {source} WHERE public_id=?", (public_id,)
    ).fetchone()[0]
    set_target_links(connection, table, owner, owner_id, combined)
