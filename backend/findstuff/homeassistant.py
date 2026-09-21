from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from . import __version__
from .db import connect
from .inventory import dashboard
from .service_config import MQTTServiceConfig, get_mqtt_config

LOGGER = logging.getLogger(__name__)

SENSORS: tuple[dict[str, Any], ...] = (
    {
        "key": "item_count",
        "name": "Items",
        "icon": "mdi:package-variant-closed",
    },
    {
        "key": "location_count",
        "name": "Locations",
        "icon": "mdi:map-marker-radius",
    },
    {
        "key": "low_stock_count",
        "name": "Low Stock",
        "icon": "mdi:cart-alert",
    },
    {
        "key": "expiring_count",
        "name": "Expiring",
        "icon": "mdi:calendar-alert",
    },
    {
        "key": "needs_details_count",
        "name": "Needs Details",
        "icon": "mdi:clipboard-edit-outline",
    },
    {
        "key": "total_quantity",
        "name": "Total Quantity",
        "attributes": "quantity_by_unit",
        "icon": "mdi:counter",
    },
    {
        "key": "container_count",
        "name": "Containers",
        "icon": "mdi:archive-outline",
    },
    {
        "key": "category_count",
        "name": "Categories",
        "icon": "mdi:shape-outline",
    },
    {
        "key": "archived_count",
        "name": "Archived",
        "icon": "mdi:archive-cancel-outline",
    },
    {
        "key": "photo_count",
        "name": "Photos",
        "icon": "mdi:image-multiple-outline",
    },
    {
        "key": "photo_storage_mb",
        "name": "Photo Storage",
        "icon": "mdi:harddisk",
        "unit": "MB",
        "device_class": "data_size",
    },
    {
        "key": "loans_out_count",
        "name": "On Loan",
        "icon": "mdi:hand-extended-outline",
    },
    {
        "key": "shopping_list_count",
        "name": "Shopping List",
        "icon": "mdi:cart-outline",
    },
    {
        "key": "maintenance_due_count",
        "name": "Maintenance Due",
        "icon": "mdi:wrench-clock",
    },
    {
        "key": "added_last_7_days",
        "name": "Added Last 7 Days",
        "icon": "mdi:playlist-plus",
    },
    {
        "key": "events_last_24h",
        "name": "Changes Last 24 Hours",
        "icon": "mdi:history",
    },
    {
        "key": "last_activity",
        "name": "Last Activity",
        "icon": "mdi:clock-outline",
        "device_class": "timestamp",
        "state_class": None,
        "attributes": "recent_events",
    },
    {"key": "out_of_stock_count", "name": "Out of Stock", "icon": "mdi:package-variant-remove"},
    {"key": "expired_count", "name": "Expired Items", "icon": "mdi:calendar-remove"},
    {"key": "uncategorized_count", "name": "Uncategorized Items", "icon": "mdi:tag-off-outline"},
    {"key": "missing_photo_count", "name": "Items Without Photos", "icon": "mdi:image-off-outline"},
    {"key": "borrowed_count", "name": "Borrowed Items", "icon": "mdi:hand-extended-outline"},
    {"key": "overdue_loans_count", "name": "Overdue Loans", "icon": "mdi:calendar-clock"},
    {"key": "active_project_count", "name": "Active Projects", "icon": "mdi:hammer-wrench"},
    {"key": "reserved_item_count", "name": "Reserved Items", "icon": "mdi:package-variant"},
    {"key": "document_count", "name": "Documents", "icon": "mdi:file-document-multiple-outline"},
    {"key": "lot_count", "name": "Stock Lots", "icon": "mdi:layers-triple-outline"},
)


_configuration_event: asyncio.Event | None = None


def request_mqtt_reconfigure() -> None:
    if _configuration_event is not None:
        _configuration_event.set()


def _topic(settings: MQTTServiceConfig, *parts: str) -> str:
    clean = [settings.base_topic.strip("/"), *(part.strip("/") for part in parts)]
    return "/".join(part for part in clean if part)


def _device(settings: MQTTServiceConfig) -> dict[str, Any]:
    return {
        "identifiers": ["findstuff"],
        "name": "Findstuff",
        "manufacturer": "Findstuff",
        "model": "Home Inventory",
        "sw_version": __version__,
        "configuration_url": "http://findstuff.local/",
    }


def _sensor_config(settings: MQTTServiceConfig, sensor: dict[str, Any]) -> dict[str, Any]:
    name = sensor["name"]
    key = sensor["key"]
    config: dict[str, Any] = {
        "name": name,
        "unique_id": f"findstuff_{key}",
        "object_id": f"findstuff_{key}",
        "state_topic": _topic(settings, "state"),
        "value_template": f"{{{{ value_json.{key} }}}}",
        "availability_topic": _topic(settings, "status"),
        "payload_available": "online",
        "payload_not_available": "offline",
        "icon": sensor["icon"],
        "device": _device(settings),
    }
    state_class = sensor.get("state_class", "measurement")
    if state_class:
        config["state_class"] = state_class
    if sensor.get("unit"):
        config["unit_of_measurement"] = sensor["unit"]
    if sensor.get("device_class"):
        config["device_class"] = sensor["device_class"]
    if sensor.get("attributes"):
        config["json_attributes_topic"] = _topic(settings, "attributes")
        attribute = sensor["attributes"]
        config["json_attributes_template"] = (
            "{{ {'" + attribute + "': value_json." + attribute + "} | tojson }}"
        )
    return config


def _availability_config(settings: MQTTServiceConfig) -> dict[str, Any]:
    return {
        "name": "Online",
        "unique_id": "findstuff_online",
        "object_id": "findstuff_online",
        "state_topic": _topic(settings, "status"),
        "payload_on": "online",
        "payload_off": "offline",
        "device_class": "connectivity",
        "device": _device(settings),
    }


def _as_utc_isoformat(value: Any) -> str | None:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC).isoformat()


def _extra_counts(connection: sqlite3.Connection) -> dict[str, Any]:
    items = connection.execute(
        """
        SELECT COALESCE(sum(quantity_milli), 0) AS quantity_milli,
               COALESCE(sum(CASE WHEN is_container = 1 THEN 1 ELSE 0 END), 0) AS container_count,
               COALESCE(sum(CASE WHEN julianday(created_at) >= julianday('now', '-7 day')
                                 THEN 1 ELSE 0 END), 0) AS added_last_7_days
        FROM items
        WHERE archived_at IS NULL
        """
    ).fetchone()
    photos = connection.execute(
        "SELECT count(*) AS photo_count, COALESCE(sum(size_bytes), 0) AS bytes FROM photos"
    ).fetchone()

    def scalar(sql: str) -> int:
        return connection.execute(sql).fetchone()[0]

    last_event = connection.execute(
        "SELECT created_at FROM inventory_events "
        "ORDER BY julianday(created_at) DESC, id DESC LIMIT 1"
    ).fetchone()
    return {
        "total_quantity": round(items["quantity_milli"] / 1000, 3),
        "container_count": items["container_count"],
        "added_last_7_days": items["added_last_7_days"],
        "photo_count": photos["photo_count"],
        "photo_storage_mb": round(photos["bytes"] / 1_000_000, 2),
        "category_count": scalar("SELECT count(*) FROM categories"),
        "archived_count": scalar("SELECT count(*) FROM items WHERE archived_at IS NOT NULL"),
        "loans_out_count": scalar(
            "SELECT count(*) FROM loans WHERE returned_at IS NULL AND direction = 'lent'"
        ),
        "shopping_list_count": scalar(
            "SELECT count(*) FROM shopping_list_entries WHERE checked = 0"
        ),
        "maintenance_due_count": scalar(
            """
            SELECT count(*) FROM maintenance_tasks
            WHERE archived_at IS NULL
              AND next_due_at IS NOT NULL
              AND date(next_due_at) <= date('now')
              AND EXISTS (SELECT 1 FROM items WHERE items.id = maintenance_tasks.item_id
                          AND items.archived_at IS NULL)
            """
        ),
        "events_last_24h": scalar(
            "SELECT count(*) FROM inventory_events "
            "WHERE julianday(created_at) >= julianday('now', '-1 day')"
        ),
        "last_activity": _as_utc_isoformat(last_event["created_at"] if last_event else None),
        "out_of_stock_count": scalar(
            "SELECT count(*) FROM items WHERE archived_at IS NULL AND quantity_milli = 0"
        ),
        "expired_count": scalar("""
            SELECT count(*) FROM items WHERE archived_at IS NULL AND (
                (quantity_milli > 0 AND expiration_date < date('now'))
                OR EXISTS (SELECT 1 FROM item_lots WHERE item_id = items.id
                           AND quantity_milli > 0 AND expiration_date < date('now'))
            )
        """),
        "uncategorized_count": scalar(
            "SELECT count(*) FROM items WHERE archived_at IS NULL AND category_id IS NULL"
        ),
        "missing_photo_count": scalar("""
            SELECT count(*) FROM items WHERE archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM photos WHERE item_id = items.id)
        """),
        "borrowed_count": scalar(
            "SELECT count(*) FROM loans WHERE returned_at IS NULL AND direction = 'borrowed'"
        ),
        "overdue_loans_count": scalar(
            "SELECT count(*) FROM loans WHERE returned_at IS NULL AND due_date < date('now')"
        ),
        "active_project_count": scalar(
            "SELECT count(*) FROM projects WHERE status IN ('planned', 'active')"
        ),
        "reserved_item_count": scalar("""
            SELECT count(DISTINCT r.item_id) FROM project_reservations r
            JOIN projects p ON p.id = r.project_id JOIN items i ON i.id = r.item_id
            WHERE p.status IN ('planned', 'active') AND i.archived_at IS NULL
        """),
        "document_count": scalar("SELECT count(*) FROM item_documents"),
        "lot_count": scalar("""
            SELECT count(*) FROM item_lots l JOIN items i ON i.id = l.item_id
            WHERE l.quantity_milli > 0 AND i.archived_at IS NULL
        """),
    }


def _payloads() -> tuple[dict[str, Any], dict[str, Any]]:
    connection = connect()
    try:
        connection.execute("BEGIN")
        state = dashboard(connection)
        extra = _extra_counts(connection)
        quantities = {
            row["unit"]: round(row["quantity_milli"] / 1000, 3)
            for row in connection.execute(
                "SELECT unit, sum(quantity_milli) AS quantity_milli FROM items "
                "WHERE archived_at IS NULL GROUP BY unit ORDER BY unit"
            )
        }
    finally:
        connection.close()
    payload = {
        "item_count": state["item_count"],
        "location_count": state["location_count"],
        "low_stock_count": state["low_stock_count"],
        "expiring_count": state["expiring_count"],
        "needs_details_count": state["needs_details_count"],
        "updated_at": datetime.now(UTC).isoformat(),
        "version": __version__,
    }
    payload.update(extra)
    attributes = {
        "quantity_by_unit": quantities,
        "recent_events": [
            {
                "action": event.get("action"),
                "item": event.get("item_name"),
                "item_id": event.get("item_public_id"),
                "at": _as_utc_isoformat(event.get("created_at")),
            }
            for event in state.get("recent_events", [])
        ],
    }
    return payload, attributes


def _state_payload() -> dict[str, Any]:
    return _payloads()[0]


def _publish(
    client: Any, topic: str, payload: dict[str, Any] | str, *, retain: bool = True
) -> None:
    body = payload if isinstance(payload, str) else json.dumps(payload, separators=(",", ":"))
    result = client.publish(topic, body, qos=0, retain=retain)
    result.wait_for_publish(timeout=5)


def _connect_client(settings: MQTTServiceConfig, *, announce_availability: bool = True) -> Any:
    import paho.mqtt.client as mqtt

    kwargs: dict[str, Any] = {"client_id": settings.client_id}
    if hasattr(mqtt, "CallbackAPIVersion"):
        kwargs["callback_api_version"] = mqtt.CallbackAPIVersion.VERSION2
    client = mqtt.Client(**kwargs)
    client.reconnect_delay_set(min_delay=2, max_delay=60)
    if settings.username:
        client.username_pw_set(settings.username, settings.password or None)
    if announce_availability:
        client.will_set(_topic(settings, "status"), "offline", qos=0, retain=True)
    client.connect(settings.host, settings.port, keepalive=30)
    client.loop_start()
    return client


def _publish_discovery(client: Any, settings: MQTTServiceConfig) -> None:
    prefix = settings.discovery_prefix.strip("/")
    for sensor in SENSORS:
        _publish(
            client,
            f"{prefix}/sensor/findstuff/{sensor['key']}/config",
            _sensor_config(settings, sensor),
        )
    _publish(
        client,
        f"{prefix}/binary_sensor/findstuff/online/config",
        _availability_config(settings),
    )


async def test_mqtt_connection(settings: MQTTServiceConfig) -> None:
    if not settings.host:
        raise ValueError("Save an MQTT broker host first")
    # A connection test must not evict the running publisher or change its availability.
    test_settings = replace(settings, client_id=f"findstuff-test-{uuid4().hex[:8]}")
    client = await asyncio.to_thread(_connect_client, test_settings, announce_availability=False)
    try:
        await asyncio.to_thread(_publish_discovery, client, settings)
        state, attributes = await asyncio.to_thread(_payloads)
        await asyncio.to_thread(_publish, client, _topic(settings, "state"), state)
        await asyncio.to_thread(_publish, client, _topic(settings, "attributes"), attributes)
    finally:
        client.loop_stop()
        client.disconnect()


async def _wait_for_configuration(seconds: int) -> None:
    if _configuration_event is None:
        await asyncio.sleep(seconds)
        return
    try:
        await asyncio.wait_for(_configuration_event.wait(), timeout=seconds)
    except TimeoutError:
        pass
    _configuration_event.clear()


async def _disconnect_client(client: Any, settings: MQTTServiceConfig | None) -> None:
    try:
        if settings is not None:
            await asyncio.to_thread(_publish, client, _topic(settings, "status"), "offline")
    except Exception:
        LOGGER.debug("Could not publish MQTT offline status", exc_info=True)
    finally:
        await asyncio.to_thread(client.disconnect)
        await asyncio.to_thread(client.loop_stop)


async def run_home_assistant_mqtt() -> None:
    global _configuration_event
    _configuration_event = asyncio.Event()
    client: Any | None = None
    active: MQTTServiceConfig | None = None
    try:
        while True:
            connection = connect()
            try:
                settings = get_mqtt_config(connection)
            finally:
                connection.close()

            if not settings.enabled or not settings.host:
                if client is not None:
                    await _disconnect_client(client, active)
                    client = None
                    active = None
                # Saving MQTT settings signals the event immediately. A long fallback
                # avoids repeatedly opening SQLite while MQTT is disabled.
                await _wait_for_configuration(3600)
                continue

            try:
                if client is None or settings != active:
                    if client is not None:
                        await _disconnect_client(client, active)
                    client = await asyncio.to_thread(_connect_client, settings)
                    active = settings
                    await asyncio.to_thread(_publish_discovery, client, settings)
                await asyncio.to_thread(_publish, client, _topic(settings, "status"), "online")
                state, attributes = await asyncio.to_thread(_payloads)
                await asyncio.to_thread(_publish, client, _topic(settings, "state"), state)
                await asyncio.to_thread(
                    _publish, client, _topic(settings, "attributes"), attributes
                )
                await _wait_for_configuration(settings.publish_interval_seconds)
            except asyncio.CancelledError:
                raise
            except Exception:
                LOGGER.exception("Home Assistant MQTT publish failed; retrying")
                if client is not None:
                    await _disconnect_client(client, active)
                    client = None
                    active = None
                await _wait_for_configuration(15)
    finally:
        if client is not None:
            await _disconnect_client(client, active)
        _configuration_event = None
