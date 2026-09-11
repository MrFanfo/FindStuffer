"""Project requirements separate planned, purchased, acquired and allocated stock."""

from __future__ import annotations

import json
from decimal import Decimal

from .compatibility import effective_compatibility, set_target_links, target_links
from .extension_schemas import Project, ProjectRequirement
from .inventory import (
    ConflictError,
    NotFoundError,
    from_milli,
    get_item_row,
    new_public_id,
    to_milli,
)


def resolve_project(connection, reference):
    rows = connection.execute(
        "SELECT * FROM projects WHERE public_id=? OR name=? COLLATE NOCASE", (reference, reference)
    ).fetchall()
    if len(rows) != 1:
        raise NotFoundError(f"Project not found or ambiguous: {reference}; use public_id")
    return rows[0]


def save_project(connection, data, public_id=None):
    values = Project.model_validate(data).model_dump()
    existing = resolve_project(connection, public_id) if public_id else None
    duplicates = connection.execute(
        "SELECT public_id FROM projects WHERE name=? COLLATE NOCASE AND public_id != ?",
        (values["name"], public_id or ""),
    ).fetchall()
    if duplicates:
        raise ConflictError(f"Project name already exists: {values['name']} ({duplicates[0][0]})")
    fields = tuple(values[key] for key in ("name", "description", "status", "notes"))
    if existing:
        connection.execute(
            (
                "UPDATE projects SET "
                "name=?,description=?,status=?,notes=?,updated_at=CURRENT_TIMESTAMP"
                " WHERE id=?"
            ),
            (*fields, existing["id"]),
        )
        project_id = existing["id"]
    else:
        public_id = new_public_id("prj")
        project_id = connection.execute(
            "INSERT INTO projects(public_id,name,description,status,notes) VALUES(?,?,?,?,?)",
            (public_id, *fields),
        ).lastrowid
    connection.execute(
        "UPDATE projects SET multiplier=?,currency=?,links_json=? WHERE id=?",
        (values["multiplier"], values["currency"], json.dumps(values["links"]), project_id),
    )
    set_target_links(
        connection, "project_compatibility", "project_id", project_id, values["compatibility"]
    )
    result = project_detail(connection, public_id)
    if values["status"] == "completed" and (not existing or existing["status"] != "completed"):
        snapshot_completion(connection, result)
        result = project_detail(connection, public_id)
    return result


def snapshot_completion(connection, detail):
    from .inventory import get_item
    snapshot = {key: value for key, value in detail.items() if key != "completions"}
    snapshot["linked_inventory"] = {
        row["item"]: get_item(connection, row["item"])
        for row in detail["requirements"] if row["item"]
    }
    connection.execute(
        "INSERT INTO project_completions(public_id,project_id,snapshot_json) VALUES(?,?,?)",
        (new_public_id("cmp"), detail["id"], json.dumps(snapshot, default=str)),
    )


def other_holds(connection, item_id, project_id):
    legacy = connection.execute(
        (
            "SELECT COALESCE(sum(r.quantity_milli),0) FROM project_reservations"
            " r JOIN projects p ON p.id=r.project_id WHERE r.item_id=? AND "
            "r.project_id!=? AND p.status IN ('planned','active')"
        ),
        (item_id, project_id),
    ).fetchone()[0]
    planned = connection.execute(
        (
            "SELECT COALESCE(sum(r.allocated_milli),0) FROM "
            "project_requirements r JOIN projects p ON p.id=r.project_id WHERE "
            "r.item_id=? AND r.project_id!=? AND r.reserve=1 AND "
            "r.status!='cancelled' AND p.status IN ('planned','active')"
        ),
        (item_id, project_id),
    ).fetchone()[0]
    return legacy + planned


def requirement_detail(connection, row):
    item = connection.execute("SELECT * FROM items WHERE id=?", (row["item_id"],)).fetchone()
    project = connection.execute(
        "SELECT public_id,multiplier FROM projects WHERE id=?", (row["project_id"],)
    ).fetchone()
    references = target_links(connection, "requirement_compatibility", "requirement_id", row["id"])
    if not references:
        references = target_links(
            connection, "project_compatibility", "project_id", row["project_id"]
        )
    earlier = connection.execute(
        (
            "SELECT COALESCE(sum(allocated_milli),0) FROM project_requirements "
            "WHERE project_id=? AND item_id=? AND id<? AND status!='cancelled'"
        ),
        (row["project_id"], row["item_id"], row["id"]),
    ).fetchone()[0]
    physical = item["quantity_milli"] if item and not item["archived_at"] else 0
    available = min(
        row["allocated_milli"],
        max(0, physical - earlier - other_holds(connection, row["item_id"], row["project_id"])),
    )
    required = row["required_milli"] * project["multiplier"]
    missing = max(0, required - available - row["acquired_milli"])
    compatibility = (
        [
            {"target": reference, **effective_compatibility(connection, item["id"], reference)}
            for reference in references
        ]
        if item
        else []
    )
    warnings = []
    if not item:
        warnings.append("Planned requirement: not linked to inventory")
    if row["allocated_milli"] and not row["reserve"]:
        warnings.append("Allocated stock is not reserved and may be planned by another project")
    if available < row["allocated_milli"]:
        warnings.append("Linked stock is no longer sufficient for the planned allocation")
    if any(entry["status"] != "compatible" for entry in compatibility):
        warnings.append("Check compatibility: one or more requirements are unknown or conditional")
    photo = connection.execute(
        "SELECT public_id FROM photos WHERE item_id=? ORDER BY sort_order,id LIMIT 1",
        (row["item_id"],),
    ).fetchone()
    return {
        "public_id": row["public_id"],
        "project": project[0],
        "name": row["name"],
        "category": row["category_id"],
        "item": item["public_id"] if item else None,
        "item_name": item["name"] if item else None,
        "unit": row["unit"],
        "required_quantity": from_milli(row["required_milli"]),
        "scaled_required_quantity": from_milli(required),
        "optional": bool(row["optional"]),
        "estimated_unit_cost_minor": row["estimated_unit_cost_minor"],
        "actual_spent_minor": row["actual_spent_minor"],
        "item_photo_url": f"/api/v1/photos/{photo[0]}/content" if photo else None,
        "inventory_quantity": from_milli(row["allocated_milli"]),
        "inventory_quantity_available": from_milli(available),
        "purchased_quantity": from_milli(row["purchased_milli"]),
        "acquired_quantity": from_milli(row["acquired_milli"]),
        "missing_quantity": from_milli(missing),
        "to_buy_quantity": from_milli(max(0, missing - row["purchased_milli"])),
        "reserve": bool(row["reserve"]),
        "notes": row["notes"],
        "status": row["status"],
        "satisfied": missing == 0,
        "version": row["version"],
        "compatibility": target_links(
            connection, "requirement_compatibility", "requirement_id", row["id"]
        ),
        "compatibility_results": compatibility,
        "warnings": warnings,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def resolve_requirement(connection, reference, project=None):
    conditions, params = ["(public_id=? OR name=? COLLATE NOCASE)"], [reference, reference]
    if project:
        conditions.append("project_id=?")
        params.append(resolve_project(connection, project)["id"])
    rows = connection.execute(
        "SELECT * FROM project_requirements WHERE " + " AND ".join(conditions), params
    ).fetchall()
    if len(rows) != 1:
        raise NotFoundError(
            f"Project requirement not found or ambiguous: {reference}; use public_id"
        )
    return rows[0]


def save_requirement(connection, data, public_id=None):
    from .extended import _item_public_id_from_match, _resolve_category_id

    values = ProjectRequirement.model_validate(data).model_dump()
    project = resolve_project(connection, values["project"])
    existing = resolve_requirement(connection, public_id) if public_id else None
    category_id = _resolve_category_id(connection, values["category"])
    item = None
    if values["item"]:
        reference = values["item"]
        match = (
            reference
            if isinstance(reference, dict)
            else ({"public_id": reference} if reference.startswith("itm_") else {"name": reference})
        )
        if "name" in match and category_id is not None:
            match["category"] = category_id
        item = get_item_row(connection, _item_public_id_from_match(connection, match))
        if item["archived_at"]:
            raise ValueError("Cannot allocate archived inventory")
        if values["unit"] != item["unit"]:
            raise ValueError("Requirement and linked inventory unit must match")
    allocation = to_milli(values["inventory_quantity"])
    if allocation and item is None:
        raise ValueError("inventory_quantity requires a linked item")
    if item and values["status"] != "cancelled":
        other = connection.execute(
            (
                "SELECT COALESCE(sum(allocated_milli),0) FROM project_requirements "
                "WHERE item_id=? AND project_id=? AND public_id!=? AND "
                "status!='cancelled'"
            ),
            (item["id"], project["id"], public_id or ""),
        ).fetchone()[0]
        free = max(
            0, item["quantity_milli"] - other - other_holds(connection, item["id"], project["id"])
        )
        if allocation > free:
            raise ConflictError(
                f"Allocation exceeds available stock ({from_milli(free)} {item['unit']})"
            )
        legacy = connection.execute(
            "SELECT quantity_milli FROM project_reservations WHERE project_id=? AND item_id=?",
            (project["id"], item["id"]),
        ).fetchone()
        if values["reserve"] and legacy:
            raise ConflictError(
                "Remove the old project reservation before reserving through a requirement"
            )
    duplicate = connection.execute(
        (
            "SELECT public_id FROM project_requirements WHERE project_id=? AND "
            "name=? COLLATE NOCASE AND category_id IS ? AND public_id!=?"
        ),
        (project["id"], values["name"], category_id, public_id or ""),
    ).fetchone()
    if duplicate:
        raise ConflictError(
            f"Requirement already exists in this project/category: {duplicate[0]}; modify it"
        )
    fields = (
        project["id"],
        values["name"],
        category_id,
        item["id"] if item else None,
        to_milli(values["required_quantity"]),
        allocation,
        to_milli(values["purchased_quantity"]),
        to_milli(values["acquired_quantity"]),
        values["unit"],
        values["reserve"],
        values["notes"],
        values["status"],
    )
    if existing:
        connection.execute(
            (
                "UPDATE project_requirements SET project_id=?,name=?,category_id=?,"
                "item_id=?,required_milli=?,allocated_milli=?,purchased_milli=?,acq"
                "uired_milli=?,unit=?,reserve=?,notes=?,status=?,version=version+1,"
                "updated_at=CURRENT_TIMESTAMP WHERE id=?"
            ),
            (*fields, existing["id"]),
        )
        requirement_id = existing["id"]
    else:
        public_id = new_public_id("req")
        requirement_id = connection.execute(
            (
                "INSERT INTO project_requirements(public_id,project_id,name,categor"
                "y_id,item_id,required_milli,allocated_milli,purchased_milli,acquir"
                "ed_milli,unit,reserve,notes,status) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"
            ),
            (public_id, *fields),
        ).lastrowid
    connection.execute(
        (
            "UPDATE project_requirements SET "
            "optional=?,estimated_unit_cost_minor=?,actual_spent_minor=? WHERE "
            "id=?"
        ),
        (
            values["optional"],
            values["estimated_unit_cost_minor"],
            values["actual_spent_minor"],
            requirement_id,
        ),
    )
    set_target_links(
        connection,
        "requirement_compatibility",
        "requirement_id",
        requirement_id,
        values["compatibility"],
    )
    result = requirement_detail(connection, resolve_requirement(connection, public_id))
    if values["status"] == "satisfied" and not result["satisfied"]:
        raise ValueError("A satisfied requirement must have no missing quantity")
    return result


def project_detail(connection, public_id):
    project = resolve_project(connection, public_id)
    requirements = [
        requirement_detail(connection, row)
        for row in connection.execute(
            "SELECT * FROM project_requirements WHERE project_id=? ORDER BY id", (project["id"],)
        )
    ]
    active = [row for row in requirements if row["status"] != "cancelled" and not row["optional"]]
    totals = {}
    for row in active:
        total = totals.setdefault(row["unit"], {"required": Decimal(0), "covered": Decimal(0)})
        total["required"] += Decimal(row["scaled_required_quantity"])
        total["covered"] += Decimal(row["scaled_required_quantity"]) - Decimal(
            row["missing_quantity"]
        )
    return {
        **dict(project),
        "requirements": requirements,
        "links": json.loads(project["links_json"]),
        "ready": all(row["satisfied"] for row in active),
        "budget": project_budget(requirements),
        "files": [
            dict(row)
            for row in connection.execute(
                (
                    "SELECT public_id,name,mime_type,size_bytes FROM project_files WHERE "
                    "project_id=? ORDER BY id"
                ),
                (project["id"],),
            )
        ],
        "outputs": [
            dict(row)
            for row in connection.execute(
                (
                    "SELECT item_public_id,quantity_milli FROM project_outputs WHERE "
                    "project_id=? ORDER BY id"
                ),
                (project["id"],),
            )
        ],
        "completions": [
            {
                "public_id": row["public_id"],
                "created_at": row["created_at"],
                "snapshot": json.loads(row["snapshot_json"]),
            }
            for row in connection.execute(
                "SELECT * FROM project_completions WHERE project_id=? ORDER BY id", (project["id"],)
            )
        ],
        "compatibility": target_links(
            connection, "project_compatibility", "project_id", project["id"]
        ),
        "progress": {
            "total_lines": len(active),
            "completed_lines": sum(row["satisfied"] for row in active),
            "missing_lines": sum(not row["satisfied"] for row in active),
            "percent": float(
                round(
                    sum(
                        1
                        - Decimal(row["missing_quantity"])
                        / Decimal(row["scaled_required_quantity"])
                        for row in active
                    )
                    / len(active)
                    * 100,
                    1,
                )
            )
            if active
            else 0,
            "quantities_by_unit": {
                unit: {key: str(value) for key, value in total.items()}
                for unit, total in totals.items()
            },
        },
        "warnings": [f"{row['name']}: {warning}" for row in active for warning in row["warnings"]],
    }


def inventory_candidates(connection, project_public_id, requirement_id=None, query="", offset=0):
    from .inventory import get_item

    project = resolve_project(connection, project_public_id)
    references = target_links(connection, "project_compatibility", "project_id", project["id"])
    if requirement_id:
        req = resolve_requirement(connection, requirement_id, project_public_id)
        references = (
            target_links(connection, "requirement_compatibility", "requirement_id", req["id"])
            or references
        )
    candidates = []
    for row in connection.execute(
        (
            "SELECT id,public_id,name FROM items WHERE archived_at IS NULL AND "
            "name LIKE ? ORDER BY name COLLATE NOCASE,id"
        ),
        (f"%{query}%",),
    ):
        compatibility = [
            {"target": target, **effective_compatibility(connection, row["id"], target)}
            for target in references
        ]
        rank = (
            0
            if compatibility and all(value["status"] == "compatible" for value in compatibility)
            else 2
            if any(value["status"] == "incompatible" for value in compatibility)
            else 1
        )
        candidates.append((rank, row["public_id"], compatibility))
    candidates.sort(key=lambda row: row[0])
    return {
        "total": len(candidates),
        "items": [
            {**get_item(connection, public_id), "compatibility_results": matches}
            for _, public_id, matches in candidates[offset : offset + 100]
        ],
        "next_offset": offset + 100 if offset + 100 < len(candidates) else None,
    }


def acquired_to_inventory(connection, public_id, payload):
    from .db import transaction
    from .import_protocol import identity, receipt
    from .inventory import create_item, update_item

    request_payload = {
        "import_id": payload["request_id"],
        "operations": [{"requirement": public_id, **payload}],
    }
    with transaction(connection):
        previous = receipt(connection, request_payload)
        if previous:
            return previous
        row = resolve_requirement(connection, public_id)
        if row["version"] != payload["expected_version"]:
            raise ConflictError("Requirement changed; reload before moving acquired stock")
        quantity = to_milli(payload["quantity"])
        if quantity <= 0 or quantity > row["acquired_milli"]:
            raise ValueError(
                "Quantity must be positive and no more than acquired stock outside inventory"
            )
        if row["item_id"]:
            item = connection.execute(
                "SELECT * FROM items WHERE id=?", (row["item_id"],)
            ).fetchone()
            item = update_item(
                connection,
                item["public_id"],
                {
                    "quantity": from_milli(item["quantity_milli"] + quantity),
                    "expected_version": item["version"],
                },
                source="project_acquisition",
            )
        else:
            item = create_item(
                connection,
                {
                    "name": row["name"],
                    "category_id": row["category_id"],
                    "unit": row["unit"],
                    "quantity": from_milli(quantity),
                    "location_public_id": payload.get("location", "unassigned"),
                    "custom_fields": payload.get("custom_fields", {}),
                },
                source="project_acquisition",
            )
        current = requirement_detail(connection, row)
        values = {key: current[key] for key in ProjectRequirement.model_fields}
        values.update(
            item=item["public_id"],
            inventory_quantity=from_milli(row["allocated_milli"] + quantity),
            acquired_quantity=from_milli(row["acquired_milli"] - quantity),
        )
        result = {"requirement": save_requirement(connection, values, public_id), "item": item}
        import_id, digest = identity(request_payload)
        connection.execute(
            "INSERT INTO import_receipts(import_id,payload_hash,result_json) VALUES(?,?,?)",
            (import_id, digest, json.dumps(result, default=str)),
        )
        return result


def project_budget(requirements):
    active = [row for row in requirements if row["status"] != "cancelled"]

    def cost(row, field):
        return int(
            (Decimal(row[field]) * (row["estimated_unit_cost_minor"] or 0)).quantize(Decimal("1"))
        )

    return {
        "estimated_total_minor": sum(cost(row, "scaled_required_quantity") for row in active),
        "actual_spent_minor": sum(row["actual_spent_minor"] for row in active),
        "ordered_value_minor": sum(cost(row, "purchased_quantity") for row in active),
        "remaining_estimated_minor": sum(cost(row, "to_buy_quantity") for row in active),
        "unpriced_lines": sum(row["estimated_unit_cost_minor"] is None for row in active),
    }
