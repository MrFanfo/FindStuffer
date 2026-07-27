from __future__ import annotations

import base64
import html
import json
import logging
import re
import sqlite3
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from .config import get_settings
from .db import connect, transaction
from .inventory import (
    ConflictError,
    NotFoundError,
    create_item,
    find_category_id,
    get_location_row,
    hard_delete_item,
    list_categories,
    location_path,
    new_public_id,
)
from .photos import store_photo, validate_image
from .service_config import get_ai_config

logger = logging.getLogger(__name__)


class ScanRecognition(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=2000)
    category: str = Field(default="", max_length=240)
    brand: str = Field(default="", max_length=240)
    model: str = Field(default="", max_length=240)
    barcode: str = Field(default="", max_length=80)
    quantity: float = Field(default=1, ge=0, le=100000)
    unit: str = Field(default="pcs", min_length=1, max_length=24)
    confidence: float = Field(default=0.5, ge=0, le=1)
    warnings: list[str] = Field(default_factory=list, max_length=8)


recognition_adapter = TypeAdapter(ScanRecognition)


def _scan_row(connection: sqlite3.Connection, public_id: str) -> sqlite3.Row:
    row = connection.execute(
        """
        SELECT ai_scan_proposals.*, locations.public_id AS location_public_id,
               locations.name AS location_name
        FROM ai_scan_proposals
        JOIN locations ON locations.id = ai_scan_proposals.location_id
        WHERE ai_scan_proposals.public_id = ?
        """,
        (public_id,),
    ).fetchone()
    if row is None:
        raise NotFoundError("AI scan proposal not found")
    return row


def _scan_file(row: sqlite3.Row) -> Path:
    base = get_settings().data_dir.resolve()
    absolute = (base / row["photo_path"]).resolve()
    if base not in absolute.parents:
        raise ValueError("Invalid AI scan photo path")
    return absolute


def serialize_scan(connection: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    proposal = json.loads(row["proposal_json"]) if row["proposal_json"] else None
    return {
        "public_id": row["public_id"],
        "status": row["status"],
        "location_public_id": row["location_public_id"],
        "location_name": row["location_name"],
        "location_path": location_path(connection, row["location_id"]),
        "photo_url": f"/api/v1/ai-scans/{row['public_id']}/photo",
        "mime_type": row["mime_type"],
        "width": row["width"],
        "height": row["height"],
        "proposal": proposal,
        "error": row["error"],
        "item_public_id": (
            connection.execute(
                "SELECT public_id FROM items WHERE id = ?", (row["item_id"],)
            ).fetchone()["public_id"]
            if row["item_id"] is not None
            else None
        ),
        "created_at": row["created_at"],
        "processed_at": row["processed_at"],
        "decided_at": row["decided_at"],
    }


def create_scan(
    connection: sqlite3.Connection,
    *,
    location_public_id: str,
    data: bytes,
    declared_type: str,
    width: int | None,
    height: int | None,
) -> dict[str, Any]:
    location = get_location_row(connection, location_public_id)
    mime_type, extension = validate_image(data, declared_type)
    public_id = new_public_id("ais")
    relative = Path("ai-scans") / f"{public_id}{extension}"
    absolute = get_settings().data_dir / relative
    absolute.parent.mkdir(parents=True, exist_ok=True)
    temporary = absolute.with_suffix(f"{absolute.suffix}.tmp")
    temporary.write_bytes(data)
    temporary.replace(absolute)
    try:
        with transaction(connection):
            connection.execute(
                """
                INSERT INTO ai_scan_proposals(
                    public_id, location_id, photo_path, mime_type, size_bytes,
                    width, height, model
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    public_id,
                    location["id"],
                    relative.as_posix(),
                    mime_type,
                    len(data),
                    width,
                    height,
                    get_ai_config(connection).model,
                ),
            )
    except Exception:
        absolute.unlink(missing_ok=True)
        raise
    return serialize_scan(connection, _scan_row(connection, public_id))


async def _recognize(connection: sqlite3.Connection, row: sqlite3.Row) -> ScanRecognition:
    settings = get_ai_config(connection)
    if not settings.enabled or not settings.endpoint or not settings.model:
        raise RuntimeError(
            "AI vision is not configured. Configure it in Settings > Integrations."
        )
    categories = [entry["path"] for entry in list_categories(connection)]
    image = base64.b64encode(_scan_file(row).read_bytes()).decode("ascii")
    schema = recognition_adapter.json_schema()
    prompt = (
        "Identify the single dominant physical inventory item in this image. Read visible "
        "labels carefully. Return concise, basic catalog information only. Never invent a brand, "
        "model, barcode, or specification that is not visible or reliably identifiable. Choose "
        "category from the supplied list, or use an empty string. Mention uncertainty in warnings. "
        "Output JSON only.\n"
        f"Allowed category paths: {json.dumps(categories)}\n"
        f"JSON schema: {json.dumps(schema)}"
    )
    headers = {"Content-Type": "application/json"}
    if settings.api_key:
        headers["Authorization"] = f"Bearer {settings.api_key}"
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(60.0), headers=headers, trust_env=False
    ) as client:
        response = await client.post(
            settings.endpoint,
            json={
                "model": settings.model,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a careful visual inventory cataloguer.",
                    },
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{row['mime_type']};base64,{image}",
                                    "detail": "low",
                                },
                            },
                        ],
                    },
                ],
                "response_format": {"type": "json_object"},
            },
        )
        response.raise_for_status()
        body = response.json()
    try:
        content = body["choices"][0]["message"]["content"]
        return recognition_adapter.validate_json(content)
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise RuntimeError("AI provider returned an invalid visual scan result") from exc


async def _basic_research(name: str, brand: str, model: str) -> dict[str, str] | None:
    query_text = " ".join(part for part in (brand, model, name) if part).strip()
    if not query_text:
        return None
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(8.0),
            headers={"User-Agent": "Findstuff/0.1 (self-hosted inventory)"},
        ) as client:
            response = await client.get(
                "https://en.wikipedia.org/w/api.php",
                params={
                    "action": "query",
                    "list": "search",
                    "srsearch": query_text,
                    "srlimit": 1,
                    "format": "json",
                    "utf8": 1,
                },
            )
            response.raise_for_status()
            result = response.json().get("query", {}).get("search", [])[0]
        title = str(result.get("title") or "").strip()
        snippet = re.sub(r"<[^>]+>", "", str(result.get("snippet") or ""))
        snippet = html.unescape(snippet).strip()
        if not title:
            return None
        return {
            "label": f"Wikipedia: {title}",
            "url": f"https://en.wikipedia.org/wiki/{quote(title.replace(' ', '_'))}",
            "summary": snippet[:500],
        }
    except (httpx.HTTPError, IndexError, KeyError, TypeError, ValueError):
        return None


def _proposal_from_recognition(
    connection: sqlite3.Connection,
    recognition: ScanRecognition,
    research: dict[str, str] | None,
) -> dict[str, Any]:
    description = recognition.description.strip()
    should_append_research = (
        research
        and research["summary"]
        and research["summary"].casefold() not in description.casefold()
    )
    if should_append_research:
        description = f"{description}\n\n{research['summary']}".strip()
    category_id = find_category_id(connection, recognition.category)
    links = (
        [{"label": research["label"], "url": research["url"]}]
        if research
        else []
    )
    return {
        "item": {
            "name": recognition.name,
            "description": description[:4000],
            "notes": "",
            "category_id": category_id,
            "quantity": str(recognition.quantity),
            "unit": recognition.unit,
            "brand": recognition.brand,
            "model": recognition.model,
            "serial_number": "",
            "barcode": recognition.barcode,
            "links": links,
        },
        "confidence": recognition.confidence,
        "warnings": recognition.warnings,
        "research": research,
    }


async def process_scan(public_id: str) -> None:
    connection = connect()
    try:
        row = _scan_row(connection, public_id)
        if row["status"] != "processing":
            return
        recognition = await _recognize(connection, row)
        research = await _basic_research(
            recognition.name, recognition.brand, recognition.model
        )
        proposal = _proposal_from_recognition(connection, recognition, research)
        with transaction(connection):
            connection.execute(
                """
                UPDATE ai_scan_proposals
                SET status = 'pending', proposal_json = ?, error = NULL,
                    processed_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'processing'
                """,
                (json.dumps(proposal, separators=(",", ":")), row["id"]),
            )
    except Exception as exc:
        logger.warning("AI scan %s failed: %s", public_id, exc)
        try:
            with transaction(connection):
                connection.execute(
                    """
                    UPDATE ai_scan_proposals
                    SET status = 'failed', error = ?, processed_at = CURRENT_TIMESTAMP
                    WHERE public_id = ? AND status = 'processing'
                    """,
                    (str(exc)[:1000], public_id),
                )
        except Exception:
            logger.exception("Could not record failure for AI scan %s", public_id)
    finally:
        connection.close()


def list_scans(
    connection: sqlite3.Connection,
    statuses: set[str] | None = None,
) -> list[dict[str, Any]]:
    statuses = statuses or {"processing", "pending", "failed"}
    allowed = {"processing", "pending", "applying", "approved", "rejected", "failed"}
    statuses &= allowed
    if not statuses:
        return []
    placeholders = ", ".join("?" for _ in statuses)
    rows = connection.execute(
        f"""
        SELECT ai_scan_proposals.*, locations.public_id AS location_public_id,
               locations.name AS location_name
        FROM ai_scan_proposals
        JOIN locations ON locations.id = ai_scan_proposals.location_id
        WHERE ai_scan_proposals.status IN ({placeholders})
        ORDER BY ai_scan_proposals.id DESC
        """,
        tuple(sorted(statuses)),
    ).fetchall()
    return [serialize_scan(connection, row) for row in rows]


def get_scan(connection: sqlite3.Connection, public_id: str) -> dict[str, Any]:
    return serialize_scan(connection, _scan_row(connection, public_id))


def scan_photo_path(connection: sqlite3.Connection, public_id: str) -> tuple[Path, str]:
    row = _scan_row(connection, public_id)
    return _scan_file(row), row["mime_type"]


def update_scan(
    connection: sqlite3.Connection, public_id: str, changes: dict[str, Any]
) -> dict[str, Any]:
    row = _scan_row(connection, public_id)
    if row["status"] != "pending" or not row["proposal_json"]:
        raise ConflictError("Only pending AI scan proposals can be edited")
    proposal = json.loads(row["proposal_json"])
    location_public_id = changes.pop("location_public_id", None)
    location_id = (
        get_location_row(connection, location_public_id)["id"]
        if location_public_id is not None
        else row["location_id"]
    )
    proposal["item"].update(changes)
    with transaction(connection):
        connection.execute(
            "UPDATE ai_scan_proposals SET proposal_json = ?, location_id = ? WHERE id = ?",
            (json.dumps(proposal, separators=(",", ":")), location_id, row["id"]),
        )
    return get_scan(connection, public_id)


def approve_scan(connection: sqlite3.Connection, public_id: str) -> dict[str, Any]:
    row = _scan_row(connection, public_id)
    if row["status"] != "pending" or not row["proposal_json"]:
        raise ConflictError(f"AI scan proposal is already {row['status']}")
    with transaction(connection):
        cursor = connection.execute(
            "UPDATE ai_scan_proposals SET status = 'applying' "
            "WHERE id = ? AND status = 'pending'",
            (row["id"],),
        )
        if cursor.rowcount != 1:
            raise ConflictError("AI scan proposal changed; reload and try again")
    proposal = json.loads(row["proposal_json"])
    values = dict(proposal["item"])
    values["location_public_id"] = row["location_public_id"]
    item: dict[str, Any] | None = None
    try:
        item = create_item(connection, values, source="ai_scan")
        photo_path = _scan_file(row)
        store_photo(
            connection,
            item["public_id"],
            photo_path.read_bytes(),
            row["mime_type"],
            row["width"],
            row["height"],
        )
        with transaction(connection):
            connection.execute(
                """
                UPDATE ai_scan_proposals
                SET status = 'approved',
                    item_id = (SELECT id FROM items WHERE public_id = ?),
                    decided_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'applying'
                """,
                (item["public_id"], row["id"]),
            )
        photo_path.unlink(missing_ok=True)
        return item
    except Exception:
        if item is not None:
            try:
                hard_delete_item(connection, item["public_id"])
            except Exception:
                logger.exception(
                    "Could not roll back item %s after AI scan approval failed",
                    item["public_id"],
                )
        with transaction(connection):
            connection.execute(
                "UPDATE ai_scan_proposals SET status = 'pending' "
                "WHERE id = ? AND status = 'applying'",
                (row["id"],),
            )
        raise


def reject_scan(connection: sqlite3.Connection, public_id: str) -> None:
    row = _scan_row(connection, public_id)
    if row["status"] not in {"pending", "failed"}:
        raise ConflictError(f"AI scan proposal is already {row['status']}")
    with transaction(connection):
        connection.execute(
            """
            UPDATE ai_scan_proposals
            SET status = 'rejected', decided_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status IN ('pending', 'failed')
            """,
            (row["id"],),
        )
    _scan_file(row).unlink(missing_ok=True)


def retry_scan(connection: sqlite3.Connection, public_id: str) -> dict[str, Any]:
    row = _scan_row(connection, public_id)
    if row["status"] != "failed":
        raise ConflictError("Only failed AI scans can be retried")
    with transaction(connection):
        connection.execute(
            """
            UPDATE ai_scan_proposals
            SET status = 'processing', error = NULL, processed_at = NULL
            WHERE id = ? AND status = 'failed'
            """,
            (row["id"],),
        )
    return get_scan(connection, public_id)
