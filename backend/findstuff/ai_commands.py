from __future__ import annotations

import json
import re
import sqlite3
import unicodedata
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from difflib import SequenceMatcher
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

_OPERATION_WORDS = {
    "add": "add",
    "create": "add",
    "insert": "add",
    "new": "add",
    "buy": "add",
    "bought": "add",
    "purchase": "add",
    "modify": "modify",
    "update": "modify",
    "edit": "modify",
    "change": "modify",
    "move": "modify",
    "adjust": "modify",
    "increment": "modify",
    "decrement": "modify",
    "delete": "delete",
    "remove": "delete",
    "archive": "delete",
    "discard": "delete",
}
_ENTITY_WORDS = {
    "item": "item",
    "items": "item",
    "product": "item",
    "products": "item",
    "category": "category",
    "categories": "category",
    "location": "location",
    "locations": "location",
    "place": "location",
    "places": "location",
}
_REFERENCE_STOP_WORDS = {
    "a",
    "al",
    "alla",
    "at",
    "di",
    "del",
    "della",
    "in",
    "inside",
    "la",
    "nel",
    "nella",
    "of",
    "on",
    "the",
}


def _normalized_reference(value: Any) -> str:
    folded = unicodedata.normalize("NFKD", str(value or "").casefold())
    ascii_text = "".join(character for character in folded if not unicodedata.combining(character))
    return " ".join(re.findall(r"[a-z0-9]+", ascii_text))


def _reference_tokens(value: Any) -> set[str]:
    return {
        token
        for token in _normalized_reference(value).split()
        if token not in _REFERENCE_STOP_WORDS
    }


def _reference_score(query: str, path: str) -> float:
    normalized_query = _normalized_reference(query)
    normalized_path = _normalized_reference(path)
    name = path.rsplit(" > ", 1)[-1]
    normalized_name = _normalized_reference(name)
    if not normalized_query:
        return 0
    if normalized_query == normalized_path:
        return 1
    if normalized_query == normalized_name:
        return 0.99
    query_tokens = _reference_tokens(query)
    path_tokens = _reference_tokens(path)
    name_tokens = _reference_tokens(name)
    if not query_tokens:
        return 0
    coverage = len(query_tokens & path_tokens) / len(query_tokens)
    precision = len(query_tokens & path_tokens) / max(1, len(path_tokens))
    sequence = SequenceMatcher(None, normalized_query, normalized_path).ratio()
    score = coverage * 0.62 + precision * 0.16 + sequence * 0.12
    if query_tokens <= path_tokens:
        score = max(score, 0.82 + min(0.08, 0.02 * len(query_tokens)))
    if name_tokens and name_tokens <= query_tokens:
        score += 0.09
    return min(score, 1)


def _best_reference(
    entries: list[dict[str, Any]],
    query: Any,
    *,
    kind: str,
    identity_key: str,
) -> dict[str, Any] | None:
    if query is None or query == "":
        return None
    query_text = str(query).strip()
    for entry in entries:
        if str(entry.get(identity_key, "")) == query_text:
            return entry
    exact = [
        entry
        for entry in entries
        if _normalized_reference(entry.get("path")) == _normalized_reference(query_text)
    ]
    if len(exact) == 1:
        return exact[0]
    scored = sorted(
        (
            (_reference_score(query_text, str(entry.get("path", ""))), entry)
            for entry in entries
        ),
        key=lambda candidate: candidate[0],
        reverse=True,
    )
    if not scored or scored[0][0] < 0.74:
        return None
    if len(scored) > 1 and scored[0][0] - scored[1][0] < 0.055:
        raise ConflictError(
            f"{kind.title()} reference '{query_text}' is ambiguous; "
            "choose a more specific path"
        )
    return scored[0][1]


def _operation_words(operation: dict[str, Any]) -> tuple[str | None, str | None, str]:
    raw_op = operation.get("op") or operation.get("action") or operation.get("operation")
    raw_type = (
        operation.get("type")
        or operation.get("entity")
        or operation.get("entity_type")
        or operation.get("record_type")
    )
    combined = "_".join(
        part
        for part in (
            _normalized_reference(raw_op).replace(" ", "_"),
            _normalized_reference(raw_type).replace(" ", "_"),
        )
        if part
    )
    words = [word for word in combined.split("_") if word]
    op = next((_OPERATION_WORDS[word] for word in words if word in _OPERATION_WORDS), None)
    entity = next((_ENTITY_WORDS[word] for word in reversed(words) if word in _ENTITY_WORDS), None)
    return op, entity, " ".join(words)


def _canonical_operation(operation: dict[str, Any], index: int) -> dict[str, Any]:
    op, entity, words = _operation_words(operation)
    if op is None:
        raise ValueError(
            f"Operation #{index}: could not understand the action. "
            "Use add, modify, move, adjust, or delete."
        )
    if entity is None:
        raise ValueError(
            f"Operation #{index}: could not understand the record type. "
            "Use item, category, or location."
        )
    raw_data = operation.get("data")
    data = dict(raw_data) if isinstance(raw_data, dict) else {}
    raw_match = operation.get("match")
    match = dict(raw_match) if isinstance(raw_match, dict) else {}
    reserved = {
        "op",
        "action",
        "operation",
        "type",
        "entity",
        "entity_type",
        "record_type",
        "data",
        "match",
    }
    loose = {key: value for key, value in operation.items() if key not in reserved}

    if op == "add":
        data = {**loose, **data}
    else:
        reference_keys = {
            "item": ("public_id", "item_public_id", "item", "barcode", "name"),
            "category": ("id", "category_id", "category", "path", "name"),
            "location": (
                "public_id",
                "location_public_id",
                "location",
                "path",
                "name",
            ),
        }[entity]
        if not match:
            for key in reference_keys:
                if key in loose:
                    match_key = {
                        "item": "name",
                        "category": "path",
                        "location": "path",
                    }.get(key, key)
                    match[match_key] = loose.pop(key)
                    break
        data = {**loose, **data}

    if entity == "item":
        if "destination" in data and "location" not in data:
            data["location"] = data.pop("destination")
        if "destination_location" in data and "location" not in data:
            data["location"] = data.pop("destination_location")
        if "delta" in data and "quantity_delta" not in data:
            data["quantity_delta"] = data.pop("delta")
        if "price_minor" in data and "purchase_price_minor" not in data:
            data["purchase_price_minor"] = data.pop("price_minor")
        if "currency" in data and "purchase_currency" not in data:
            data["purchase_currency"] = data.pop("currency")
    if "move" in words and op == "modify" and entity == "item":
        destination = (
            operation.get("destination")
            or operation.get("destination_location")
            or data.get("location")
        )
        if destination is not None:
            data["location"] = destination
    return {"op": op, "type": entity, "match": match, "data": data}


def normalize_operations(
    connection: sqlite3.Connection, operations: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[str]]:
    context = operations_context(connection)
    locations = context["locations"]
    categories = context["categories"]
    items = [
        {**item, "path": f"{item['name']} > {item['location']}"}
        for item in context["items"]
    ]
    normalized: list[dict[str, Any]] = []
    warnings: list[str] = []

    def resolve(
        value: Any,
        entries: list[dict[str, Any]],
        *,
        kind: str,
        identity_key: str,
    ) -> Any:
        match = _best_reference(
            entries, value, kind=kind, identity_key=identity_key
        )
        if match is None:
            return value
        identity = match[identity_key]
        if str(value) != str(identity):
            warnings.append(
                f"Matched {kind} “{value}” to “{match['path']}”."
            )
        return identity

    for index, raw_operation in enumerate(operations, start=1):
        if not isinstance(raw_operation, dict):
            raise ValueError(f"Operation #{index}: expected an object")
        operation = _canonical_operation(raw_operation, index)
        op = operation["op"]
        entity = operation["type"]
        data = operation["data"]
        match = operation["match"]

        if entity == "item" and op != "add":
            for key in ("public_id", "item_public_id"):
                if key in match:
                    match = {
                        "public_id": resolve(
                            match[key],
                            items,
                            kind="item",
                            identity_key="public_id",
                        )
                    }
                    break
            else:
                for key in ("item", "name"):
                    if key in match:
                        match = {
                            "public_id": resolve(
                                match[key],
                                items,
                                kind="item",
                                identity_key="public_id",
                            )
                        }
                        break
        elif entity == "location" and op != "add":
            for key in ("public_id", "location_public_id", "path", "name", "location"):
                if key in match:
                    match = {
                        "public_id": resolve(
                            match[key],
                            locations,
                            kind="location",
                            identity_key="public_id",
                        )
                    }
                    break
        elif entity == "category" and op != "add":
            for key in ("id", "category_id", "path", "name", "category"):
                if key in match:
                    match = {
                        "id": resolve(
                            match[key],
                            categories,
                            kind="category",
                            identity_key="id",
                        )
                    }
                    break

        if entity == "item":
            for key in ("location", "location_path", "location_name", "destination"):
                if key in data:
                    data["location_public_id"] = resolve(
                        data.pop(key),
                        locations,
                        kind="location",
                        identity_key="public_id",
                    )
                    break
            for key in ("category", "category_path", "category_name"):
                if key in data:
                    data["category_id"] = resolve(
                        data.pop(key),
                        categories,
                        kind="category",
                        identity_key="id",
                    )
                    break
        if entity == "location":
            for key in ("parent", "parent_path", "parent_name"):
                if key in data:
                    data["parent_public_id"] = resolve(
                        data.pop(key),
                        locations,
                        kind="location",
                        identity_key="public_id",
                    )
                    break
        if entity == "category":
            for key in ("parent", "parent_path", "parent_name"):
                if key in data:
                    data["parent_id"] = resolve(
                        data.pop(key),
                        categories,
                        kind="category",
                        identity_key="id",
                    )
                    break
            for key in (
                "default_location",
                "default_location_path",
                "default_location_name",
            ):
                if key in data:
                    data["default_location_public_id"] = resolve(
                        data.pop(key),
                        locations,
                        kind="location",
                        identity_key="public_id",
                    )
                    break
        operation["match"] = match
        operation["data"] = data
        normalized.append(operation)
    return normalized, list(dict.fromkeys(warnings))


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
        "and location records. Every operation MUST be an object with exactly these top-level "
        "keys: op (add, modify, or delete), type (item, category, or location), match (object), "
        "and data (object). Do not use action, entity, add_item, move_item, or other schemas. "
        "Use supplied public_id/id values for existing records whenever possible. A location "
        "description such as 'drawer in studio' should be mapped to the most specific supplied "
        "location whose full path contains those words. For stock changes use add_quantity or "
        "remove_quantity, not an absolute quantity. A move is op=modify, type=item, with the "
        "existing item in match and location_public_id in data. Put parent structure operations "
        "before operations that refer to them. Never guess an ambiguous existing record. "
        "Example add item: "
        '{"op":"add","type":"item","match":{},"data":{"name":"Mouse",'
        '"quantity":1,"unit":"pcs","location_public_id":"loc_123",'
        '"category_id":7,"purchase_price_minor":20000,"purchase_currency":"EUR"}}. '
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
    operations, normalization_warnings = normalize_operations(
        connection, proposal.operations
    )
    warnings = list(dict.fromkeys([*proposal.warnings, *normalization_warnings]))
    resolved = {
        "format": "findstuff-ops-v1",
        "operations": operations,
        "_composer": {
            "summary": proposal.summary,
            "warnings": warnings,
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
            "warnings": warnings,
            "operations": operations,
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
