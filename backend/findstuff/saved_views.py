"""Shared inventory workspaces, stored independently to avoid lost list updates."""

from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .db import transaction
from .inventory import ConflictError

PREFIX = "inventory_view:"


class Formula(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(default="", max_length=10000)


class SavedView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,120}$")
    name: str = Field(min_length=1, max_length=100)
    formula: Formula = Field(default_factory=Formula)
    query: str = Field(default="", max_length=500)
    filter: str = Field(default="all", max_length=50)
    groupBy: str = Field(default="none", pattern=r"^(none|room|location|category|tag|unit)$")
    sortBy: str = Field(
        default="updated",
        pattern=r"^(updated|name|location|quantity-asc|quantity-desc|expiration)$",
    )
    categoryFilter: str = Field(default="", max_length=120)
    locationFilter: str = Field(default="", max_length=120)
    compatibilityFilter: str = Field(default="", max_length=120)
    tagFilter: str = Field(default="", max_length=200)
    includeZero: bool = False


class SaveViewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    view: SavedView
    expected_revision: int | None = Field(default=None, ge=1)


def key_for(public_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", public_id):
        raise ValueError("Invalid saved view ID")
    return PREFIX + public_id


def list_saved_views(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        "SELECT value_json FROM app_settings WHERE substr(key, 1, ?) = ? ORDER BY key",
        (len(PREFIX), PREFIX),
    ).fetchall()
    return sorted(
        (value for row in rows if not (value := json.loads(row[0])).get("deleted")),
        key=lambda value: value["name"].casefold(),
    )


def save_view(connection: sqlite3.Connection, public_id: str, request: SaveViewRequest):
    key = key_for(public_id)
    if request.view.id != public_id or not request.view.name.strip():
        raise ValueError("Saved view needs a matching ID and a name")
    with transaction(connection):
        row = connection.execute(
            "SELECT value_json FROM app_settings WHERE key=?", (key,)
        ).fetchone()
        existing = json.loads(row[0]) if row else None
        if (existing["revision"] if existing else None) != request.expected_revision:
            raise ConflictError("This saved view changed on another device. Refresh and try again.")
        if existing and existing.get("deleted"):
            raise ConflictError("This saved view was deleted. Save a new view instead.")
        result = {
            **request.view.model_dump(),
            "name": request.view.name.strip(),
            "revision": (existing["revision"] if existing else 0) + 1,
        }
        connection.execute(
            "INSERT INTO app_settings(key,value_json) VALUES(?,?) "
            "ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, "
            "updated_at=CURRENT_TIMESTAMP",
            (key, json.dumps(result)),
        )
    return result


def delete_view(connection: sqlite3.Connection, public_id: str, revision: int):
    key = key_for(public_id)
    with transaction(connection):
        row = connection.execute(
            "SELECT value_json FROM app_settings WHERE key=?", (key,)
        ).fetchone()
        existing = json.loads(row[0]) if row else None
        if not existing or existing.get("deleted"):
            return
        if existing["revision"] != revision:
            raise ConflictError(
                "This saved view changed on another device. Refresh before deleting it."
            )
        connection.execute(
            "UPDATE app_settings SET value_json=? WHERE key=?",
            (json.dumps({"deleted": True, "revision": revision + 1}), key),
        )
