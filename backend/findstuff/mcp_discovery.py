"""Read and search workflows available to trusted MCP clients."""

from __future__ import annotations

import sqlite3
from typing import Any

from .documents import warranties_due
from .human_search import (
    delete_alias,
    delete_search_observation,
    human_search,
    save_alias,
)
from .inventory import (
    analytics,
    dashboard,
    expiring_items,
    list_items_page,
)
from .inventory_query import query_inventory
from .saved_views import SaveViewRequest, delete_view, save_view
from .schemas import SearchAliasCreate

JsonObject = dict[str, Any]


def inventory_page(connection: sqlite3.Connection, args: JsonObject) -> JsonObject:
    return list_items_page(
        connection,
        query=str(args.get("query") or ""),
        location_public_id=args.get("location_public_id") or None,
        category_id=args.get("category_id"),
        low_stock=bool(args.get("low_stock", False)),
        needs_details=bool(args.get("needs_details", False)),
        include_archived=bool(args.get("include_archived", False)),
        archived_only=bool(args.get("archived_only", False)),
        include_zero=bool(args.get("include_zero", False)),
        limit=int(args.get("limit") or 100),
        cursor=args.get("cursor") or None,
    )


def advanced_inventory_query(connection: sqlite3.Connection, args: JsonObject) -> JsonObject:
    return query_inventory(
        connection,
        query=str(args.get("query") or ""),
        filter_name=str(args.get("filter") or "all"),
        sort=str(args.get("sort") or "updated"),
        location=args.get("location_public_id") or None,
        category_id=args.get("category_id"),
        tag=str(args.get("tag") or ""),
        compatibility=str(args.get("compatibility") or ""),
        include_zero=bool(args.get("include_zero", False)),
        formula=args.get("formula"),
        limit=int(args.get("limit") or 100),
        cursor=args.get("cursor") or None,
    )


def human_inventory_search(connection: sqlite3.Connection, args: JsonObject) -> JsonObject:
    return human_search(
        connection,
        str(args["query"]),
        include_zero=bool(args.get("include_zero", False)),
        limit=int(args.get("limit") or 100),
        cursor=args.get("cursor") or None,
    )


def create_search_alias(connection: sqlite3.Connection, args: JsonObject) -> JsonObject:
    values = SearchAliasCreate.model_validate(args).model_dump()
    return save_alias(connection, values)


def delete_search_alias(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    delete_alias(connection, public_id)
    return {"deleted": True}


def dismiss_search_candidate(connection: sqlite3.Connection, query: str) -> JsonObject:
    delete_search_observation(connection, query)
    return {"dismissed": True}


def save_inventory_view(connection: sqlite3.Connection, args: JsonObject) -> JsonObject:
    request = SaveViewRequest.model_validate(args["request"])
    return save_view(connection, str(args["public_id"]), request)


def delete_inventory_view(
    connection: sqlite3.Connection, public_id: str, revision: int
) -> JsonObject:
    delete_view(connection, public_id, revision)
    return {"deleted": True}


def get_dashboard(connection: sqlite3.Connection) -> JsonObject:
    return dashboard(connection)


def get_analytics(connection: sqlite3.Connection, days: int, include_imports: bool) -> JsonObject:
    if not 7 <= days <= 3650:
        raise ValueError("days must be between 7 and 3650")
    return analytics(connection, days, include_imports=include_imports)


def get_expiring(connection: sqlite3.Connection, days: int) -> list[JsonObject]:
    if not 0 <= days <= 3650:
        raise ValueError("days must be between 0 and 3650")
    return expiring_items(connection, days)


def get_warranties(connection: sqlite3.Connection, days: int) -> list[JsonObject]:
    if not 0 <= days <= 3650:
        raise ValueError("days must be between 0 and 3650")
    return warranties_due(connection, days)
