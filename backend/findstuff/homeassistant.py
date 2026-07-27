from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any

from . import __version__
from .db import connect
from .inventory import dashboard
from .service_config import MQTTServiceConfig, get_mqtt_config

LOGGER = logging.getLogger(__name__)

SENSORS: tuple[dict[str, str], ...] = (
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


def _sensor_config(settings: MQTTServiceConfig, sensor: dict[str, str]) -> dict[str, Any]:
    name = sensor["name"]
    key = sensor["key"]
    return {
        "name": name,
        "unique_id": f"findstuff_{key}",
        "object_id": f"findstuff_{key}",
        "state_topic": _topic(settings, "state"),
        "value_template": f"{{{{ value_json.{key} }}}}",
        "availability_topic": _topic(settings, "status"),
        "payload_available": "online",
        "payload_not_available": "offline",
        "icon": sensor["icon"],
        "state_class": "measurement",
        "device": _device(settings),
    }


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


def _state_payload() -> dict[str, Any]:
    connection = connect()
    try:
        state = dashboard(connection)
    finally:
        connection.close()
    return {
        "item_count": state["item_count"],
        "location_count": state["location_count"],
        "low_stock_count": state["low_stock_count"],
        "expiring_count": state["expiring_count"],
        "needs_details_count": state["needs_details_count"],
        "updated_at": datetime.now(UTC).isoformat(),
        "version": __version__,
    }


def _publish(
    client: Any, topic: str, payload: dict[str, Any] | str, *, retain: bool = True
) -> None:
    body = payload if isinstance(payload, str) else json.dumps(payload, separators=(",", ":"))
    result = client.publish(topic, body, qos=0, retain=retain)
    result.wait_for_publish(timeout=5)


def _connect_client(settings: MQTTServiceConfig) -> Any:
    import paho.mqtt.client as mqtt

    kwargs: dict[str, Any] = {"client_id": settings.client_id}
    if hasattr(mqtt, "CallbackAPIVersion"):
        kwargs["callback_api_version"] = mqtt.CallbackAPIVersion.VERSION2
    client = mqtt.Client(**kwargs)
    client.reconnect_delay_set(min_delay=2, max_delay=60)
    if settings.username:
        client.username_pw_set(settings.username, settings.password or None)
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
    client = await asyncio.to_thread(_connect_client, settings)
    try:
        await asyncio.to_thread(_publish_discovery, client, settings)
        await asyncio.to_thread(_publish, client, _topic(settings, "status"), "online")
        await asyncio.to_thread(_publish, client, _topic(settings, "state"), _state_payload())
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
                    client.loop_stop()
                    client.disconnect()
                    client = None
                    active = None
                # Saving MQTT settings signals the event immediately. A long fallback
                # avoids repeatedly opening SQLite while MQTT is disabled.
                await _wait_for_configuration(3600)
                continue

            try:
                if client is None or settings != active:
                    if client is not None:
                        client.loop_stop()
                        client.disconnect()
                    client = await asyncio.to_thread(_connect_client, settings)
                    await asyncio.to_thread(_publish_discovery, client, settings)
                    active = settings
                await asyncio.to_thread(_publish, client, _topic(settings, "status"), "online")
                await asyncio.to_thread(
                    _publish, client, _topic(settings, "state"), _state_payload()
                )
                await _wait_for_configuration(settings.publish_interval_seconds)
            except asyncio.CancelledError:
                raise
            except Exception:
                LOGGER.exception("Home Assistant MQTT publish failed; retrying")
                if client is not None:
                    client.loop_stop()
                    client.disconnect()
                    client = None
                    active = None
                await _wait_for_configuration(15)
    finally:
        if client is not None:
            try:
                if active is not None:
                    await asyncio.to_thread(
                        _publish, client, _topic(active, "status"), "offline"
                    )
            except Exception:
                LOGGER.debug("Could not publish MQTT offline status", exc_info=True)
            client.loop_stop()
            client.disconnect()
        _configuration_event = None
