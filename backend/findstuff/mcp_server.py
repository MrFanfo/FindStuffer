from __future__ import annotations

import asyncio
import base64
import binascii
import json
import sqlite3
import sys
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx

from . import __version__
from .ai_commands import confirm_command
from .ai_scans import approve_scan, get_scan
from .backups import restore_status
from .category_icons import export_set as export_category_icons
from .category_marks import export_marks
from .compatibility import targets
from .config import get_settings
from .db import connect, migrate
from .documents import apply_document_extraction, delete_document, list_documents
from .enrichment import (
    apply_candidate,
    count_missing_enrichment,
    get_full_product_data,
    list_enrichment,
    queue_enrichment,
)
from .enrichment_export import export_category, export_location
from .extended import (
    add_shopping,
    check_shopping,
    duplicate_candidates,
    export_inventory,
    generate_low_stock_shopping,
    list_import_batches,
    list_loans,
    list_projects,
    list_shopping,
)
from .home import attention, preferences, save_preferences
from .human_search import list_aliases, search_learning_candidates
from .inventory import (
    InventoryError,
    add_item_relationship,
    adjust_quantity,
    archive_item,
    complete_maintenance_task,
    create_category,
    create_item,
    create_item_lot,
    create_location,
    create_maintenance_task,
    delete_category,
    delete_item_lot,
    delete_item_relationship,
    delete_location,
    get_item,
    item_history,
    list_categories,
    list_item_lots,
    list_item_relationships,
    list_items,
    list_location_rules,
    list_location_tree,
    list_location_types,
    list_maintenance_tasks,
    location_contents,
    move_item,
    restore_item,
    set_category_default_location,
    set_item_default_location,
    set_item_tags,
    update_category,
    update_item,
    update_item_lot,
    update_location,
)
from .mcp_admin_read import backup_listing, preview_import, software_status
from .mcp_ai import (
    create_ai_scan,
    get_ai_scan_photo,
    list_ai_scans,
    parse_ai_command,
    patch_ai_scan,
    read_ai_command,
    reject_ai_command,
    reject_ai_scan,
    retry_ai_scan,
)
from .mcp_discovery import (
    advanced_inventory_query,
    create_search_alias,
    delete_inventory_view,
    delete_search_alias,
    dismiss_search_candidate,
    get_analytics,
    get_dashboard,
    get_expiring,
    get_warranties,
    human_inventory_search,
    inventory_page,
    save_inventory_view,
)
from .mcp_extras import (
    get_category_mark,
    get_category_marks,
    import_category_icon_set,
    import_category_mark_set,
    import_provenance,
    owned,
    put_category_mark,
    remove_category_mark,
    suggest_icons,
)
from .mcp_media import (
    delete_project_attachment,
    document_content,
    patch_document,
    photo_content,
    project_attachment_content,
    run_document_extraction,
    upload_document,
    upload_project_attachment,
)
from .mcp_misc import bootstrap, health, sync_offline, transcribe_audio
from .mcp_planning import (
    create_loan_entry,
    create_reservation,
    delete_reservation,
    get_item_contents,
    get_item_extensions,
    get_project_candidates,
    get_target_detail,
    list_fields,
    project_action,
    return_loan_entry,
    save_planning_entity,
    stock_acquisition,
)
from .mcp_print import item_label, item_qr, location_label, location_qr
from .mcp_products import (
    barcode_decode,
    barcode_lookup,
    clear_item_enrichment,
    process_enrichment,
    queue_item_enrichment,
    queue_missing,
)
from .mcp_settings import (
    import_off_mappings,
    public_settings,
    save_category_data,
    save_inventory_display,
    save_units,
    set_off_mapping,
    units,
)
from .mcp_structure import (
    apply_consolidation,
    create_rule,
    create_type,
    delete_rule,
    get_category_contents,
    get_location,
    patch_rule,
    preview_consolidation,
    suggest_location,
)
from .metadata_enrichment import (
    accept_suggestion,
    create_export_request,
    import_response,
    list_suggestions,
    reject_suggestion,
    set_item_metadata,
)
from .off_categories import export_mappings, items_for_category, list_mappings
from .operations_contract import operations_template
from .photo_finder import find_item_photo
from .photos import MAX_PHOTO_BYTES, delete_photo, import_photo_from_url, list_photos, store_photo
from .projects import project_detail
from .saved_views import list_saved_views

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
        except (
            InventoryError,
            ValueError,
            TypeError,
            sqlite3.Error,
            httpx.HTTPError,
            OSError,
            RuntimeError,
        ) as exc:
            return {
                "isError": True,
                "content": [{"type": "text", "text": str(exc)}],
            }
        return {
            "content": [{"type": "text", "text": json.dumps(result, indent=2, default=str)}],
            "structuredContent": result,
        }

    def _build_tools(self) -> list[Tool]:
        tools = [
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
                "findstuff_find_photo_suggestion",
                "Search public images for an item and return a compact photo preview for review.",
                _schema(
                    {
                        "public_id": _string("Item public id."),
                        "result_index": _integer("Search result position, from 0 to 4."),
                    },
                    ["public_id"],
                ),
                self._find_photo_suggestion,
            ),
            Tool(
                "findstuff_upload_photo",
                "Upload a JPEG, PNG, or WebP photo to an item from base64 data (maximum 5 MB).",
                _schema(
                    {
                        "public_id": _string("Item public id."),
                        "data_base64": _string(
                            "Raw base64 image bytes, without a data URL prefix."
                        ),
                        "mime_type": _string("image/jpeg, image/png, or image/webp."),
                        "width": _integer("Optional pixel width."),
                        "height": _integer("Optional pixel height."),
                    },
                    ["public_id", "data_base64", "mime_type"],
                ),
                self._upload_photo,
            ),
            Tool(
                "findstuff_import_photo_from_url",
                "Add an item photo from an allowed public image URL.",
                _schema(
                    {
                        "public_id": _string("Item public id."),
                        "url": _string("Image URL on a configured allowed host."),
                    },
                    ["public_id", "url"],
                ),
                self._import_photo_from_url,
            ),
            Tool(
                "findstuff_delete_photo",
                "Delete an item photo by photo public id.",
                _schema({"public_id": _string("Photo public id.")}, ["public_id"]),
                self._delete_photo,
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
                "findstuff_create_category",
                "Create an inventory category under an optional parent category.",
                _schema(
                    {"name": _string(), "parent_id": _integer("Optional parent category id.")},
                    ["name"],
                ),
                self._create_category,
            ),
            Tool(
                "findstuff_update_category",
                "Edit a category's name, icon, or parent.",
                _schema(
                    {
                        "category_id": _integer("Category id."),
                        "changes": _object("Name, icon, or parent_id."),
                    },
                    ["category_id", "changes"],
                ),
                self._update_category,
            ),
            Tool(
                "findstuff_delete_category",
                "Delete an empty category.",
                _schema({"category_id": _integer("Category id.")}, ["category_id"]),
                self._delete_category,
            ),
            Tool(
                "findstuff_set_category_default_location",
                "Set or clear a category's default location.",
                _schema(
                    {
                        "category_id": _integer("Category id."),
                        "location_public_id": {"type": ["string", "null"]},
                    },
                    ["category_id", "location_public_id"],
                ),
                self._set_category_default_location,
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
                "findstuff_update_location",
                "Edit a location's name, kind, description, icon, or parent.",
                _schema(
                    {
                        "public_id": _string("Location public id."),
                        "changes": _object("Location fields to change."),
                    },
                    ["public_id", "changes"],
                ),
                self._update_location,
            ),
            Tool(
                "findstuff_delete_location",
                "Delete an empty location.",
                _schema({"public_id": _string("Location public id.")}, ["public_id"]),
                self._delete_location,
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
                "findstuff_archive_item",
                "Archive an item so it is hidden from ordinary inventory searches.",
                _schema({"public_id": _string("Item public id.")}, ["public_id"]),
                self._archive_item,
            ),
            Tool(
                "findstuff_restore_item",
                "Restore an archived item to the inventory.",
                _schema({"public_id": _string("Item public id.")}, ["public_id"]),
                self._restore_item,
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
                "findstuff_set_item_default_location",
                "Set an item's default location.",
                _schema(
                    {
                        "public_id": _string("Item public id."),
                        "location_public_id": {"type": ["string", "null"]},
                    },
                    ["public_id", "location_public_id"],
                ),
                self._set_item_default_location,
            ),
            Tool(
                "findstuff_create_item_lot",
                "Add a quantity lot with optional expiration date and note.",
                _schema(
                    {
                        "public_id": _string("Item public id."),
                        "quantity": _number("Positive lot quantity."),
                        "expiration_date": _string("Optional YYYY-MM-DD date."),
                        "note": _string(),
                    },
                    ["public_id", "quantity"],
                ),
                self._create_item_lot,
            ),
            Tool(
                "findstuff_update_item_lot",
                "Update an item's quantity lot.",
                _schema(
                    {
                        "public_id": _string("Item public id."),
                        "lot_public_id": _string("Lot public id."),
                        "changes": _object("Quantity, expiration_date, or note."),
                    },
                    ["public_id", "lot_public_id", "changes"],
                ),
                self._update_item_lot,
            ),
            Tool(
                "findstuff_delete_item_lot",
                "Delete an item's quantity lot.",
                _schema(
                    {
                        "public_id": _string("Item public id."),
                        "lot_public_id": _string("Lot public id."),
                    },
                    ["public_id", "lot_public_id"],
                ),
                self._delete_item_lot,
            ),
            Tool(
                "findstuff_create_maintenance_task",
                "Schedule recurring maintenance for an item.",
                _schema(
                    {
                        "public_id": _string("Item public id."),
                        "title": _string(),
                        "notes": _string(),
                        "interval_days": _integer("Days between tasks."),
                        "last_completed_at": _string("Optional YYYY-MM-DD date."),
                        "next_due_at": _string("YYYY-MM-DD date."),
                    },
                    ["public_id", "title", "interval_days", "next_due_at"],
                ),
                self._create_maintenance_task,
            ),
            Tool(
                "findstuff_complete_maintenance_task",
                "Mark an item's maintenance task complete and calculate its next due date.",
                _schema(
                    {
                        "public_id": _string("Item public id."),
                        "task_public_id": _string("Maintenance task public id."),
                    },
                    ["public_id", "task_public_id"],
                ),
                self._complete_maintenance_task,
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
                                        "Optional string, number, boolean, list, or object."
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
            Tool(
                "findstuff_generate_low_stock_shopping",
                "Add low-stock inventory items to the shopping list.",
                _schema({}),
                lambda _args: {"created": generate_low_stock_shopping(self.connection)},
            ),
        ]
        tools.extend(self._planning_tools())
        tools.extend(self._media_tools())
        tools.extend(self._structure_tools())
        tools.extend(self._discovery_tools())
        tools.extend(self._ai_tools())
        tools.extend(self._product_tools())
        tools.extend(self._extra_tools())
        tools.extend(self._print_tools())
        tools.extend(self._settings_tools())
        tools.extend(self._misc_tools())
        tools.extend(self._admin_read_tools())
        return tools

    def _planning_tools(self) -> list[Tool]:
        tools = [
            Tool(
                "findstuff_list_category_fields",
                "List custom field definitions, optionally for one category.",
                _schema({"category_id": _integer("Optional category id.")}),
                lambda args: list_fields(self.connection, args.get("category_id")),
            ),
            Tool(
                "findstuff_list_compatibility_targets",
                "List compatibility target families and aliases.",
                _schema({}),
                lambda _args: targets(self.connection),
            ),
            Tool(
                "findstuff_get_compatibility_target",
                "Get a target with linked inventory, matching items, and projects.",
                _schema(
                    {
                        "public_id": _string("Target public id."),
                        "offset": _integer("Offset for matching items."),
                    },
                    ["public_id"],
                ),
                lambda args: get_target_detail(
                    self.connection, str(args["public_id"]), int(args.get("offset") or 0)
                ),
            ),
            Tool(
                "findstuff_get_item_extensions",
                "Get an item's custom fields, compatibility, represented targets, and projects.",
                _schema({"public_id": _string("Item public id.")}, ["public_id"]),
                lambda args: get_item_extensions(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_list_projects",
                "List projects with requirements and reservations.",
                _schema({}),
                lambda _args: list_projects(self.connection),
            ),
            Tool(
                "findstuff_get_project",
                "Get complete project detail, requirements, budget, files, and progress.",
                _schema({"public_id": _string("Project public id.")}, ["public_id"]),
                lambda args: project_detail(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_project_candidates",
                "Find inventory candidates for a project or requirement.",
                _schema(
                    {
                        "public_id": _string("Project public id."),
                        "requirement_public_id": _string("Optional requirement public id."),
                        "query": _string("Item query."),
                        "offset": _integer("Result offset."),
                    },
                    ["public_id"],
                ),
                lambda args: get_project_candidates(self.connection, str(args["public_id"]), args),
            ),
            Tool(
                "findstuff_get_item_contents",
                "List items contained inside an inventory item.",
                _schema({"public_id": _string("Container item public id.")}, ["public_id"]),
                lambda args: get_item_contents(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_project_action",
                "Clone, finish, or record project outputs using an idempotent request id.",
                _schema(
                    {
                        "public_id": _string("Project public id."),
                        "values": _object(
                            "Project action payload: request_id, action, name, outputs."
                        ),
                    },
                    ["public_id", "values"],
                ),
                lambda args: project_action(self.connection, str(args["public_id"]), args),
            ),
            Tool(
                "findstuff_acquire_requirement_stock",
                "Add acquired requirement stock to inventory using an idempotent request id.",
                _schema(
                    {
                        "public_id": _string("Requirement public id."),
                        "values": _object("Acquired stock payload."),
                    },
                    ["public_id", "values"],
                ),
                lambda args: stock_acquisition(self.connection, str(args["public_id"]), args),
            ),
            Tool(
                "findstuff_reserve_project_item",
                "Reserve a quantity of an item for a project.",
                _schema(
                    {
                        "project_public_id": _string(),
                        "item_public_id": _string(),
                        "quantity": _number("Positive quantity."),
                    },
                    ["project_public_id", "item_public_id", "quantity"],
                ),
                lambda args: create_reservation(
                    self.connection, str(args["project_public_id"]), args
                ),
            ),
            Tool(
                "findstuff_release_project_item",
                "Remove an item's reservation from a project.",
                _schema(
                    {"project_public_id": _string(), "item_public_id": _string()},
                    ["project_public_id", "item_public_id"],
                ),
                lambda args: delete_reservation(
                    self.connection, str(args["project_public_id"]), str(args["item_public_id"])
                ),
            ),
            Tool(
                "findstuff_list_loans",
                "List active and optionally returned loans.",
                _schema({"include_returned": _boolean("Defaults to true.")}),
                lambda args: list_loans(
                    self.connection, include_returned=bool(args.get("include_returned", True))
                ),
            ),
            Tool(
                "findstuff_create_loan",
                "Record an item loan or borrowed item.",
                _schema(
                    {
                        "values": _object(
                            "item_public_id, direction, person, quantity, due_date, notes."
                        )
                    },
                    ["values"],
                ),
                lambda args: create_loan_entry(self.connection, args),
            ),
            Tool(
                "findstuff_return_loan",
                "Mark an active loan returned.",
                _schema({"public_id": _string("Loan public id.")}, ["public_id"]),
                lambda args: return_loan_entry(self.connection, str(args["public_id"])),
            ),
        ]
        for entity, label in (
            ("project", "project"),
            ("project_requirement", "project requirement"),
            ("category_field", "custom category field"),
            ("compatibility_target", "compatibility target"),
        ):
            tools.append(
                Tool(
                    f"findstuff_save_{entity}",
                    f"Create or update a {label}; pass public_id to update. "
                    "Values follow the validated Findstuff model.",
                    _schema(
                        {
                            "public_id": _string(f"Existing {label} public id."),
                            "values": _object(f"{label.title()} fields to create or patch."),
                        },
                        ["values"],
                    ),
                    lambda args, entity=entity: save_planning_entity(self.connection, entity, args),
                )
            )
        return tools

    def _media_tools(self) -> list[Tool]:
        return [
            Tool(
                "findstuff_get_photo_content",
                "Read a photo's bytes as base64.",
                _schema({"public_id": _string("Photo public id.")}, ["public_id"]),
                lambda args: photo_content(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_list_documents",
                "List an item's attached documents.",
                _schema({"item_public_id": _string("Item public id.")}, ["item_public_id"]),
                lambda args: list_documents(self.connection, str(args["item_public_id"])),
            ),
            Tool(
                "findstuff_upload_document",
                "Attach a PDF or image document to an item from base64 data (maximum 20 MB).",
                _schema(
                    {
                        "item_public_id": _string("Item public id."),
                        "data_base64": _string("Raw base64 document bytes."),
                        "mime_type": _string(
                            "application/pdf, image/jpeg, image/png, or image/webp."
                        ),
                        "filename": _string("Original filename."),
                        "title": _string("Optional display title."),
                        "document_type": _string(
                            "receipt, invoice, manual, certificate, warranty, or other."
                        ),
                        "purchase_date": _string("Optional YYYY-MM-DD date."),
                        "warranty_expires_at": _string("Optional YYYY-MM-DD date."),
                    },
                    ["item_public_id", "data_base64", "mime_type"],
                ),
                lambda args: upload_document(self.connection, args),
            ),
            Tool(
                "findstuff_get_document_content",
                "Read a document's bytes as base64.",
                _schema({"public_id": _string("Document public id.")}, ["public_id"]),
                lambda args: document_content(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_update_document",
                "Edit a document's title, type, purchase date, or warranty date.",
                _schema(
                    {
                        "public_id": _string("Document public id."),
                        "changes": _object("Document fields to patch."),
                    },
                    ["public_id", "changes"],
                ),
                lambda args: patch_document(self.connection, args),
            ),
            Tool(
                "findstuff_extract_document",
                "Run PDF text extraction or image OCR for a document.",
                _schema({"public_id": _string("Document public id.")}, ["public_id"]),
                lambda args: run_document_extraction(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_apply_document_extraction",
                "Apply extracted serial and date fields to an item document.",
                _schema({"public_id": _string("Document public id.")}, ["public_id"]),
                lambda args: apply_document_extraction(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_delete_document",
                "Delete an item document.",
                _schema({"public_id": _string("Document public id.")}, ["public_id"]),
                lambda args: self._delete_document(args),
            ),
            Tool(
                "findstuff_upload_project_file",
                "Attach a PDF or image file to a project from base64 data.",
                _schema(
                    {
                        "project_public_id": _string("Project public id."),
                        "data_base64": _string("Raw base64 file bytes."),
                        "mime_type": _string("PDF, JPEG, PNG, or WebP MIME type."),
                        "filename": _string("Original filename."),
                    },
                    ["project_public_id", "data_base64", "mime_type"],
                ),
                lambda args: upload_project_attachment(self.connection, args),
            ),
            Tool(
                "findstuff_get_project_file_content",
                "Read a project attachment's bytes as base64.",
                _schema({"public_id": _string("Project file public id.")}, ["public_id"]),
                lambda args: project_attachment_content(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_delete_project_file",
                "Remove a project attachment record.",
                _schema({"public_id": _string("Project file public id.")}, ["public_id"]),
                lambda args: delete_project_attachment(self.connection, str(args["public_id"])),
            ),
        ]

    def _delete_document(self, args: JsonObject) -> JsonObject:
        delete_document(self.connection, str(args["public_id"]))
        return {"deleted": True}

    def _structure_tools(self) -> list[Tool]:
        return [
            Tool(
                "findstuff_get_location",
                "Get one location and its details.",
                _schema({"public_id": _string("Location public id.")}, ["public_id"]),
                lambda args: get_location(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_category_contents",
                "List items and child categories within a category.",
                _schema(
                    {
                        "category_id": _integer("Category id."),
                        "recursive": _boolean("Include descendants; defaults to true."),
                    },
                    ["category_id"],
                ),
                lambda args: get_category_contents(
                    self.connection, int(args["category_id"]), bool(args.get("recursive", True))
                ),
            ),
            Tool(
                "findstuff_list_location_types",
                "List available location types.",
                _schema({}),
                lambda _args: list_location_types(self.connection),
            ),
            Tool(
                "findstuff_create_location_type",
                "Create or ensure a location type with an icon.",
                _schema({"name": _string(), "icon": _string("Defaults to pin.")}, ["name"]),
                lambda args: create_type(self.connection, args),
            ),
            Tool(
                "findstuff_list_location_rules",
                "List automatic location placement rules.",
                _schema({}),
                lambda _args: list_location_rules(self.connection),
            ),
            Tool(
                "findstuff_create_location_rule",
                "Create a name, barcode, or category placement rule.",
                _schema({"values": _object("Location rule fields.")}, ["values"]),
                lambda args: create_rule(self.connection, args["values"]),
            ),
            Tool(
                "findstuff_update_location_rule",
                "Edit an automatic location placement rule.",
                _schema(
                    {
                        "public_id": _string("Rule public id."),
                        "changes": _object("Rule fields to patch."),
                    },
                    ["public_id", "changes"],
                ),
                lambda args: patch_rule(self.connection, str(args["public_id"]), args["changes"]),
            ),
            Tool(
                "findstuff_delete_location_rule",
                "Delete an automatic location placement rule.",
                _schema({"public_id": _string("Rule public id.")}, ["public_id"]),
                lambda args: delete_rule(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_suggest_location",
                "Suggest a default location for a name, barcode, or category.",
                _schema({"name": _string(), "barcode": _string(), "category": _string()}),
                lambda args: suggest_location(self.connection, args),
            ),
            Tool(
                "findstuff_preview_category_consolidation",
                "Preview moving items from one category branch into another.",
                _schema(
                    {"source_id": _integer(), "target_id": _integer()}, ["source_id", "target_id"]
                ),
                lambda args: preview_consolidation(
                    self.connection, int(args["source_id"]), int(args["target_id"])
                ),
            ),
            Tool(
                "findstuff_consolidate_categories",
                "Apply a category consolidation using the current preview token.",
                _schema(
                    {
                        "source_id": _integer(),
                        "target_id": _integer(),
                        "token": _string("Token from preview."),
                    },
                    ["source_id", "target_id", "token"],
                ),
                lambda args: apply_consolidation(
                    self.connection,
                    int(args["source_id"]),
                    int(args["target_id"]),
                    str(args["token"]),
                ),
            ),
        ]

    def _discovery_tools(self) -> list[Tool]:
        return [
            Tool(
                "findstuff_inventory_page",
                "Page through inventory with filters and an optional cursor.",
                _schema(
                    {
                        "query": _string(),
                        "location_public_id": _string(),
                        "category_id": _integer(),
                        "low_stock": _boolean(),
                        "needs_details": _boolean(),
                        "include_archived": _boolean(),
                        "archived_only": _boolean(),
                        "include_zero": _boolean(),
                        "limit": _integer("1-250 items."),
                        "cursor": _string(),
                    }
                ),
                lambda args: inventory_page(self.connection, args),
            ),
            Tool(
                "findstuff_advanced_inventory_query",
                "Filter and sort inventory with tags, compatibility, and formulas.",
                _schema(
                    {
                        "query": _string(),
                        "filter": _string(),
                        "sort": _string(),
                        "location_public_id": _string(),
                        "category_id": _integer(),
                        "tag": _string(),
                        "compatibility": _string(),
                        "include_zero": _boolean(),
                        "formula": _object(),
                        "limit": _integer("1-250 items."),
                        "cursor": _string(),
                    }
                ),
                lambda args: advanced_inventory_query(self.connection, args),
            ),
            Tool(
                "findstuff_human_search",
                "Search inventory with aliases and learning suggestions.",
                _schema(
                    {
                        "query": _string(),
                        "include_zero": _boolean(),
                        "limit": _integer(),
                        "cursor": _string(),
                    },
                    ["query"],
                ),
                lambda args: human_inventory_search(self.connection, args),
            ),
            Tool(
                "findstuff_list_search_aliases",
                "List search aliases.",
                _schema({}),
                lambda _args: list_aliases(self.connection),
            ),
            Tool(
                "findstuff_create_search_alias",
                "Create a term, item, or location search alias.",
                _schema({"values": _object("Search alias fields.")}, ["values"]),
                lambda args: create_search_alias(self.connection, args["values"]),
            ),
            Tool(
                "findstuff_delete_search_alias",
                "Delete a search alias.",
                _schema({"public_id": _string("Alias public id.")}, ["public_id"]),
                lambda args: delete_search_alias(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_search_learning_candidates",
                "List frequent searches with no matches.",
                _schema({}),
                lambda _args: search_learning_candidates(self.connection),
            ),
            Tool(
                "findstuff_dismiss_search_candidate",
                "Dismiss a no-result search suggestion.",
                _schema({"query": _string()}, ["query"]),
                lambda args: dismiss_search_candidate(self.connection, str(args["query"])),
            ),
            Tool(
                "findstuff_list_saved_views",
                "List saved inventory views.",
                _schema({}),
                lambda _args: list_saved_views(self.connection),
            ),
            Tool(
                "findstuff_save_view",
                "Save an inventory view with optimistic revision checking.",
                _schema(
                    {
                        "public_id": _string("View id."),
                        "request": _object("view and expected_revision."),
                    },
                    ["public_id", "request"],
                ),
                lambda args: save_inventory_view(self.connection, args),
            ),
            Tool(
                "findstuff_delete_view",
                "Delete a saved inventory view at its current revision.",
                _schema(
                    {"public_id": _string("View id."), "revision": _integer("Current revision.")},
                    ["public_id", "revision"],
                ),
                lambda args: delete_inventory_view(
                    self.connection, str(args["public_id"]), int(args["revision"])
                ),
            ),
            Tool(
                "findstuff_dashboard",
                "Get the inventory dashboard summary.",
                _schema({}),
                lambda _args: get_dashboard(self.connection),
            ),
            Tool(
                "findstuff_attention",
                "Get dashboard attention items.",
                _schema({}),
                lambda _args: attention(self.connection),
            ),
            Tool(
                "findstuff_analytics",
                "Get inventory analytics for 7-3650 days.",
                _schema({"days": _integer("Defaults to 90."), "include_imports": _boolean()}),
                lambda args: get_analytics(
                    self.connection,
                    int(args.get("days") or 90),
                    bool(args.get("include_imports", False)),
                ),
            ),
            Tool(
                "findstuff_expiring_items",
                "List inventory expiring within a number of days.",
                _schema({"days": _integer("Defaults to 14.")}),
                lambda args: get_expiring(self.connection, int(args.get("days", 14))),
            ),
            Tool(
                "findstuff_warranties_due",
                "List item warranties due within a number of days.",
                _schema({"days": _integer("Defaults to 30.")}),
                lambda args: get_warranties(self.connection, int(args.get("days", 30))),
            ),
            Tool(
                "findstuff_get_preferences",
                "Get home screen preferences.",
                _schema({}),
                lambda _args: preferences(self.connection),
            ),
            Tool(
                "findstuff_save_preferences",
                "Update home screen preferences.",
                _schema({"values": _object("Preference changes.")}, ["values"]),
                lambda args: save_preferences(self.connection, args["values"]),
            ),
        ]

    def _ai_tools(self) -> list[Tool]:
        return [
            Tool(
                "findstuff_parse_ai_command",
                "Parse a natural-language inventory command into a reviewable proposal.",
                _schema({"text": _string("Command text.")}, ["text"]),
                lambda args: parse_ai_command(self.connection, str(args["text"])),
            ),
            Tool(
                "findstuff_get_ai_command",
                "Get an AI command proposal and status.",
                _schema({"public_id": _string("Command public id.")}, ["public_id"]),
                lambda args: read_ai_command(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_confirm_ai_command",
                "Apply a previously reviewed AI command proposal.",
                _schema({"public_id": _string("Command public id.")}, ["public_id"]),
                lambda args: confirm_command(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_reject_ai_command",
                "Reject a pending AI command proposal.",
                _schema({"public_id": _string("Command public id.")}, ["public_id"]),
                lambda args: reject_ai_command(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_create_ai_scan",
                "Upload an image for AI recognition and return its proposal.",
                _schema(
                    {
                        "location_public_id": _string("Location public id."),
                        "data_base64": _string("Raw base64 JPEG, PNG, or WebP bytes."),
                        "mime_type": _string("Image MIME type."),
                        "width": _integer(),
                        "height": _integer(),
                        "original_size_bytes": _integer(),
                    },
                    ["location_public_id", "data_base64", "mime_type"],
                ),
                lambda args: create_ai_scan(self.connection, args),
            ),
            Tool(
                "findstuff_list_ai_scans",
                "List AI scan proposals by comma-separated statuses.",
                _schema({"status": _string("Defaults to processing,pending,failed.")}),
                lambda args: list_ai_scans(
                    self.connection, str(args.get("status") or "processing,pending,failed")
                ),
            ),
            Tool(
                "findstuff_get_ai_scan",
                "Get an AI scan proposal.",
                _schema({"public_id": _string("Scan public id.")}, ["public_id"]),
                lambda args: get_scan(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_get_ai_scan_photo",
                "Read an AI scan photo as base64.",
                _schema({"public_id": _string("Scan public id.")}, ["public_id"]),
                lambda args: get_ai_scan_photo(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_update_ai_scan",
                "Edit a pending AI scan proposal.",
                _schema(
                    {
                        "public_id": _string("Scan public id."),
                        "changes": _object("Proposal item and location fields."),
                    },
                    ["public_id", "changes"],
                ),
                lambda args: patch_ai_scan(
                    self.connection, str(args["public_id"]), args["changes"]
                ),
            ),
            Tool(
                "findstuff_approve_ai_scan",
                "Approve a pending AI scan and create its inventory item.",
                _schema({"public_id": _string("Scan public id.")}, ["public_id"]),
                lambda args: approve_scan(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_reject_ai_scan",
                "Reject a pending or failed AI scan.",
                _schema({"public_id": _string("Scan public id.")}, ["public_id"]),
                lambda args: reject_ai_scan(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_retry_ai_scan",
                "Retry recognition for a failed AI scan.",
                _schema({"public_id": _string("Scan public id.")}, ["public_id"]),
                lambda args: retry_ai_scan(self.connection, str(args["public_id"])),
            ),
        ]

    def _product_tools(self) -> list[Tool]:
        return [
            Tool(
                "findstuff_lookup_barcode",
                "Look up a barcode from the configured product providers.",
                _schema({"code": _string("Barcode.")}, ["code"]),
                lambda args: barcode_lookup(self.connection, str(args["code"]), False),
            ),
            Tool(
                "findstuff_refresh_barcode",
                "Refresh product data for a barcode.",
                _schema({"code": _string("Barcode.")}, ["code"]),
                lambda args: barcode_lookup(self.connection, str(args["code"]), True),
            ),
            Tool(
                "findstuff_decode_barcode_image",
                "Decode a barcode from a base64 image.",
                _schema(
                    {
                        "data_base64": _string("Raw image bytes as base64."),
                        "mime_type": _string("Image MIME type."),
                    },
                    ["data_base64", "mime_type"],
                ),
                lambda args: barcode_decode(args),
            ),
            Tool(
                "findstuff_get_item_enrichment",
                "Get enrichment history for an item.",
                _schema({"public_id": _string("Item public id.")}, ["public_id"]),
                lambda args: list_enrichment(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_get_full_product_data",
                "Get full product enrichment data for an item.",
                _schema({"public_id": _string("Item public id.")}, ["public_id"]),
                lambda args: get_full_product_data(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_queue_item_enrichment",
                "Queue product enrichment for an item, optionally refreshing it.",
                _schema(
                    {
                        "public_id": _string("Item public id."),
                        "refresh": _boolean("Force a refresh."),
                    },
                    ["public_id"],
                ),
                lambda args: queue_item_enrichment(
                    self.connection, str(args["public_id"]), bool(args.get("refresh", False))
                ),
            ),
            Tool(
                "findstuff_clear_item_enrichment",
                "Clear an item's enrichment history.",
                _schema({"public_id": _string("Item public id.")}, ["public_id"]),
                lambda args: clear_item_enrichment(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_run_enrichment",
                "Process up to three queued enrichment jobs.",
                _schema({}),
                lambda _args: process_enrichment(self.connection),
            ),
            Tool(
                "findstuff_queue_missing_enrichment",
                "Queue missing product enrichment for up to 250 items.",
                _schema({"limit": _integer("Defaults to 25.")}),
                lambda args: queue_missing(self.connection, int(args.get("limit") or 25)),
            ),
            Tool(
                "findstuff_enrichment_status",
                "Count items still missing enrichment.",
                _schema({}),
                lambda _args: {"missing": count_missing_enrichment(self.connection)},
            ),
            Tool(
                "findstuff_apply_enrichment_candidate",
                "Apply a reviewed enrichment candidate.",
                _schema({"public_id": _string("Candidate public id.")}, ["public_id"]),
                lambda args: apply_candidate(self.connection, str(args["public_id"])),
            ),
        ]

    def _extra_tools(self) -> list[Tool]:
        return [
            Tool(
                "findstuff_item_duplicates",
                "Find likely duplicate inventory items.",
                _schema({"public_id": _string("Item public id.")}, ["public_id"]),
                lambda args: duplicate_candidates(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_item_import_provenance",
                "Get import operations that created or changed an item.",
                _schema({"public_id": _string("Item public id.")}, ["public_id"]),
                lambda args: import_provenance(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_owned",
                "Check whether inventory already contains an item matching a query.",
                _schema({"query": _string("Item query.")}, ["query"]),
                lambda args: owned(self.connection, str(args["query"])),
            ),
            Tool(
                "findstuff_list_category_marks",
                "List available category mark names.",
                _schema({}),
                lambda _args: get_category_marks(),
            ),
            Tool(
                "findstuff_get_category_mark",
                "Get one category mark's sanitized SVG.",
                _schema({"name": _string("Mark name.")}, ["name"]),
                lambda args: get_category_mark(str(args["name"])),
            ),
            Tool(
                "findstuff_save_category_mark",
                "Save a sanitized SVG category mark.",
                _schema(
                    {"name": _string("Mark name."), "svg": _string("SVG drawing.")}, ["name", "svg"]
                ),
                lambda args: put_category_mark(str(args["name"]), str(args["svg"])),
            ),
            Tool(
                "findstuff_delete_category_mark",
                "Delete a category mark.",
                _schema({"name": _string("Mark name.")}, ["name"]),
                lambda args: remove_category_mark(str(args["name"])),
            ),
            Tool(
                "findstuff_export_category_marks",
                "Export all category mark drawings.",
                _schema({}),
                lambda _args: export_marks(),
            ),
            Tool(
                "findstuff_import_category_marks",
                "Preview or apply a validated category mark set.",
                _schema(
                    {
                        "payload": _object("Category mark set."),
                        "apply": _boolean("Defaults to preview only."),
                    },
                    ["payload"],
                ),
                lambda args: import_category_mark_set(
                    args["payload"], bool(args.get("apply", False))
                ),
            ),
            Tool(
                "findstuff_suggest_category_icons",
                "Suggest icons for categories, optionally overwriting choices.",
                _schema({"overwrite": _boolean("Defaults to false.")}),
                lambda args: suggest_icons(self.connection, bool(args.get("overwrite", False))),
            ),
            Tool(
                "findstuff_export_category_icons",
                "Export category icon choices.",
                _schema({}),
                lambda _args: export_category_icons(self.connection),
            ),
            Tool(
                "findstuff_import_category_icons",
                "Preview or apply category icon choices.",
                _schema(
                    {
                        "payload": _object("Category icon set."),
                        "apply": _boolean("Defaults to preview only."),
                    },
                    ["payload"],
                ),
                lambda args: import_category_icon_set(
                    self.connection, args["payload"], bool(args.get("apply", False))
                ),
            ),
            Tool(
                "findstuff_export_category_enrichment",
                "Export one category branch for external enrichment.",
                _schema(
                    {
                        "category_id": _integer("Category id."),
                        "include_children": _boolean("Defaults to true."),
                    },
                    ["category_id"],
                ),
                lambda args: export_category(
                    self.connection,
                    int(args["category_id"]),
                    include_children=bool(args.get("include_children", True)),
                ),
            ),
            Tool(
                "findstuff_export_location_enrichment",
                "Export one location branch for external enrichment.",
                _schema(
                    {
                        "public_id": _string("Location public id."),
                        "include_children": _boolean("Defaults to true."),
                    },
                    ["public_id"],
                ),
                lambda args: export_location(
                    self.connection,
                    str(args["public_id"]),
                    include_children=bool(args.get("include_children", True)),
                ),
            ),
        ]

    def _print_tools(self) -> list[Tool]:
        return [
            Tool(
                "findstuff_item_qr",
                "Generate an item's SVG QR code for a Findstuff base URL.",
                _schema(
                    {
                        "public_id": _string("Item public id."),
                        "base_url": _string("Public Findstuff base URL."),
                    },
                    ["public_id", "base_url"],
                ),
                lambda args: item_qr(
                    self.connection, str(args["public_id"]), str(args["base_url"])
                ),
            ),
            Tool(
                "findstuff_location_qr",
                "Generate a location's SVG QR code for a Findstuff base URL.",
                _schema(
                    {
                        "public_id": _string("Location public id."),
                        "base_url": _string("Public Findstuff base URL."),
                        "color": _string("Six-digit hex color; defaults to #4923A8."),
                    },
                    ["public_id", "base_url"],
                ),
                lambda args: location_qr(
                    self.connection,
                    str(args["public_id"]),
                    str(args["base_url"]),
                    str(args.get("color") or "#4923A8"),
                ),
            ),
            Tool(
                "findstuff_item_label",
                "Generate printable HTML for an item label.",
                _schema({"public_id": _string("Item public id.")}, ["public_id"]),
                lambda args: item_label(self.connection, str(args["public_id"])),
            ),
            Tool(
                "findstuff_location_label",
                "Generate printable HTML for a location label.",
                _schema({"public_id": _string("Location public id.")}, ["public_id"]),
                lambda args: location_label(self.connection, str(args["public_id"])),
            ),
        ]

    def _settings_tools(self) -> list[Tool]:
        return [
            Tool(
                "findstuff_get_settings",
                "Get public application settings and system information without secrets.",
                _schema({}),
                lambda _args: public_settings(self.connection),
            ),
            Tool(
                "findstuff_get_units",
                "List inventory units.",
                _schema({}),
                lambda _args: units(self.connection),
            ),
            Tool(
                "findstuff_save_units",
                "Replace the inventory unit list.",
                _schema({"units": _array(_string(), "Unit names.")}, ["units"]),
                lambda args: save_units(self.connection, args),
            ),
            Tool(
                "findstuff_save_category_data_settings",
                "Update category data-capability overrides.",
                _schema({"overrides": _object("Category override map.")}, ["overrides"]),
                lambda args: save_category_data(self.connection, args),
            ),
            Tool(
                "findstuff_save_inventory_display_settings",
                "Update inventory display flags.",
                _schema({"values": _object("Display flags.")}, ["values"]),
                lambda args: save_inventory_display(self.connection, args["values"]),
            ),
            Tool(
                "findstuff_list_off_category_mappings",
                "List Open Food Facts category observations and mappings.",
                _schema({}),
                lambda _args: list_mappings(self.connection),
            ),
            Tool(
                "findstuff_set_off_category_mapping",
                "Set or clear an Open Food Facts category mapping.",
                _schema(
                    {
                        "off_tag": _string("Open Food Facts tag."),
                        "category_id": {"type": ["integer", "null"]},
                    },
                    ["off_tag", "category_id"],
                ),
                lambda args: set_off_mapping(self.connection, str(args["off_tag"]), args),
            ),
            Tool(
                "findstuff_off_category_items",
                "List items associated with an Open Food Facts category tag.",
                _schema({"off_tag": _string("Open Food Facts tag.")}, ["off_tag"]),
                lambda args: items_for_category(self.connection, str(args["off_tag"])),
            ),
            Tool(
                "findstuff_export_off_category_mappings",
                "Export Open Food Facts category mappings.",
                _schema({}),
                lambda _args: export_mappings(self.connection),
            ),
            Tool(
                "findstuff_import_off_category_mappings",
                "Preview or apply Open Food Facts category mappings.",
                _schema(
                    {
                        "payload": _object("Category mapping export."),
                        "apply": _boolean("Defaults to preview only."),
                    },
                    ["payload"],
                ),
                lambda args: import_off_mappings(
                    self.connection, args["payload"], bool(args.get("apply", False))
                ),
            ),
        ]

    def _misc_tools(self) -> list[Tool]:
        return [
            Tool(
                "findstuff_health",
                "Get the Findstuff backend version and health status.",
                _schema({}),
                lambda _args: health(),
            ),
            Tool(
                "findstuff_bootstrap",
                "Get initial inventory, dashboard, categories, locations, units, and user context.",
                _schema(
                    {
                        "query": _string(),
                        "include_zero": _boolean(),
                        "limit": _integer("1-2000, defaults to 100."),
                    }
                ),
                lambda args: bootstrap(self.connection, args),
            ),
            Tool(
                "findstuff_sync_offline_operation",
                "Apply an idempotent offline create-item or quantity-change operation.",
                _schema(
                    {
                        "operation_id": _string("Unique operation id."),
                        "kind": _string("create_item or adjust_quantity."),
                        "payload": _object("Operation payload."),
                    },
                    ["operation_id", "kind", "payload"],
                ),
                lambda args: sync_offline(self.connection, args),
            ),
            Tool(
                "findstuff_transcribe_voice",
                "Transcribe a base64 audio file using the configured speech service.",
                _schema(
                    {
                        "data_base64": _string("Raw audio bytes as base64."),
                        "mime_type": _string("Audio MIME type."),
                        "filename": _string("Optional filename."),
                    },
                    ["data_base64"],
                ),
                lambda args: transcribe_audio(args),
            ),
        ]

    def _admin_read_tools(self) -> list[Tool]:
        return [
            Tool(
                "findstuff_export_inventory",
                "Export inventory data as Findstuff JSON.",
                _schema({}),
                lambda _args: export_inventory(self.connection),
            ),
            Tool(
                "findstuff_operations_template",
                "Get the import operations template and field guide.",
                _schema({}),
                lambda _args: operations_template(self.connection),
            ),
            Tool(
                "findstuff_list_backups",
                "List stored backup metadata.",
                _schema({}),
                lambda _args: backup_listing(),
            ),
            Tool(
                "findstuff_restore_status",
                "Get backup restore status.",
                _schema({}),
                lambda _args: restore_status(),
            ),
            Tool(
                "findstuff_preview_import",
                "Validate and dry-run an import payload without applying it.",
                _schema({"payload": _object("Findstuff import document.")}, ["payload"]),
                lambda args: preview_import(self.connection, args["payload"]),
            ),
            Tool(
                "findstuff_list_import_batches",
                "List recent import batches and their undo status.",
                _schema({}),
                lambda _args: list_import_batches(self.connection),
            ),
            Tool(
                "findstuff_software_update_status",
                "Get software update status without requesting an update.",
                _schema({}),
                lambda _args: software_status(),
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

    def _find_photo_suggestion(self, args: JsonObject) -> JsonObject:
        result_index = args.get("result_index", 0)
        if type(result_index) is not int or not 0 <= result_index <= 4:
            raise ValueError("result_index must be between 0 and 4")
        return asyncio.run(find_item_photo(self.connection, str(args["public_id"]), result_index))

    def _upload_photo(self, args: JsonObject) -> JsonObject:
        encoded = str(args["data_base64"])
        if len(encoded) > ((MAX_PHOTO_BYTES + 2) // 3) * 4:
            raise ValueError("Photo exceeds the 5 MB limit")
        try:
            data = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("Invalid base64 photo data") from exc
        width = args.get("width")
        height = args.get("height")
        if width is not None and (type(width) is not int or width < 1):
            raise ValueError("width must be a positive integer")
        if height is not None and (type(height) is not int or height < 1):
            raise ValueError("height must be a positive integer")
        return store_photo(
            self.connection, str(args["public_id"]), data, str(args["mime_type"]), width, height
        )

    def _import_photo_from_url(self, args: JsonObject) -> JsonObject:
        return asyncio.run(
            import_photo_from_url(self.connection, str(args["public_id"]), str(args["url"]))
        )

    def _delete_photo(self, args: JsonObject) -> JsonObject:
        delete_photo(self.connection, str(args["public_id"]))
        return {"deleted": True}

    def _location_contents(self, args: JsonObject) -> JsonObject:
        return location_contents(
            self.connection,
            str(args["public_id"]),
            recursive=bool(args.get("recursive", True)),
        )

    def _create_category(self, args: JsonObject) -> JsonObject:
        parent_id = args.get("parent_id")
        return create_category(
            self.connection, str(args["name"]), int(parent_id) if parent_id is not None else None
        )

    def _update_category(self, args: JsonObject) -> JsonObject:
        changes = dict(args["changes"])
        if set(changes) - {"name", "icon", "parent_id"}:
            raise ValueError("Unsupported category fields")
        return update_category(self.connection, int(args["category_id"]), changes)

    def _delete_category(self, args: JsonObject) -> JsonObject:
        delete_category(self.connection, int(args["category_id"]))
        return {"deleted": True}

    def _set_category_default_location(self, args: JsonObject) -> JsonObject:
        return set_category_default_location(
            self.connection, int(args["category_id"]), args["location_public_id"]
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

    def _update_location(self, args: JsonObject) -> JsonObject:
        changes = dict(args["changes"])
        if set(changes) - {"name", "kind", "description", "parent_public_id", "icon"}:
            raise ValueError("Unsupported location fields")
        return update_location(self.connection, str(args["public_id"]), changes)

    def _delete_location(self, args: JsonObject) -> JsonObject:
        delete_location(self.connection, str(args["public_id"]))
        return {"deleted": True}

    def _create_item(self, args: JsonObject) -> JsonObject:
        values = dict(args["values"])
        return create_item(self.connection, values, source="mcp")

    def _update_item(self, args: JsonObject) -> JsonObject:
        changes = dict(args["changes"])
        changes["expected_version"] = int(args["expected_version"])
        return update_item(self.connection, str(args["public_id"]), changes, source="mcp")

    def _archive_item(self, args: JsonObject) -> JsonObject:
        archive_item(self.connection, str(args["public_id"]))
        return {"archived": True}

    def _restore_item(self, args: JsonObject) -> JsonObject:
        return restore_item(self.connection, str(args["public_id"]))

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

    def _set_item_default_location(self, args: JsonObject) -> JsonObject:
        return set_item_default_location(
            self.connection, str(args["public_id"]), args["location_public_id"]
        )

    def _create_item_lot(self, args: JsonObject) -> JsonObject:
        values = {key: args[key] for key in ("quantity", "expiration_date", "note") if key in args}
        if Decimal(str(values["quantity"])) <= 0:
            raise ValueError("Lot quantity must be positive")
        return create_item_lot(self.connection, str(args["public_id"]), values)

    def _update_item_lot(self, args: JsonObject) -> JsonObject:
        changes = dict(args["changes"])
        if set(changes) - {"quantity", "expiration_date", "note"}:
            raise ValueError("Unsupported lot fields")
        if "quantity" in changes and Decimal(str(changes["quantity"])) < 0:
            raise ValueError("Lot quantity cannot be negative")
        return update_item_lot(
            self.connection, str(args["public_id"]), str(args["lot_public_id"]), changes
        )

    def _delete_item_lot(self, args: JsonObject) -> JsonObject:
        delete_item_lot(self.connection, str(args["public_id"]), str(args["lot_public_id"]))
        return {"deleted": True}

    def _create_maintenance_task(self, args: JsonObject) -> JsonObject:
        values = {
            key: args[key]
            for key in ("title", "notes", "interval_days", "last_completed_at", "next_due_at")
            if key in args
        }
        if not 1 <= int(values["interval_days"]) <= 3650:
            raise ValueError("interval_days must be between 1 and 3650")
        return create_maintenance_task(self.connection, str(args["public_id"]), values)

    def _complete_maintenance_task(self, args: JsonObject) -> JsonObject:
        return complete_maintenance_task(
            self.connection, str(args["public_id"]), str(args["task_public_id"])
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
            raise ValueError("Unsupported enrichment update fields: " + ", ".join(unsupported))
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
