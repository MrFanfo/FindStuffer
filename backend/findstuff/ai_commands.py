from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from .ai_usage import record_ai_usage
from .db import transaction
from .extended import apply_import_merge, import_preview
from .inventory import (
    ConflictError,
    NotFoundError,
    adjust_quantity,
    create_item,
    find_category_id,
    list_categories,
    list_items,
    list_location_tree,
    move_item,
    new_public_id,
    update_item,
)
from .service_config import get_ai_config


class AIModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AddAction(AIModel):
    type: Literal["add_item"]
    name: str
    quantity: Decimal = Decimal("1")
    unit: str = "pcs"
    location: str = "Unassigned"
    description: str = ""
    notes: str = ""
    category: str | None = None
    brand: str = ""
    model: str = ""
    serial_number: str = ""
    purchase_price_minor: int | None = None
    purchase_currency: str | None = None
    expiration_date: str | None = None
    low_stock_threshold: Decimal | None = None


class AdjustAction(AIModel):
    type: Literal["adjust_quantity"]
    item: str
    delta: Decimal


class MoveAction(AIModel):
    type: Literal["move_item"]
    item: str
    destination: str


class UpdateAction(AIModel):
    type: Literal["update_item"]
    item: str
    name: str | None = None
    description: str | None = None
    notes: str | None = None
    brand: str | None = None
    model: str | None = None
    serial_number: str | None = None
    expiration_date: str | None = None
    low_stock_threshold: Decimal | None = None


class SearchAction(AIModel):
    type: Literal["search_items"]
    query: str


Action = Annotated[
    AddAction | AdjustAction | MoveAction | UpdateAction | SearchAction,
    Field(discriminator="type"),
]


class Proposal(AIModel):
    schema_version: Literal["1"] = "1"
    summary: str
    action: Action
    warnings: list[str] = []


proposal_adapter = TypeAdapter(Proposal)


class OperationsProposal(AIModel):
    schema_version: Literal["1"] = "1"
    summary: str
    operations: list[dict[str, Any]] = Field(min_length=1, max_length=100)
    warnings: list[str] = []


operations_proposal_adapter = TypeAdapter(OperationsProposal)


def compact_context(connection: sqlite3.Connection) -> dict[str, Any]:
    def flatten(nodes: list[dict[str, Any]]) -> list[str]:
        return [node["path"] for node in nodes for _ in [0]] + [
            path for node in nodes for path in flatten(node["children"])
        ]

    return {
        "l": flatten(list_location_tree(connection))[:150],
        "i": [
            [item["name"], item["location_path"], item["quantity"], item["unit"]]
            for item in list_items(connection, limit=100)
        ],
        "u": ["pcs", "g", "kg", "ml", "l", "m", "box", "pack"],
    }


async def call_parser(connection: sqlite3.Connection, text: str) -> Proposal:
    settings = get_ai_config(connection)
    if not settings.enabled or not settings.endpoint or not settings.model:
        raise RuntimeError(
            "AI parser is not configured. Configure it in Settings > Integrations."
        )
    schema = proposal_adapter.json_schema()
    prompt = (
        "Convert the user's inventory instruction into exactly one JSON action. "
        "Never invent identifiers. Use the supplied names and paths. Prices are integer minor "
        "currency units. A removal is a negative adjust_quantity delta. Context keys: "
        "l=location paths, i=[name,location,quantity,unit], u=units. Output only JSON; "
        "no reasoning or Markdown.\n"
        f"Schema:{json.dumps(schema, separators=(',', ':'))}\n"
        f"Context:{json.dumps(compact_context(connection), separators=(',', ':'))}\n"
        f"User instruction: {text}"
    )
    headers = {"Content-Type": "application/json"}
    if settings.api_key:
        headers["Authorization"] = f"Bearer {settings.api_key}"
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(30.0), headers=headers, trust_env=False
    ) as client:
        try:
            response = await client.post(
                settings.endpoint,
                json={
                    "model": settings.model,
                    "messages": [
                        {
                            "role": "system",
                            "content": "Strict inventory JSON parser. No reasoning.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    "response_format": {"type": "json_object"},
                },
            )
            response.raise_for_status()
            body = response.json()
        except Exception:
            record_ai_usage(
                connection,
                feature="command",
                model=settings.model,
                success=False,
                prompt_text=prompt,
            )
            raise
    try:
        content = body["choices"][0]["message"]["content"]
        proposal = proposal_adapter.validate_json(content)
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        record_ai_usage(
            connection,
            feature="command",
            model=settings.model,
            success=False,
            response_body=body,
            prompt_text=prompt,
        )
        raise RuntimeError("AI provider returned an invalid structured response") from exc
    record_ai_usage(
        connection,
        feature="command",
        model=settings.model,
        success=True,
        response_body=body,
        prompt_text=prompt,
        output_text=content,
    )
    return proposal


def operations_context(connection: sqlite3.Connection) -> dict[str, Any]:
    locations: list[dict[str, str]] = []

    def collect(nodes: list[dict[str, Any]]) -> None:
        for node in nodes:
            locations.append(
                {
                    "public_id": str(node["public_id"]),
                    "path": str(node["path"]),
                    "kind": str(node["kind"]),
                }
            )
            collect(node["children"])

    collect(list_location_tree(connection))
    items = list_items(connection, limit=300, include_zero=True)
    units = sorted(
        {
            str(item["unit"])
            for item in items
            if str(item.get("unit") or "").strip()
        }
        | {"pcs", "box", "pack", "bag", "g", "kg", "ml", "l"}
    )
    return {
        "locations": locations[:300],
        "categories": [
            {"id": category["id"], "path": category["path"]}
            for category in list_categories(connection)[:300]
        ],
        "items": [
            {
                "public_id": item["public_id"],
                "name": item["name"],
                "barcode": item["barcode"],
                "category": item["category_path"],
                "location": item["location_path"],
                "quantity": item["quantity"],
                "unit": item["unit"],
            }
            for item in items
        ],
        "units": units,
    }


async def call_operations_parser(
    connection: sqlite3.Connection, text: str
) -> OperationsProposal:
    settings = get_ai_config(connection)
    if not settings.enabled or not settings.endpoint or not settings.model:
        raise RuntimeError(
            "AI parser is not configured. Configure it in Settings > Integrations."
        )
    schema = operations_proposal_adapter.json_schema()
    prompt = (
        "Convert the user's request into an ordered Findstuff operations plan. "
        "It may contain multiple add, modify, or delete operations for item, category, "
        "and location records. Use only the supplied IDs, exact item names, and full paths. "
        "Prefer public_id/id matches when present. For stock changes use add_quantity or "
        "remove_quantity, not an absolute quantity. Put parent structure operations before "
        "operations that refer to them. Never guess an ambiguous existing record. "
        "Return only JSON matching the schema; no reasoning or Markdown.\n"
        f"Schema:{json.dumps(schema, separators=(',', ':'))}\n"
        f"Context:{json.dumps(operations_context(connection), separators=(',', ':'))}\n"
        f"User request:{text}"
    )
    headers = {"Content-Type": "application/json"}
    if settings.api_key:
        headers["Authorization"] = f"Bearer {settings.api_key}"
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(45.0), headers=headers, trust_env=False
    ) as client:
        try:
            response = await client.post(
                settings.endpoint,
                json={
                    "model": settings.model,
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                "You are a strict inventory operations planner. "
                                "Return valid JSON only."
                            ),
                        },
                        {"role": "user", "content": prompt},
                    ],
                    "response_format": {"type": "json_object"},
                },
            )
            response.raise_for_status()
            body = response.json()
            content = body["choices"][0]["message"]["content"]
            proposal = operations_proposal_adapter.validate_json(content)
        except Exception:
            record_ai_usage(
                connection,
                feature="command",
                model=settings.model,
                success=False,
                prompt_text=prompt,
            )
            raise
    record_ai_usage(
        connection,
        feature="command",
        model=settings.model,
        success=True,
        response_body=body,
        prompt_text=prompt,
        output_text=content,
    )
    return proposal


def resolve_item(connection: sqlite3.Connection, query: str) -> dict[str, Any]:
    matches = list_items(connection, query=query, limit=6)
    exact = [item for item in matches if item["name"].casefold() == query.casefold()]
    candidates = exact or matches
    if len(candidates) != 1:
        raise ConflictError(
            f"Item reference '{query}' matched {len(candidates)} items; choose one manually"
        )
    return candidates[0]


def resolve_location(connection: sqlite3.Connection, query: str) -> str:
    paths: list[tuple[str, str]] = []

    def collect(nodes: list[dict[str, Any]]) -> None:
        for node in nodes:
            paths.append((node["public_id"], node["path"]))
            collect(node["children"])

    collect(list_location_tree(connection))
    exact = [(public_id, path) for public_id, path in paths if path.casefold() == query.casefold()]
    if not exact:
        exact = [
            (public_id, path)
            for public_id, path in paths
            if path.rsplit(" > ", 1)[-1].casefold() == query.casefold()
        ]
    if len(exact) != 1:
        raise ConflictError(
            f"Location reference '{query}' matched {len(exact)} locations; choose one manually"
        )
    return exact[0][0]


def resolve_proposal(connection: sqlite3.Connection, proposal: Proposal) -> dict[str, Any]:
    resolved = proposal.model_dump(mode="json")
    action = resolved["action"]
    if action["type"] == "add_item":
        action["location_public_id"] = resolve_location(connection, action.pop("location"))
    elif action["type"] in {"adjust_quantity", "move_item", "update_item"}:
        item = resolve_item(connection, action.pop("item"))
        action["item_public_id"] = item["public_id"]
        action["expected_version"] = item["version"]
        action["current"] = {
            "name": item["name"],
            "quantity": item["quantity"],
            "unit": item["unit"],
            "location": item["location_path"],
        }
        if action["type"] == "move_item":
            action["destination_public_id"] = resolve_location(
                connection, action.pop("destination")
            )
    return resolved


async def parse_command(connection: sqlite3.Connection, text: str) -> dict[str, Any]:
    proposal = await call_operations_parser(connection, text)
    resolved = {
        "format": "findstuff-ops-v1",
        "operations": proposal.operations,
        "_composer": {
            "summary": proposal.summary,
            "warnings": proposal.warnings,
        },
    }
    preview = import_preview(resolved, connection)
    public_id = new_public_id("cmd")
    status = "proposed"
    expires = datetime.now(UTC) + timedelta(minutes=30)
    with transaction(connection):
        connection.execute(
            """
            INSERT INTO ai_commands(
                public_id, raw_text, proposal_json, resolved_json, status,
                provider, model, expires_at, applied_at
            ) VALUES (?, ?, ?, ?, ?, 'external', ?, ?,
                      CASE WHEN ? = 'applied' THEN CURRENT_TIMESTAMP ELSE NULL END)
            """,
            (
                public_id,
                text,
                proposal.model_dump_json(),
                json.dumps(resolved, separators=(",", ":")),
                status,
                get_ai_config(connection).model,
                expires.strftime("%Y-%m-%d %H:%M:%S"),
                "proposed",
            ),
        )
    return {
        "public_id": public_id,
        "status": status,
        "proposal": {
            "summary": proposal.summary,
            "warnings": proposal.warnings,
            "operations": proposal.operations,
        },
        "preview": preview,
        "requires_confirmation": bool(preview["valid"] and proposal.operations),
        "search_results": None,
    }


def get_command(connection: sqlite3.Connection, public_id: str) -> sqlite3.Row:
    row = connection.execute(
        "SELECT * FROM ai_commands WHERE public_id = ?", (public_id,)
    ).fetchone()
    if row is None:
        raise NotFoundError("AI command not found")
    return row


def confirm_command(connection: sqlite3.Connection, public_id: str) -> dict[str, Any]:
    command = get_command(connection, public_id)
    if command["status"] != "proposed":
        raise ConflictError(f"Command is already {command['status']}")
    if command["expires_at"] <= datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S"):
        raise ConflictError("Command proposal has expired")
    resolved = json.loads(command["resolved_json"])
    if resolved.get("format") == "findstuff-ops-v1":
        with transaction(connection):
            cursor = connection.execute(
                """
                UPDATE ai_commands
                SET status = 'applying', confirmed_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'proposed'
                """,
                (command["id"],),
            )
            if cursor.rowcount != 1:
                raise ConflictError("Command is already being applied")
        try:
            result = apply_import_merge(connection, resolved)
        except Exception as exc:
            with transaction(connection):
                connection.execute(
                    "UPDATE ai_commands SET status = 'failed', error = ? WHERE id = ?",
                    (str(exc), command["id"]),
                )
            raise
        with transaction(connection):
            connection.execute(
                """
                UPDATE ai_commands
                SET status = 'applied', applied_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (command["id"],),
            )
        return {"public_id": public_id, "status": "applied", "result": result}
    action = resolved["action"]
    with transaction(connection):
        connection.execute(
            "UPDATE ai_commands SET status = 'applying', confirmed_at = CURRENT_TIMESTAMP "
            "WHERE id = ? AND status = 'proposed'",
            (command["id"],),
        )
    try:
        if action["type"] == "add_item":
            values = {key: value for key, value in action.items() if key != "type"}
            category = values.pop("category", None)
            if category:
                values["category_id"] = find_category_id(connection, category)
            result = create_item(connection, values, source="ai")
        elif action["type"] == "adjust_quantity":
            result = adjust_quantity(
                connection,
                action["item_public_id"],
                Decimal(action["delta"]),
                action["expected_version"],
                source="ai",
            )
        elif action["type"] == "move_item":
            result = move_item(
                connection,
                action["item_public_id"],
                action["destination_public_id"],
                action["expected_version"],
                source="ai",
            )
        elif action["type"] == "update_item":
            ignored = {"type", "item_public_id", "current"}
            changes = {key: value for key, value in action.items() if key not in ignored}
            result = update_item(connection, action["item_public_id"], changes, source="ai")
        else:
            raise ConflictError("Search commands do not require confirmation")
    except Exception as exc:
        with transaction(connection):
            connection.execute(
                "UPDATE ai_commands SET status = 'failed', error = ? WHERE id = ?",
                (str(exc), command["id"]),
            )
        raise
    with transaction(connection):
        connection.execute(
            "UPDATE ai_commands SET status = 'applied', applied_at = CURRENT_TIMESTAMP "
            "WHERE id = ?",
            (command["id"],),
        )
    return {"public_id": public_id, "status": "applied", "result": result}


def reject_command(connection: sqlite3.Connection, public_id: str) -> None:
    command = get_command(connection, public_id)
    if command["status"] != "proposed":
        raise ConflictError(f"Command is already {command['status']}")
    with transaction(connection):
        connection.execute(
            "UPDATE ai_commands SET status = 'rejected' WHERE id = ?", (command["id"],)
        )
