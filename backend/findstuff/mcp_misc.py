"""Small system, offline, and voice actions exposed through MCP."""

from __future__ import annotations

import asyncio
import sqlite3
from io import BytesIO
from typing import Any

from fastapi import HTTPException
from starlette.datastructures import Headers, UploadFile

from . import __version__
from .mcp_media import decode_file
from .offline import apply_offline_operation
from .schemas import OfflineOperation

JsonObject = dict[str, Any]


def health() -> JsonObject:
    return {"status": "ok", "version": __version__}


def bootstrap(connection: sqlite3.Connection, args: JsonObject) -> JsonObject:
    from .app import bootstrap as app_bootstrap

    limit = int(args.get("limit") or 100)
    if not 1 <= limit <= 2000:
        raise ValueError("limit must be between 1 and 2000")
    return asyncio.run(
        app_bootstrap(
            connection,
            q=str(args.get("query") or ""),
            include_zero=bool(args.get("include_zero", False)),
            limit=limit,
        )
    )


def sync_offline(connection: sqlite3.Connection, args: JsonObject) -> JsonObject:
    values = OfflineOperation.model_validate(args)
    return apply_offline_operation(connection, values.operation_id, values.kind, values.payload)


def transcribe_audio(args: JsonObject) -> JsonObject:
    from .app import transcribe_voice

    data = decode_file(str(args["data_base64"]), 10 * 1024 * 1024)
    upload = UploadFile(
        file=BytesIO(data),
        filename=str(args.get("filename") or "voice.webm"),
        headers=Headers({"content-type": str(args.get("mime_type") or "audio/webm")}),
    )
    try:
        return asyncio.run(transcribe_voice(upload))
    except HTTPException as exc:
        raise ValueError(str(exc.detail)) from exc
