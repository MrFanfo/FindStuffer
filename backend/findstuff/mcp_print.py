"""QR and printable label outputs for MCP."""

from __future__ import annotations

import asyncio
import re
import sqlite3
from typing import Any
from urllib.parse import urlsplit

from starlette.requests import Request

from .inventory import get_item, get_location_row
from .network_security import validate_http_url

JsonObject = dict[str, Any]
COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")


def _base_url(value: str) -> str:
    url = validate_http_url(value)
    parsed = urlsplit(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def item_qr(connection: sqlite3.Connection, public_id: str, base_url: str) -> JsonObject:
    from .app import make_qr_svg

    get_item(connection, public_id)
    target = f"{_base_url(base_url)}?item={public_id}"
    return {"svg": make_qr_svg(target).decode(), "target": target}


def location_qr(
    connection: sqlite3.Connection, public_id: str, base_url: str, color: str
) -> JsonObject:
    from .app import make_qr_svg

    get_location_row(connection, public_id)
    if not COLOR.fullmatch(color):
        raise ValueError("color must be a six-digit hex color")
    target = f"{_base_url(base_url)}?location={public_id}&mode=view"
    return {"svg": make_qr_svg(target, color.upper()).decode(), "target": target}


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": "http",
            "server": ("findstuff.local", 80),
            "path": "/",
            "root_path": "",
            "query_string": b"",
            "headers": [],
        }
    )


def item_label(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    from .app import print_item_label

    return {"html": asyncio.run(print_item_label(public_id, _request(), connection))}


def location_label(connection: sqlite3.Connection, public_id: str) -> JsonObject:
    from .app import print_location_label

    return {"html": asyncio.run(print_location_label(public_id, _request(), connection))}
