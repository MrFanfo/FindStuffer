from __future__ import annotations

import json
import sqlite3
import sys
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

from . import __version__
from .config import get_settings
from .db import connect, migrate
from .enrichment import queue_enrichment
from .extended import add_shopping, check_shopping, list_shopping
from .inventory import (
    InventoryError,
    add_item_relationship,
    adjust_quantity,
    create_item,
    create_location,
    delete_item_relationship,
    get_item,
    item_history,
    list_categories,
    list_item_lots,
    list_item_relationships,
    list_items,
    list_location_tree,
    list_maintenance_tasks,
    location_contents,
    move_item,
    set_item_tags,
    update_item,
)
from .metadata_enrichment import (
    accept_suggestion,
    create_export_request,
    import_response,
    list_suggestions,
    reject_suggestion,
    set_item_metadata,
)
from .photos import list_photos

JsonObject = dict[str, Any]
ToolHandler = Callable[[JsonObject], Any]

MCP_PROTOCOL_VERSION = "2024-11-05"
DIRECT_ENRICHMENT_ITEM_FIELDS = {
    "description",
    "notes",
    "brand",
    "model",
    "barcode",
    "estimated_price_minor",
    "estimated_price_currency",
    "weight_g",
    "length_mm",
    "width_mm",
    "height_mm",
    "expiration_date",
}


def _schema(properties: JsonObject, required: list[str] | None = None) -> JsonObject:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": False,
    }


def _string(description: str = "") -> JsonObject:
    schema: JsonObject = {"type": "string"}
    if description:
        schema["description"] = description
    return schema


def _number(description: str = "") -> JsonObject:
    schema: JsonObject = {"type": "number"}
    if description:
        schema["description"] = description
    return schema


def _integer(description: str = "") -> JsonObject:
    schema: JsonObject = {"type": "integer"}
    if description:
        schema["description"] = description
    return schema


def _boolean(description: str = "") -> JsonObject:
    schema: JsonObject = {"type": "boolean"}
    if description:
        schema["description"] = description
    return schema


def _object(description: str = "") -> JsonObject:
    schema: JsonObject = {"type": "object", "additionalProperties": True}
    if description:
        schema["description"] = description
    return schema


def _array(items: JsonObject, description: str = "") -> JsonObject:
    schema: JsonObject = {"type": "array", "items": items}
    if description:
        schema["description"] = description
    return schema


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_schema: JsonObject
    handler: ToolHandler

    def as_mcp(self) -> JsonObject:
        return {
            "name": self.name,
            "description": self.description,
            "inputSchema": self.input_schema,
        }


class FindStuffMCPServer:
    def __init__(self, database_path: Path | None = None) -> None:
        self.database_path = database_path or get_settings().database_path
        migrate(self.database_path)
        self.connection = connect(self.database_path)
        self.tools = {tool.name: tool for tool in self._build_tools()}

    def close(self) -> None:
        self.connection.close()

    def handle_message(self, message: JsonObject) -> JsonObject | None:
        message_id = message.get("id")
        method = message.get("method")
        params = message.get("params") or {}
        if method == "notifications/initialized":
            return None
        if method == "initialize":
            requested = params.get("protocolVersion") if isinstance(params, dict) else None
            return self._result(
                message_id,
                {
                    "protocolVersion": requested or MCP_PROTOCOL_VERSION,
                    "capabilities": {
                        "tools": {"listChanged": False},
                        "resources": {"listChanged": False},
                    },
                    "serverInfo": {"name": "findstuff", "version": __version__},
                },
            )
        if method == "ping":
            return self._result(message_id, {})
        if method == "tools/list":
            return self._result(
                message_id,
                {"tools": [tool.as_mcp() for tool in self.tools.values()]},
            )
        if method == "tools/call":
            try:
                return self._result(message_id, self._call_tool(params))
            except ValueError as exc:
                return self._error(message_id, -32602, str(exc))
        if method in {"resources/list", "prompts/list"}:
            key = "resources" if method == "resources/list" else "prompts"
            return self._result(message_id, {key: []})
        if method == "shutdown":
            return self._result(message_id, None)
        if message_id is None:
            return None
        return self._error(message_id, -32601, f"Unknown method: {method}")

    def _call_tool(self, params: Any) -> JsonObject:
        if not isinstance(params, dict):
            raise ValueError("Tool call params must be an object")
        name = str(params.get("name") or "")
        arguments = params.get("arguments") or {}
        if not isinstance(arguments, dict):
            raise ValueError("Tool arguments must be an object")
        tool = self.tools.get(name)
        if tool is None:
            raise ValueError(f"Unknown tool: {name}")
        try:
            result = tool.handler(arguments)
        except (InventoryError, ValueError, TypeError, sqlite3.Error) as exc:
            return {
                "isError": True,
                "content": [{"type": "text", "text": str(exc)}],
            }
        return {
            "content": [{"type": "text", "text": json.dumps(result, indent=2, default=str)}],
            "structuredContent": result,
        }

    def _build_tools(self) -> list[Tool]:
        return [
            Tool(
                "findstuff_search_items",
                "Search inventory items by text, location, category, stock state, and visibility.",
                _schema(
                    {
                        "query": _string("Full-text query."),
                        "location_public_id": _string("Limit to one exact location public id."),
                        "category_id": _integer("Limit to a category and its descendants."),
                        "low_stock": _boolean("Only low-stock items."),
                        "needs_details": _boolean("Only items still in Unassigned."),
                        "include_archived": _boolean("Include archived items."),
                        "include_zero": _boolean("Include zero-quantity items."),
                        "limit": _integer("Maximum 1-250 results."),
                    }
                ),
                self._search_items,
            ),
            Tool(
                "findstuff_get_item_detail",
                "Get an item with photos, history, lots, maintenance tasks, and related items.",
                _schema({"public_id": _string("Item public id.")}, ["public_id"]),
                self._get_item_detail,
            ),
            Tool(
                "findstuff_list_locations",
                "List the full location hierarchy with item counts.",
                _schema({}),
                lambda _args: list_location_tree(self.connection),
            ),
            Tool(
                "findstuff_location_contents",
                "List items and child locations inside a location.",
                _schema(
                    {
                        "public_id": _string("Location public id."),
                        "recursive": _boolean("Include nested descendants."),
                    },
                    ["public_id"],
                ),
                self._location_contents,
            ),
            Tool(
                "findstuff_list_categories",
                "List categories with hierarchy paths, counts, capabilities, "
                "and default locations.",
                _schema({}),
                lambda _args: list_categories(self.connection),
            ),
            Tool(
                "findstuff_create_location",
                "Create a location under an optional parent location.",
                _schema(
                    {
                        "name": _string(),
                        "kind": _string("Location type, such as room, shelf, box, drawer."),
                        "description": _string(),
                        "parent_public_id": _string("Parent location public id, or omit for root."),
                    },
                    ["name"],
                ),
                self._create_location,
            ),
            Tool(
                "findstuff_create_item",
                "Create an inventory item. Use location_public_id and category_id when known.",
                _schema(
                    {
                        "values": _object(
                            "Item fields matching the FindStuff item model: name, quantity, "
                            "unit, location_public_id, category_id, notes, brand, model, "
                            "barcode, etc."
                        )
                    },
                    ["values"],
                ),
                self._create_item,
            ),
            Tool(
                "findstuff_update_item",
                "Patch item fields. Requires the current expected_version from the item.",
                _schema(
                    {
                        "public_id": _string("Item public id."),
                        "expected_version": _integer("Current item version."),
                        "changes": _object(
                            "Patch fields: name, quantity, category_id, notes, etc."
                        ),
                    },
                    ["public_id", "expected_version", "changes"],
                ),
                self._update_item,
            ),
            Tool(
                "findstuff_move_item",
                "Move an item to a location. Requires the current expected_version.",
                _schema(
                    {
                        "public_id": _string("Item public id."),
                        "destination_public_id": _string("Destination location public id."),
                        "expected_version": _integer("Current item version."),
                    },
                    ["public_id", "destination_public_id", "expected_version"],
                ),
                self._move_item,
            ),
            Tool(
                "findstuff_adjust_quantity",
                "Adjust item quantity by a signed delta. Requires the current expected_version.",
                _schema(
                    {
                        "public_id": _string("Item public id."),
                        "delta": _number("Signed quantity change."),
                        "expected_version": _integer("Current item version."),
                    },
                    ["public_id", "delta", "expected_version"],
                ),
                self._adjust_quantity,
            ),
            Tool(
                "findstuff_set_item_tags",
                "Replace the tags on an item. Requires the current expected_version.",
                _schema(
                    {
                        "public_id": _string("Item public id."),
                        "tags": _array(_string(), "Tag names."),
                        "expected_version": _integer("Current item version."),
                    },
                    ["public_id", "tags", "expected_version"],
                ),
                self._set_item_tags,
            ),
            Tool(
                "findstuff_create_relationship",
                "Relate two items symmetrically, such as a tool and its accessories.",
                _schema(
                    {
                        "public_id": _string("First item public id."),
                        "related_item_public_id": _string("Second item public id."),
                        "relation_type": _string("Short relation type, defaults to related."),
                        "note": _string("Optional relationship note."),
                    },
                    ["public_id", "related_item_public_id"],
                ),
                self._create_relationship,
            ),
            Tool(
                "findstuff_delete_relationship",
                "Remove an item relationship by relationship public id.",
                _schema(
                    {
                        "public_id": _string("Either item's public id."),
                        "relationship_public_id": _string("Relationship public id."),
                    },
                    ["public_id", "relationship_public_id"],
                ),
                self._delete_relationship,
            ),
            Tool(
                "findstuff_set_item_metadata",
                "Set a flexible metadata value at a /metadata/... path and mark it confirmed.",
                _schema(
                    {
                        "public_id": _string("Item public id."),
                        "path": _string("Metadata path, for example /metadata/tools/material."),
                        "value": {},
                        "value_type": _string("Optional string, number, boolean, list, or object."),
                        "confidence": _number("0-1 confidence, defaults to 1."),
                        "sources": _array(_object(), "Optional source records."),
                        "status": _string("Metadata status, defaults to confirmed."),
                    },
                    ["public_id", "path", "value"],
                ),
                self._set_item_metadata,
            ),
            Tool(
                "findstuff_enrich_items",
                "Directly apply researched enrichment to selected items: metadata values, "
                "useful links such as manuals or datasheets, and safe core item facts. "
                "The caller should research sources first, then pass the evidence here.",
                _schema(
                    {
                        "selector": {
                            "type": "object",
                            "description": "Optional search/filter selecting target items.",
                            "properties": {
                                "public_ids": _array(_string(), "Exact item public ids."),
                                "query": _string("Full-text query."),
                                "location_public_id": _string("Limit to one exact location."),
                                "category_id": _integer("Limit to a category and descendants."),
                                "low_stock": _boolean("Only low-stock items."),
                                "needs_details": _boolean("Only items still in Unassigned."),
                                "include_archived": _boolean("Include archived items."),
                                "include_zero": _boolean("Include zero-quantity items."),
                                "limit": _integer("Maximum 1-250 selected items."),
                            },
                            "additionalProperties": False,
                        },
                        "items": _array(
                            {
                                "type": "object",
                                "properties": {
                                    "public_id": _string("Target item public id."),
                                    "metadata": _array(
                                        {
                                            "type": "object",
                                            "properties": {
                                                "path": _string("A /metadata/... path."),
                                                "value": {},
                                                "value_type": _string(
                                                    "Optional string, number, boolean, "
                                                    "list, or object."
                                                ),
                                                "confidence": _number("0-1 confidence."),
                                                "sources": _array(
                                                    _object(),
                                                    "Source records used for this value.",
                                                ),
                                                "status": _string(
                                                    "Metadata status, defaults to confirmed."
                                                ),
                                            },
                                            "required": ["path", "value"],
                                            "additionalProperties": False,
                                        },
                                    ),
                                    "links": _array(
                                        {
                                            "type": "object",
                                            "properties": {
                                                "label": _string("Link label."),
                                                "url": _string("Link URL."),
                                            },
                                            "required": ["label", "url"],
                                            "additionalProperties": False,
                                        },
                                        "Links to merge into the item.",
                                    ),
                                    "updates": _object(
                                        "Safe core facts: description, notes, brand, model, "
                                        "barcode, dimensions, weight, estimated price."
                                    ),
                                },
                                "required": ["public_id"],
                                "additionalProperties": False,
                            },
                            "Per-item enrichment patches.",
                        ),
                        "metadata": _array(
                            {
                                "type": "object",
                                "properties": {
                                    "path": _string("A /metadata/... path."),
                                    "value": {},
                                    "value_type": _string(
                                        "Optional string, number, boolean, "
                                        "list, or object."
                                    ),
                                    "confidence": _number("0-1 confidence."),
                                    "sources": _array(_object(), "Source records."),
                                    "status": _string("Metadata status, defaults to confirmed."),
                                },
                                "required": ["path", "value"],
                                "additionalProperties": False,
                            },
                            "Common metadata to apply to every selected item.",
                        ),
                        "links": _array(
                            {
                                "type": "object",
                                "properties": {
                                    "label": _string("Link label."),
                                    "url": _string("Link URL."),
                                },
                                "required": ["label", "url"],
                                "additionalProperties": False,
                            },
                            "Common links to merge into every selected item.",
                        ),
                        "updates": _object(
                            "Common safe core facts to apply to every selected item."
                        ),
                        "replace_links": _boolean(
                            "Replace links instead of merging/deduping. Defaults to false."
                        ),
                    }
                ),
                self._enrich_items,
            ),
            Tool(
                "findstuff_create_enrichment_request",
                "Create an external metadata-enrichment request document for weak item fields.",
                _schema(
                    {
                        "categories": _array(_string(), "Category names or paths to include."),
                        "limit": _integer("Maximum 1-250 items."),
                        "include_photos": _boolean("Include up to three photo URLs per item."),
                    }
                ),
                self._create_enrichment_request,
            ),
            Tool(
                "findstuff_import_enrichment_response",
                "Import an enrichment response document and create reviewable suggestions.",
                _schema(
                    {"payload": _object("findstuff.enrichment_response.v1 document.")},
                    ["payload"],
                ),
                self._import_enrichment_response,
            ),
            Tool(
                "findstuff_list_enrichment_suggestions",
                "List pending, unsafe, accepted, rejected, edited, or all enrichment suggestions.",
                _schema({"status": _string("Defaults to pending; use all for everything.")}),
                self._list_enrichment_suggestions,
            ),
            Tool(
                "findstuff_accept_enrichment_suggestion",
                "Accept an enrichment suggestion, optionally overriding its value.",
                _schema(
                    {
                        "public_id": _string("Suggestion public id."),
                        "value": {},
                    },
                    ["public_id"],
                ),
                self._accept_enrichment_suggestion,
            ),
            Tool(
                "findstuff_reject_enrichment_suggestion",
                "Reject a pending enrichment suggestion.",
                _schema({"public_id": _string("Suggestion public id.")}, ["public_id"]),
                self._reject_enrichment_suggestion,
            ),
            Tool(
                "findstuff_queue_barcode_enrichment",
                "Queue Open Food Facts enrichment for one item with a barcode.",
                _schema({"public_id": _string("Item public id.")}, ["public_id"]),
                self._queue_barcode_enrichment,
            ),
            Tool(
                "findstuff_list_shopping",
                "List shopping-list entries.",
                _schema({}),
                lambda _args: list_shopping(self.connection),
            ),
            Tool(
                "findstuff_add_shopping",
                "Add a shopping-list entry, optionally linked to an inventory item.",
                _schema(
                    {
                        "name": _string(),
                        "quantity": _number("Quantity, defaults to 1."),
                        "unit": _string("Unit, defaults to pcs."),
                        "item_public_id": _string("Optional linked item public id."),
                    },
                    ["name"],
                ),
                self._add_shopping,
            ),
            Tool(
                "findstuff_check_shopping",
                "Mark a shopping-list entry checked or unchecked.",
                _schema(
                    {
                        "public_id": _string("Shopping entry public id."),
                        "checked": _boolean("True for checked, false for unchecked."),
                    },
                    ["public_id", "checked"],
                ),
                self._check_shopping,
            ),
        ]

    def _search_items(self, args: JsonObject) -> list[JsonObject]:
        category_id = args.get("category_id")
        return list_items(
            self.connection,
            query=str(args.get("query") or ""),
            location_public_id=args.get("location_public_id") or None,
            category_id=int(category_id) if category_id is not None else None,
            low_stock=bool(args.get("low_stock", False)),
            needs_details=bool(args.get("needs_details", False)),
            include_archived=bool(args.get("include_archived", False)),
            include_zero=bool(args.get("include_zero", False)),
            limit=int(args.get("limit") or 100),
        )

    def _get_item_detail(self, args: JsonObject) -> JsonObject:
        public_id = str(args["public_id"])
        return {
            "item": get_item(self.connection, public_id),
            "history": item_history(self.connection, public_id),
            "photos": list_photos(self.connection, public_id),
            "lots": list_item_lots(self.connection, public_id),
            "maintenance": list_maintenance_tasks(self.connection, public_id),
            "related": list_item_relationships(self.connection, public_id),
        }

    def _location_contents(self, args: JsonObject) -> JsonObject:
        return location_contents(
            self.connection,
            str(args["public_id"]),
            recursive=bool(args.get("recursive", True)),
        )

    def _create_location(self, args: JsonObject) -> JsonObject:
        return create_location(
            self.connection,
            {
                "name": args["name"],
                "kind": args.get("kind") or "location",
                "description": args.get("description") or "",
                "parent_public_id": args.get("parent_public_id") or None,
            },
        )

    def _create_item(self, args: JsonObject) -> JsonObject:
        values = dict(args["values"])
        return create_item(self.connection, values, source="mcp")

    def _update_item(self, args: JsonObject) -> JsonObject:
        changes = dict(args["changes"])
        changes["expected_version"] = int(args["expected_version"])
        return update_item(self.connection, str(args["public_id"]), changes, source="mcp")

    def _move_item(self, args: JsonObject) -> JsonObject:
        return move_item(
            self.connection,
            str(args["public_id"]),
            str(args["destination_public_id"]),
            int(args["expected_version"]),
            source="mcp",
        )

    def _adjust_quantity(self, args: JsonObject) -> JsonObject:
        return adjust_quantity(
            self.connection,
            str(args["public_id"]),
            Decimal(str(args["delta"])),
            int(args["expected_version"]),
            source="mcp",
        )

    def _set_item_tags(self, args: JsonObject) -> JsonObject:
        return set_item_tags(
            self.connection,
            str(args["public_id"]),
            [str(tag) for tag in args.get("tags", [])],
            int(args["expected_version"]),
        )

    def _create_relationship(self, args: JsonObject) -> JsonObject:
        return add_item_relationship(
            self.connection,
            str(args["public_id"]),
            str(args["related_item_public_id"]),
            str(args.get("relation_type") or "related"),
            str(args.get("note") or ""),
        )

    def _delete_relationship(self, args: JsonObject) -> JsonObject:
        delete_item_relationship(
            self.connection,
            str(args["public_id"]),
            str(args["relationship_public_id"]),
        )
        return {"deleted": True}

    def _set_item_metadata(self, args: JsonObject) -> JsonObject:
        return set_item_metadata(
            self.connection,
            str(args["public_id"]),
            str(args["path"]),
            args.get("value"),
            value_type=args.get("value_type"),
            confidence=float(args.get("confidence", 1.0)),
            sources=args.get("sources") if isinstance(args.get("sources"), list) else None,
            status=str(args.get("status") or "confirmed"),
        )

    def _enrich_items(self, args: JsonObject) -> JsonObject:
        selector_targets = self._selected_enrichment_items(args.get("selector"))
        patches = self._enrichment_patches(args, selector_targets)
        replace_links = bool(args.get("replace_links", False))
        results: list[JsonObject] = []
        for patch in patches:
            public_id = str(patch["public_id"])
            before = get_item(self.connection, public_id)
            applied_metadata = [
                self._apply_metadata_entry(public_id, entry)
                for entry in self._metadata_entries(patch.get("metadata"))
            ]
            safe_updates = self._safe_enrichment_updates(patch.get("updates"))
            links = self._link_entries(patch.get("links"))
            links_added = 0
            if links:
                merged_links = links if replace_links else self._merge_links(before["links"], links)
                links_added = max(0, len(merged_links) - len(before["links"]))
                safe_updates["links"] = merged_links
            item_updated = False
            if safe_updates:
                safe_updates["expected_version"] = int(before["version"])
                after = update_item(
                    self.connection,
                    public_id,
                    safe_updates,
                    source="mcp_enrichment",
                )
                item_updated = True
            else:
                after = get_item(self.connection, public_id)
            results.append(
                {
                    "public_id": public_id,
                    "name": after["name"],
                    "item_updated": item_updated,
                    "metadata": applied_metadata,
                    "links_added": links_added,
                    "links_total": len(after["links"]),
                    "item": after,
                }
            )
        return {
            "matched_count": len(selector_targets),
            "updated_count": len(results),
            "results": results,
        }

    def _selected_enrichment_items(self, selector: Any) -> list[JsonObject]:
        if selector is None:
            return []
        if not isinstance(selector, dict):
            raise ValueError("selector must be an object")
        public_ids = selector.get("public_ids")
        if public_ids is not None:
            if not isinstance(public_ids, list):
                raise ValueError("selector.public_ids must be a list")
            return [get_item(self.connection, str(public_id)) for public_id in public_ids]
        category_id = selector.get("category_id")
        return list_items(
            self.connection,
            query=str(selector.get("query") or ""),
            location_public_id=selector.get("location_public_id") or None,
            category_id=int(category_id) if category_id is not None else None,
            low_stock=bool(selector.get("low_stock", False)),
            needs_details=bool(selector.get("needs_details", False)),
            include_archived=bool(selector.get("include_archived", False)),
            include_zero=bool(selector.get("include_zero", False)),
            limit=int(selector.get("limit") or 25),
        )

    def _enrichment_patches(
        self,
        args: JsonObject,
        selector_targets: list[JsonObject],
    ) -> list[JsonObject]:
        common_metadata = self._metadata_entries(args.get("metadata"))
        common_links = self._link_entries(args.get("links"))
        common_updates = self._safe_enrichment_updates(args.get("updates"))
        patches_by_public_id: dict[str, JsonObject] = {}
        if common_metadata or common_links or common_updates:
            for target in selector_targets:
                patches_by_public_id[target["public_id"]] = {
                    "public_id": target["public_id"],
                    "metadata": list(common_metadata),
                    "links": list(common_links),
                    "updates": dict(common_updates),
                }
        raw_items = args.get("items") or []
        if not isinstance(raw_items, list):
            raise ValueError("items must be a list")
        for raw_patch in raw_items:
            if not isinstance(raw_patch, dict):
                raise ValueError("items entries must be objects")
            if not raw_patch.get("public_id"):
                raise ValueError("items entries require public_id")
            public_id = str(raw_patch["public_id"])
            patch = patches_by_public_id.setdefault(
                public_id,
                {"public_id": public_id, "metadata": [], "links": [], "updates": {}},
            )
            patch["metadata"].extend(self._metadata_entries(raw_patch.get("metadata")))
            patch["links"].extend(self._link_entries(raw_patch.get("links")))
            patch["updates"].update(self._safe_enrichment_updates(raw_patch.get("updates")))
        patches = list(patches_by_public_id.values())
        if not patches:
            raise ValueError("No enrichment to apply; provide selector/common data or items")
        return patches

    def _metadata_entries(self, raw_metadata: Any) -> list[JsonObject]:
        if raw_metadata is None:
            return []
        if not isinstance(raw_metadata, list):
            raise ValueError("metadata must be a list")
        entries: list[JsonObject] = []
        for entry in raw_metadata:
            if not isinstance(entry, dict):
                raise ValueError("metadata entries must be objects")
            if not entry.get("path"):
                raise ValueError("metadata entries require path")
            if "value" not in entry:
                raise ValueError("metadata entries require value")
            entries.append(entry)
        return entries

    def _apply_metadata_entry(self, public_id: str, entry: JsonObject) -> JsonObject:
        return set_item_metadata(
            self.connection,
            public_id,
            str(entry["path"]),
            entry.get("value"),
            value_type=entry.get("value_type"),
            confidence=float(entry.get("confidence", 1.0)),
            sources=entry.get("sources") if isinstance(entry.get("sources"), list) else None,
            status=str(entry.get("status") or "confirmed"),
        )

    def _link_entries(self, raw_links: Any) -> list[JsonObject]:
        if raw_links is None:
            return []
        if not isinstance(raw_links, list):
            raise ValueError("links must be a list")
        links: list[JsonObject] = []
        for link in raw_links:
            if not isinstance(link, dict):
                raise ValueError("links entries must be objects")
            label = str(link.get("label") or "").strip()
            url = str(link.get("url") or "").strip()
            if not label or not url:
                raise ValueError("links entries require label and url")
            links.append({"label": label[:240], "url": url[:2000]})
        return links

    def _merge_links(
        self,
        existing_links: list[JsonObject],
        new_links: list[JsonObject],
    ) -> list[JsonObject]:
        merged: list[JsonObject] = []
        seen: set[tuple[str, str]] = set()
        for link in [*existing_links, *new_links]:
            if not isinstance(link, dict):
                continue
            label = str(link.get("label") or "").strip()
            url = str(link.get("url") or "").strip()
            if not label or not url:
                continue
            key = (label.casefold(), url.casefold())
            if key in seen:
                continue
            seen.add(key)
            merged.append({"label": label[:240], "url": url[:2000]})
        return merged[:20]

    def _safe_enrichment_updates(self, raw_updates: Any) -> JsonObject:
        if raw_updates is None:
            return {}
        if not isinstance(raw_updates, dict):
            raise ValueError("updates must be an object")
        unsupported = sorted(set(raw_updates) - DIRECT_ENRICHMENT_ITEM_FIELDS)
        if unsupported:
            raise ValueError(
                "Unsupported enrichment update fields: " + ", ".join(unsupported)
            )
        return {key: value for key, value in raw_updates.items() if value is not None}

    def _create_enrichment_request(self, args: JsonObject) -> JsonObject:
        categories = args.get("categories") if isinstance(args.get("categories"), list) else []
        return create_export_request(
            self.connection,
            categories=[str(category) for category in categories],
            limit=int(args.get("limit") or 50),
            include_photos=bool(args.get("include_photos", True)),
        )

    def _import_enrichment_response(self, args: JsonObject) -> JsonObject:
        return import_response(self.connection, dict(args["payload"]))

    def _list_enrichment_suggestions(self, args: JsonObject) -> list[JsonObject]:
        return list_suggestions(self.connection, str(args.get("status") or "pending"))

    def _accept_enrichment_suggestion(self, args: JsonObject) -> JsonObject:
        edited_value = args["value"] if "value" in args else None
        return accept_suggestion(self.connection, str(args["public_id"]), edited_value)

    def _reject_enrichment_suggestion(self, args: JsonObject) -> JsonObject:
        reject_suggestion(self.connection, str(args["public_id"]))
        return {"rejected": True}

    def _queue_barcode_enrichment(self, args: JsonObject) -> JsonObject:
        return queue_enrichment(self.connection, str(args["public_id"]))

    def _add_shopping(self, args: JsonObject) -> JsonObject:
        return add_shopping(
            self.connection,
            str(args["name"]),
            Decimal(str(args.get("quantity") or 1)),
            str(args.get("unit") or "pcs"),
            args.get("item_public_id") or None,
        )

    def _check_shopping(self, args: JsonObject) -> JsonObject:
        check_shopping(self.connection, str(args["public_id"]), bool(args["checked"]))
        return {"checked": bool(args["checked"])}

    @staticmethod
    def _result(message_id: Any, result: Any) -> JsonObject:
        return {"jsonrpc": "2.0", "id": message_id, "result": result}

    @staticmethod
    def _error(message_id: Any, code: int, message: str) -> JsonObject:
        return {"jsonrpc": "2.0", "id": message_id, "error": {"code": code, "message": message}}


def serve_stdio(database_path: Path | None = None) -> None:
    server = FindStuffMCPServer(database_path)
    try:
        for line in sys.stdin:
            if not line.strip():
                continue
            try:
                message = json.loads(line)
                if not isinstance(message, dict):
                    raise ValueError("MCP message must be a JSON object")
                response = server.handle_message(message)
            except json.JSONDecodeError as exc:
                response = FindStuffMCPServer._error(None, -32700, f"Invalid JSON: {exc}")
            except Exception as exc:
                response = FindStuffMCPServer._error(None, -32603, str(exc))
            if response is not None:
                sys.stdout.write(json.dumps(response, separators=(",", ":"), default=str) + "\n")
                sys.stdout.flush()
    finally:
        server.close()


def main() -> None:
    serve_stdio()


if __name__ == "__main__":
    main()
