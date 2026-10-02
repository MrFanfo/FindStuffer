"""Scoped AI command and photo-scan operations for MCP."""

from __future__ import annotations

import asyncio
import base64
import json
import sqlite3
from pathlib import Path
from typing import Any

from .ai_commands import get_command, parse_command, reject_command
from .ai_scans import (
    create_scan,
    get_scan,
    list_scans,
    process_scan,
    reject_scan,
    retry_scan,
    scan_photo_path,
    update_scan,
)
from .mcp_media import decode_file
from .photos import MAX_PHOTO_BYTES
from .schemas import AIScanProposalPatch

JsonObject = dict[str, Any]


def _database_path(connection: sqlite3.Connection) -> Path:
    return Path(connection.execute("PRAGMA database_list").fetchone()["file"])


def parse_ai_command(connection: sqlite3.Connection, text: str) -> JsonObject:
    if not 1 <= len(text.strip()) <= 2000:
        raise ValueError("Command text must be 1-2000 characters")
    return asyncio.run(parse_command(connection, text))


def read_ai_command(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    row = get_command(connection, public_id)
    return {
        "public_id": row["public_id"],
        "raw_text": row["raw_text"],
        "status": row["status"],
        "proposal": json.loads(row["resolved_json"]) if row["resolved_json"] else None,
        "error": row["error"],
        "created_at": row["created_at"],
    }


def reject_ai_command(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    reject_command(connection, public_id)
    return {"rejected": True}


def create_ai_scan(connection: sqlite3.Connection, args: JsonObject) -> JsonObject:
    data = decode_file(str(args["data_base64"]), MAX_PHOTO_BYTES)
    scan = create_scan(
        connection,
        location_public_id=str(args["location_public_id"]),
        data=data,
        declared_type=str(args["mime_type"]),
        width=args.get("width"),
        height=args.get("height"),
        original_size_bytes=args.get("original_size_bytes"),
    )
    asyncio.run(process_scan(scan["public_id"], _database_path(connection)))
    return get_scan(connection, scan["public_id"])


def list_ai_scans(connection: sqlite3.Connection, status: str) -> list[JsonObject]:
    return list_scans(connection, {value.strip() for value in status.split(",") if value.strip()})


def get_ai_scan_photo(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    path, mime_type = scan_photo_path(connection, public_id)
    if not path.is_file():
        raise ValueError("AI scan photo not found")
    return {
        "public_id": public_id,
        "mime_type": mime_type,
        "data_base64": base64.b64encode(path.read_bytes()).decode("ascii"),
    }


def patch_ai_scan(connection: sqlite3.Connection, public_id: str, args: JsonObject) -> JsonObject:
    changes = AIScanProposalPatch.model_validate(args).model_dump(mode="json", exclude_unset=True)
    return update_scan(connection, public_id, changes)


def reject_ai_scan(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    reject_scan(connection, public_id)
    return {"rejected": True}


def retry_ai_scan(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    scan = retry_scan(connection, public_id)
    asyncio.run(process_scan(public_id, _database_path(connection)))
    return get_scan(connection, scan["public_id"])
