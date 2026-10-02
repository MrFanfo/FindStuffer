"""Explicit item document and project attachment operations for MCP."""

from __future__ import annotations

import asyncio
import base64
import binascii
import sqlite3
from io import BytesIO
from pathlib import Path
from typing import Any

from starlette.datastructures import Headers, UploadFile

from .config import get_settings
from .documents import (
    MAX_DOCUMENT_BYTES,
    extract_document_text,
    get_document,
    get_document_path,
    store_document,
    update_document,
)

JsonObject = dict[str, Any]


def decode_file(encoded: str, max_bytes: int = MAX_DOCUMENT_BYTES) -> bytes:
    if len(encoded) > ((max_bytes + 2) // 3) * 4:
        raise ValueError(f"File exceeds the {max_bytes // (1024 * 1024)} MB limit")
    try:
        return base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64 file data") from exc


def upload_document(connection: sqlite3.Connection, args: JsonObject) -> JsonObject:
    data = decode_file(str(args["data_base64"]))
    result = store_document(
        connection,
        str(args["item_public_id"]),
        data,
        str(args["mime_type"]),
        str(args.get("filename") or ""),
        str(args.get("title") or ""),
        str(args.get("document_type") or "other"),
        args.get("purchase_date"),
        args.get("warranty_expires_at"),
    )
    return result


def patch_document(connection: sqlite3.Connection, args: JsonObject) -> JsonObject:
    from .schemas import DocumentPatch

    changes = DocumentPatch.model_validate(args["changes"]).model_dump(
        mode="json", exclude_unset=True
    )
    return update_document(connection, str(args["public_id"]), changes)


def run_document_extraction(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    extract_document_text(
        public_id, Path(connection.execute("PRAGMA database_list").fetchone()["file"])
    )
    return get_document(connection, public_id)


def document_content(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    document = get_document(connection, public_id)
    path = get_document_path(connection, public_id)
    return {
        "document": document,
        "data_base64": base64.b64encode(path.read_bytes()).decode("ascii"),
    }


def photo_content(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    from .photos import get_photo

    photo = get_photo(connection, public_id)
    base = get_settings().data_dir.resolve()
    path = (base / photo["file_path"]).resolve()
    if base not in path.parents or not path.is_file():
        raise ValueError("Photo file not found")
    return {"photo": photo, "data_base64": base64.b64encode(path.read_bytes()).decode("ascii")}


def upload_project_attachment(connection: sqlite3.Connection, args: JsonObject) -> JsonObject:
    from .extension_routes import upload_project_file

    data = decode_file(str(args["data_base64"]))
    filename = str(args.get("filename") or "Attachment")
    mime_type = str(args["mime_type"])
    upload = UploadFile(
        file=BytesIO(data),
        filename=filename,
        headers=Headers({"content-type": mime_type}),
    )
    return asyncio.run(upload_project_file(str(args["project_public_id"]), connection, upload))


def project_attachment_content(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    from .extension_routes import project_file_content

    response = asyncio.run(project_file_content(public_id, connection))
    path = Path(response.path)
    return {
        "public_id": public_id,
        "mime_type": response.media_type,
        "data_base64": base64.b64encode(path.read_bytes()).decode("ascii"),
    }


def delete_project_attachment(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    from .extension_routes import delete_project_file

    return asyncio.run(delete_project_file(public_id, connection))
