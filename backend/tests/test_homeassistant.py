from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest

from findstuff import homeassistant as ha
from findstuff.db import connect, migrate
from findstuff.inventory import create_item
from findstuff.service_config import get_mqtt_config


@pytest.fixture
def inventory(tmp_path, monkeypatch):
    path = tmp_path / "mqtt.sqlite3"
    migrate(path)
    monkeypatch.setattr(ha, "connect", lambda: connect(path))
    connection = connect(path)
    yield connection
    connection.close()


def test_empty_state_and_discovery(inventory):
    state, attributes = ha._payloads()
    settings = get_mqtt_config(inventory)
    assert state["last_activity"] is None
    assert attributes == {"quantity_by_unit": {}, "recent_events": []}
    assert len({sensor["key"] for sensor in ha.SENSORS}) == len(ha.SENSORS)
    for sensor in ha.SENSORS:
        assert sensor["key"] in state
        config = ha._sensor_config(settings, sensor)
        assert config["state_topic"].endswith("/state")
        if sensor.get("device_class") == "timestamp":
            assert "state_class" not in config
        else:
            assert isinstance(state[sensor["key"]], (int, float))
    messages = []

    class Client:
        def publish(self, topic, payload, **kwargs):
            messages.append((topic, json.loads(payload), kwargs))
            return SimpleNamespace(wait_for_publish=lambda **kwargs: None)

    ha._publish_discovery(Client(), settings)
    assert len(messages) == len(ha.SENSORS) + 1
    assert all(options["retain"] for _, _, options in messages)
    assert all("password" not in json.dumps(body) for _, body, _ in messages)


def test_inventory_counts_use_active_items_and_correct_time_windows(inventory):
    now = datetime.now(UTC)
    items = [
        create_item(inventory, {"name": name, "quantity": Decimal(q), "unit": unit})
        for name, q, unit in [
            ("Cable", "2.5", "m"),
            ("Empty", "0", "pcs"),
            ("Old", "9", "pcs"),
            ("Parts", "3", "pcs"),
        ]
    ]
    ids = [
        inventory.execute("SELECT id FROM items WHERE public_id=?", (i["public_id"],)).fetchone()[0]
        for i in items
    ]
    inventory.execute("DELETE FROM item_lots")
    inventory.execute("UPDATE items SET archived_at=CURRENT_TIMESTAMP WHERE id=?", (ids[2],))
    inventory.execute(
        "UPDATE items SET created_at=? WHERE id=?", ((now - timedelta(days=8)).isoformat(), ids[0])
    )
    inventory.execute("UPDATE items SET expiration_date=date('now','-1 day') WHERE id=?", (ids[0],))
    inventory.execute(
        "INSERT INTO item_lots(public_id,item_id,quantity_milli,expiration_date) "
        "VALUES('lot',?,1000,date('now','-2 day'))",
        (ids[0],),
    )
    inventory.execute(
        "INSERT INTO item_lots(public_id,item_id,quantity_milli,expiration_date) "
        "VALUES('empty-lot',?,0,date('now','-2 day'))",
        (ids[3],),
    )
    inventory.execute(
        "UPDATE inventory_events SET created_at=?", ((now - timedelta(hours=25)).isoformat(),)
    )
    inventory.execute(
        "UPDATE inventory_events SET created_at=? WHERE item_id=?", (now.isoformat(), ids[0])
    )
    for i, direction, returned in [
        (0, "lent", None),
        (1, "borrowed", None),
        (3, "lent", now.isoformat()),
    ]:
        inventory.execute(
            "INSERT INTO loans(public_id,item_id,direction,person,due_date,returned_at) "
            "VALUES(?,?,?,'Private person',date('now','-1 day'),?)",
            (f"loan-{i}", ids[i], direction, returned),
        )
    for i in (0, 2):
        inventory.execute(
            "INSERT INTO maintenance_tasks(public_id,item_id,title,interval_days,next_due_at) "
            "VALUES(?,?,'Check',7,?)",
            (f"task-{i}", ids[i], now.isoformat()),
        )
    inventory.execute(
        "INSERT INTO photos(public_id,item_id,file_path,mime_type,size_bytes,sha256) "
        "VALUES('photo',?,'private.jpg','image/jpeg',1500000,'hash')",
        (ids[0],),
    )
    inventory.execute(
        "INSERT INTO projects(public_id,name,status) VALUES('project','Build','active')"
    )
    project = inventory.execute("SELECT id FROM projects").fetchone()[0]
    inventory.execute(
        "INSERT INTO project_reservations(project_id,item_id,quantity_milli) VALUES(?,?,1000)",
        (project, ids[0]),
    )
    inventory.execute(
        "INSERT INTO shopping_list_entries(public_id,name,checked) "
        "VALUES('unchecked','Buy',0),('checked','Done',1)"
    )
    state, attributes = ha._payloads()
    expected = {
        "item_count": 3,
        "total_quantity": 5.5,
        "out_of_stock_count": 1,
        "archived_count": 1,
        "expired_count": 1,
        "lot_count": 1,
        "added_last_7_days": 2,
        "events_last_24h": 1,
        "loans_out_count": 1,
        "borrowed_count": 1,
        "overdue_loans_count": 2,
        "maintenance_due_count": 1,
        "photo_count": 1,
        "photo_storage_mb": 1.5,
        "missing_photo_count": 2,
        "active_project_count": 1,
        "reserved_item_count": 1,
        "shopping_list_count": 1,
    }
    for key, value in expected.items():
        assert state[key] == value, key
    assert attributes["quantity_by_unit"] == {"m": 2.5, "pcs": 3}
    assert state["last_activity"] == now.isoformat()
    assert len(attributes["recent_events"]) <= 10
    assert "Private person" not in json.dumps(attributes)
    assert "private.jpg" not in json.dumps(attributes)


def test_timestamp_normalization():
    assert ha._as_utc_isoformat("2026-01-01 10:00:00") == "2026-01-01T10:00:00+00:00"
    assert ha._as_utc_isoformat("2026-01-01T12:00:00+02:00") == "2026-01-01T10:00:00+00:00"
    assert ha._as_utc_isoformat("invalid") is None


def test_connection_test_does_not_evict_publisher_or_claim_online(inventory, monkeypatch):
    from dataclasses import replace

    settings = replace(get_mqtt_config(inventory), host="broker.example", client_id="running")
    calls = []

    class Client:
        def loop_stop(self):
            calls.append("stop")

        def disconnect(self):
            calls.append("disconnect")

    def create(config, **kwargs):
        assert config.client_id != settings.client_id
        assert kwargs == {"announce_availability": False}
        return Client()

    monkeypatch.setattr(ha, "_connect_client", create)
    monkeypatch.setattr(ha, "_publish_discovery", lambda *args: None)
    monkeypatch.setattr(ha, "_publish", lambda client, topic, payload: calls.append(topic))
    asyncio.run(ha.test_mqtt_connection(settings))
    assert not any(str(call).endswith("/status") for call in calls)
    assert any(str(call).endswith("/state") for call in calls)
    assert any(str(call).endswith("/attributes") for call in calls)
    calls.clear()
    asyncio.run(ha._disconnect_client(Client(), settings))
    assert calls == [ha._topic(settings, "status"), "disconnect", "stop"]
