from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx

from .config import get_settings
from .db import transaction
from .inventory import NotFoundError, get_item_row, new_public_id
from .network_security import validate_allowed_http_host, validate_public_http_target

MAX_PHOTO_BYTES = 5 * 1024 * 1024
IMAGE_SIGNATURES = {
    "image/jpeg": (b"\xff\xd8\xff", ".jpg"),
    "image/png": (b"\x89PNG\r\n\x1a\n", ".png"),
    "image/webp": (b"RIFF", ".webp"),
}


def validate_image(data: bytes, declared_type: str) -> tuple[str, str]:
    if not data:
        raise ValueError("Photo is empty")
    if len(data) > MAX_PHOTO_BYTES:
        raise ValueError("Photo exceeds the 5 MB limit")
    signature = IMAGE_SIGNATURES.get(declared_type)
    if signature is None or not data.startswith(signature[0]):
        raise ValueError("Only valid JPEG, PNG, and WebP photos are accepted")
    if declared_type == "image/webp" and data[8:12] != b"WEBP":
        raise ValueError("Invalid WebP photo")
    return declared_type, signature[1]


def store_photo(
    connection: sqlite3.Connection,
    item_public_id: str,
    data: bytes,
    declared_type: str,
    width: int | None,
    height: int | None,
) -> dict[str, Any]:
    item = get_item_row(connection, item_public_id)
    mime_type, extension = validate_image(data, declared_type)
    digest = hashlib.sha256(data).hexdigest()
    existing = connection.execute(
        """
        SELECT photos.*, items.public_id AS item_public_id
        FROM photos
        JOIN items ON items.id = photos.item_id
        WHERE photos.item_id = ? AND photos.sha256 = ?
        ORDER BY photos.id
        LIMIT 1
        """,
        (item["id"], digest),
    ).fetchone()
    if existing:
        return serialize_photo(existing)
    public_id = new_public_id("pho")
    relative = Path("photos") / item_public_id / f"{public_id}{extension}"
    absolute = get_settings().data_dir / relative
    absolute.parent.mkdir(parents=True, exist_ok=True)
    temporary = absolute.with_suffix(f"{absolute.suffix}.tmp")
    temporary.write_bytes(data)
    temporary.replace(absolute)
    try:
        with transaction(connection):
            connection.execute(
                """
                INSERT INTO photos(
                    public_id, item_id, file_path, mime_type, size_bytes,
                    width, height, sha256, sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?,
                    COALESCE((SELECT max(sort_order) + 1 FROM photos WHERE item_id = ?), 0))
                """,
                (
                    public_id,
                    item["id"],
                    relative.as_posix(),
                    mime_type,
                    len(data),
                    width,
                    height,
                    digest,
                    item["id"],
                ),
            )
    except Exception:
        absolute.unlink(missing_ok=True)
        raise
    return get_photo(connection, public_id)


def get_photo(connection: sqlite3.Connection, public_id: str) -> dict[str, Any]:
    row = connection.execute(
        """
        SELECT photos.*, items.public_id AS item_public_id
        FROM photos JOIN items ON items.id = photos.item_id
        WHERE photos.public_id = ?
        """,
        (public_id,),
    ).fetchone()
    if row is None:
        raise NotFoundError("Photo not found")
    return serialize_photo(row)


def serialize_photo(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "public_id": row["public_id"],
        "item_public_id": row["item_public_id"],
        "url": f"/api/v1/photos/{row['public_id']}/content",
        "mime_type": row["mime_type"],
        "size_bytes": row["size_bytes"],
        "width": row["width"],
        "height": row["height"],
        "sort_order": row["sort_order"],
        "created_at": row["created_at"],
        "file_path": row["file_path"],
    }


def list_photos(connection: sqlite3.Connection, item_public_id: str) -> list[dict[str, Any]]:
    item = get_item_row(connection, item_public_id)
    rows = connection.execute(
        """
        SELECT photos.*, items.public_id AS item_public_id
        FROM photos JOIN items ON items.id = photos.item_id
        WHERE photos.item_id = ? ORDER BY photos.sort_order, photos.id
        """,
        (item["id"],),
    ).fetchall()
    return [serialize_photo(row) for row in rows]


def delete_photo(connection: sqlite3.Connection, public_id: str) -> None:
    photo = get_photo(connection, public_id)
    base = get_settings().data_dir.resolve()
    absolute = (base / photo["file_path"]).resolve()
    if base not in absolute.parents:
        raise ValueError("Invalid photo path")
    with transaction(connection):
        connection.execute("DELETE FROM photos WHERE public_id = ?", (public_id,))
    absolute.unlink(missing_ok=True)


async def import_photo_from_url(
    connection: sqlite3.Connection, item_public_id: str, url: str
) -> dict[str, Any]:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(12.0),
            follow_redirects=False,
            trust_env=False,
            headers={"User-Agent": "Findstuff/0.1 (self-hosted inventory)"},
        ) as client:
            current_url = url
            for _ in range(6):
                current_url = validate_allowed_http_host(
                    current_url, settings.external_image_hosts
                )
                current_url = await validate_public_http_target(current_url)
                async with client.stream("GET", current_url) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise ValueError("Image redirect is missing its destination")
                        current_url = urljoin(current_url, location)
                        continue
                    response.raise_for_status()
                    content_type = (
                        response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                    )
                    if content_type not in IMAGE_SIGNATURES:
                        raise ValueError("Downloaded file is not a supported image")
                    declared_size = response.headers.get("content-length")
                    if declared_size and int(declared_size) > MAX_PHOTO_BYTES:
                        raise ValueError("Downloaded photo exceeds the 5 MB limit")
                    chunks: list[bytes] = []
                    size = 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > MAX_PHOTO_BYTES:
                            raise ValueError("Downloaded photo exceeds the 5 MB limit")
                        chunks.append(chunk)
                    return store_photo(
                        connection,
                        item_public_id,
                        b"".join(chunks),
                        content_type,
                        None,
                        None,
                    )
            raise ValueError("Image URL redirected too many times")
    except (httpx.HTTPError, ValueError) as exc:
        if isinstance(exc, ValueError):
            raise
        raise ValueError("Could not download image") from exc
