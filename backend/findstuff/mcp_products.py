"""Barcode lookup and enrichment operations for MCP."""

from __future__ import annotations

import asyncio
import sqlite3
from typing import Any

from .barcodes import IMAGE_DECODE_LIMIT_BYTES, decode_image_code, lookup_barcode
from .enrichment import (
    clear_enrichment_history,
    queue_enrichment,
    queue_missing_enrichment,
    run_pending,
)
from .mcp_media import decode_file

JsonObject = dict[str, Any]


def barcode_lookup(connection: sqlite3.Connection, code: str, refresh: bool) -> JsonObject:
    return asyncio.run(lookup_barcode(connection, code, refresh=refresh))


def barcode_decode(args: JsonObject) -> JsonObject:
    data = decode_file(str(args["data_base64"]), IMAGE_DECODE_LIMIT_BYTES)
    return {"code": decode_image_code(data, str(args["mime_type"]))}


def queue_item_enrichment(
    connection: sqlite3.Connection, public_id: str, refresh: bool
) -> JsonObject:
    return queue_enrichment(connection, public_id, refresh=refresh)


def clear_item_enrichment(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    clear_enrichment_history(connection, public_id)
    return {"cleared": True}


def process_enrichment(connection: sqlite3.Connection) -> JsonObject:
    return {"processed": asyncio.run(run_pending(connection, limit=3))}


def queue_missing(connection: sqlite3.Connection, limit: int) -> JsonObject:
    if not 1 <= limit <= 250:
        raise ValueError("limit must be between 1 and 250")
    return {"queued": queue_missing_enrichment(connection, limit=limit)}
