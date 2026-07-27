from __future__ import annotations

import asyncio
from decimal import Decimal
from pathlib import Path

import pytest

from findstuff.db import connect, migrate
from findstuff.inventory import create_item
from findstuff.notifications import (
    _validated_ntfy_url,
    deliver_pending_notifications,
    public_notification_config,
    queue_due_notifications,
    save_notification_config,
)


def test_ntfy_private_targets_require_explicit_opt_in(monkeypatch) -> None:
    with pytest.raises(ValueError, match="Private or local"):
        asyncio.run(_validated_ntfy_url("http://127.0.0.1:8080/topic"))
    monkeypatch.setenv("FINDSTUFF_ALLOW_PRIVATE_INTEGRATION_URLS", "true")
    assert (
        asyncio.run(_validated_ntfy_url("http://127.0.0.1:8080/topic"))
        == "http://127.0.0.1:8080/topic"
    )


def test_notification_settings_and_daily_deduplication(tmp_path: Path) -> None:
    path = tmp_path / "notifications.sqlite3"
    migrate(path)
    connection = connect(path)
    try:
        create_item(
            connection,
            {
                "name": "Coffee filters",
                "quantity": Decimal("1"),
                "low_stock_threshold": Decimal("3"),
            },
        )
        assert queue_due_notifications(connection) == 1
        assert queue_due_notifications(connection) == 0
        saved = save_notification_config(
            connection,
            {
                "enabled": False,
                "ntfy_url": "",
                "expiration_days": 7,
                "notify_low_stock": True,
                "notify_expiration": True,
            },
        )
        assert saved["enabled"] is False
        assert public_notification_config(connection)["ntfy_token_set"] is False
        delivery = asyncio.run(deliver_pending_notifications(connection))
        assert delivery["status"] == "disabled"
    finally:
        connection.close()
