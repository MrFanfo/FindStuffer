"""Explicit planning and structured-metadata operations for the MCP server."""

from __future__ import annotations

import asyncio
import sqlite3
from decimal import Decimal
from typing import Any

from .custom_fields import category_fields, serialize_field
from .db import transaction
from .extended import (
    create_loan,
    remove_reservation,
    reserve_item,
    return_loan,
)
from .extension_schemas import ENTITY_MODELS
from .extensions import entity_snapshot, item_extensions, save_entity
from .projects import acquired_to_inventory, inventory_candidates
from .schemas import ItemCreate, LoanCreate

JsonObject = dict[str, Any]
PLANNING_ENTITIES = {
    "project",
    "project_requirement",
    "category_field",
    "compatibility_target",
}


def save_planning_entity(
    connection: sqlite3.Connection, entity: str, args: JsonObject
) -> JsonObject:
    if entity not in PLANNING_ENTITIES:
        raise ValueError("Unsupported planning entity")
    changes = args["values"]
    if not isinstance(changes, dict):
        raise ValueError("values must be an object")
    model = ENTITY_MODELS[entity]
    unknown = set(changes) - set(model.model_fields)
    if unknown:
        raise ValueError(f"Unsupported {entity} fields: {', '.join(sorted(unknown))}")
    public_id = args.get("public_id")
    before = (
        entity_snapshot(connection, entity, {"public_id": str(public_id)}) if public_id else None
    )
    values = {key: before[key] for key in model.model_fields} if before else {}
    if entity == "project" and not before:
        values["status"] = "active"
    values.update(changes)
    with transaction(connection):
        return save_entity(connection, entity, values, str(public_id) if public_id else None)


def list_fields(connection: sqlite3.Connection, category_id: int | None) -> list[JsonObject]:
    if category_id is not None:
        return category_fields(connection, category_id, include_inactive=True)
    return [
        serialize_field(connection, row)
        for row in connection.execute("SELECT * FROM category_fields ORDER BY sort_order,id")
    ]


def get_target_detail(
    connection: sqlite3.Connection, public_id: str, offset: int = 0
) -> JsonObject:
    from .extension_routes import target_detail

    if offset < 0:
        raise ValueError("offset must be nonnegative")
    return asyncio.run(target_detail(public_id, connection, offset))


def get_item_extensions(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    return item_extensions(connection, public_id)


def get_project_candidates(
    connection: sqlite3.Connection, public_id: str, args: JsonObject
) -> JsonObject:
    offset = int(args.get("offset") or 0)
    if offset < 0:
        raise ValueError("offset must be nonnegative")
    return inventory_candidates(
        connection,
        public_id,
        args.get("requirement_public_id") or None,
        str(args.get("query") or ""),
        offset,
    )


def get_item_contents(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    from .extension_routes import item_contents

    return asyncio.run(item_contents(public_id, connection))


def project_action(connection: sqlite3.Connection, public_id: str, args: JsonObject) -> JsonObject:
    from .extension_routes import ProjectAction
    from .project_workflows import project_action as run_action

    payload = ProjectAction.model_validate(args["values"]).model_dump(mode="json")
    payload["outputs"] = [
        ItemCreate.model_validate(value).model_dump(mode="json") for value in payload["outputs"]
    ]
    return run_action(connection, public_id, payload)


def stock_acquisition(
    connection: sqlite3.Connection, requirement_public_id: str, args: JsonObject
) -> JsonObject:
    from .extension_routes import AcquiredStock

    payload = AcquiredStock.model_validate(args["values"]).model_dump(mode="json")
    return acquired_to_inventory(connection, requirement_public_id, payload)


def create_reservation(
    connection: sqlite3.Connection, project_public_id: str, args: JsonObject
) -> JsonObject:
    reserve_item(
        connection,
        project_public_id,
        str(args["item_public_id"]),
        Decimal(str(args["quantity"])),
    )
    return {"reserved": True}


def delete_reservation(
    connection: sqlite3.Connection, project_public_id: str, item_public_id: str
) -> JsonObject:
    remove_reservation(connection, project_public_id, item_public_id)
    return {"deleted": True}


def create_loan_entry(connection: sqlite3.Connection, args: JsonObject) -> JsonObject:
    values = LoanCreate.model_validate(args["values"])
    return create_loan(
        connection,
        values.item_public_id,
        values.direction,
        values.person,
        values.quantity,
        values.due_date,
        values.notes,
    )


def return_loan_entry(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    return_loan(connection, public_id)
    return {"returned": True}
