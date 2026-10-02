"""Administrative status and dry-run inspection for MCP."""

from __future__ import annotations

import sqlite3
from typing import Any

from .backups import list_backups
from .config import get_settings
from .extended import import_preview
from .updater import software_update_status

JsonObject = dict[str, Any]


def backup_listing() -> list[JsonObject]:
    return list_backups()


def software_status() -> JsonObject:
    status = software_update_status(refresh=False)
    status["enabled"] = get_settings().software_update_enabled
    return status


def preview_import(connection: sqlite3.Connection, payload: JsonObject) -> JsonObject:
    return import_preview(payload, connection)
