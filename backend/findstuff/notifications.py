from __future__ import annotations

import json
import sqlite3
from datetime import date
from typing import Any

import httpx

from .config import get_settings
from .db import transaction
from .inventory import expiring_items, list_items, new_public_id
from .network_security import validate_http_url, validate_public_http_target

DEFAULT_CONFIG = {
    "enabled": False,
    "ntfy_url": "",
    "ntfy_token": "",
    "expiration_days": 7,
    "notify_low_stock": True,
    "notify_expiration": True,
}


async def _validated_ntfy_url(url: str) -> str:
    settings = get_settings()
    if settings.allow_private_integration_urls:
        return validate_http_url(url)
    return await validate_public_http_target(url)


def get_notification_config(connection: sqlite3.Connection) -> dict[str, Any]:
    row = connection.execute(
        "SELECT value_json FROM app_settings WHERE key = 'notifications'"
    ).fetchone()
    stored = json.loads(row["value_json"]) if row else {}
    return {**DEFAULT_CONFIG, **stored}


def public_notification_config(connection: sqlite3.Connection) -> dict[str, Any]:
    config = get_notification_config(connection)
    return {
        **{key: value for key, value in config.items() if key != "ntfy_token"},
        "ntfy_token_set": bool(config.get("ntfy_token")),
    }


def save_notification_config(
    connection: sqlite3.Connection, values: dict[str, Any]
) -> dict[str, Any]:
    current = get_notification_config(connection)
    if values.get("ntfy_token") == "":
        values.pop("ntfy_token", None)
    updated = {**current, **values}
    if updated["enabled"] and not str(updated["ntfy_url"]).startswith(("http://", "https://")):
        raise ValueError("An http:// or https:// ntfy topic URL is required when enabled")
    with transaction(connection):
        connection.execute(
            """
            INSERT INTO app_settings(key, value_json) VALUES ('notifications', ?)
            ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (json.dumps(updated, separators=(",", ":")),),
        )
    return public_notification_config(connection)


def queue_due_notifications(connection: sqlite3.Connection) -> int:
    config = get_notification_config(connection)
    today = date.today().isoformat()
    candidates: list[tuple[str, dict[str, Any], str, str]] = []
    if config["notify_low_stock"]:
        for item in list_items(connection, low_stock=True, limit=250):
            candidates.append(
                (
                    "low_stock",
                    item,
                    f"Low stock: {item['name']}",
                    f"{item['quantity']} {item['unit']} left in {item['location_path']}",
                )
            )
    if config["notify_expiration"]:
        for item in expiring_items(connection, int(config["expiration_days"])):
            candidates.append(
                (
                    "expiration",
                    item,
                    f"Expiring: {item['name']}",
                    f"Expires {item['expiration_date']} in {item['location_path']}",
                )
            )
    queued = 0
    with transaction(connection):
        for kind, item, title, message in candidates:
            fingerprint = f"{kind}:{item['public_id']}:{today}"
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO notification_events(
                    public_id, kind, item_id, fingerprint, title, message
                ) VALUES (?, ?, (SELECT id FROM items WHERE public_id = ?), ?, ?, ?)
                """,
                (new_public_id("notice"), kind, item["public_id"], fingerprint, title, message),
            )
            queued += cursor.rowcount
    return queued


async def deliver_pending_notifications(
    connection: sqlite3.Connection, limit: int = 20
) -> dict[str, int | str]:
    config = get_notification_config(connection)
    if not config["enabled"]:
        return {"queued": 0, "sent": 0, "failed": 0, "status": "disabled"}
    queued = queue_due_notifications(connection)
    rows = connection.execute(
        """
        SELECT * FROM notification_events WHERE status IN ('pending', 'failed')
        ORDER BY id LIMIT ?
        """,
        (max(1, min(limit, 100)),),
    ).fetchall()
    sent = failed = 0
    headers = {"Title": "Findstuff", "Tags": "package"}
    if config.get("ntfy_token"):
        headers["Authorization"] = f"Bearer {config['ntfy_token']}"
    target = await _validated_ntfy_url(str(config["ntfy_url"]))
    async with httpx.AsyncClient(timeout=15, headers=headers, trust_env=False) as client:
        for row in rows:
            try:
                async with client.stream(
                    "POST",
                    target,
                    content=f"{row['title']}\n{row['message']}".encode(),
                ) as response:
                    response.raise_for_status()
                with transaction(connection):
                    connection.execute(
                        """
                        UPDATE notification_events SET status = 'sent', sent_at = CURRENT_TIMESTAMP,
                            attempt_count = attempt_count + 1, last_error = NULL WHERE id = ?
                        """,
                        (row["id"],),
                    )
                sent += 1
            except httpx.HTTPError as exc:
                with transaction(connection):
                    connection.execute(
                        """
                        UPDATE notification_events SET status = 'failed',
                            attempt_count = attempt_count + 1, last_error = ? WHERE id = ?
                        """,
                        (str(exc), row["id"]),
                    )
                failed += 1
    return {"queued": queued, "sent": sent, "failed": failed, "status": "enabled"}


async def send_test_notification(connection: sqlite3.Connection) -> None:
    config = get_notification_config(connection)
    if not config["enabled"] or not config["ntfy_url"]:
        raise ValueError("Enable notifications and save an ntfy URL first")
    headers = {"Title": "Findstuff test", "Tags": "white_check_mark"}
    if config.get("ntfy_token"):
        headers["Authorization"] = f"Bearer {config['ntfy_token']}"
    target = await _validated_ntfy_url(str(config["ntfy_url"]))
    async with httpx.AsyncClient(timeout=15, headers=headers, trust_env=False) as client:
        async with client.stream(
            "POST", target, content=b"Notifications are working."
        ) as response:
            response.raise_for_status()
