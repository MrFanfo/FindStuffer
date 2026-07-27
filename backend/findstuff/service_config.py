from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import httpx

from .config import get_settings
from .db import transaction
from .network_security import validate_http_url

AI_SETTINGS_KEY = "ai_service"
MQTT_SETTINGS_KEY = "mqtt_service"
SECRETS_FILENAME = "service-secrets.json"


@dataclass(frozen=True)
class AIServiceConfig:
    enabled: bool
    endpoint: str
    api_key: str
    model: str


@dataclass(frozen=True)
class MQTTServiceConfig:
    enabled: bool
    host: str
    port: int
    username: str
    password: str
    base_topic: str
    discovery_prefix: str
    client_id: str
    publish_interval_seconds: int


def _stored_settings(connection: sqlite3.Connection, key: str) -> dict[str, Any] | None:
    row = connection.execute(
        "SELECT value_json FROM app_settings WHERE key = ?", (key,)
    ).fetchone()
    if row is None:
        return None
    try:
        value = json.loads(row["value_json"])
    except (json.JSONDecodeError, TypeError):
        return {}
    return value if isinstance(value, dict) else {}


def _secrets_path() -> Path:
    return get_settings().data_dir / SECRETS_FILENAME


def _read_secrets() -> dict[str, str]:
    path = _secrets_path()
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(value, dict):
        return {}
    return {str(key): str(secret) for key, secret in value.items() if secret is not None}


def _write_secrets(values: dict[str, str]) -> None:
    path = _secrets_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(values, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
    os.chmod(path, 0o600)


def get_ai_config(connection: sqlite3.Connection) -> AIServiceConfig:
    runtime = get_settings()
    stored = _stored_settings(connection, AI_SETTINGS_KEY)
    secrets = _read_secrets()
    api_key = (
        secrets["ai_api_key"]
        if "ai_api_key" in secrets
        else runtime.ai_api_key
    )
    if stored is None:
        return AIServiceConfig(
            enabled=bool(runtime.ai_endpoint and runtime.ai_model),
            endpoint=runtime.ai_endpoint,
            api_key=api_key,
            model=runtime.ai_model,
        )
    return AIServiceConfig(
        enabled=bool(stored.get("enabled", False)),
        endpoint=str(stored.get("endpoint", "")).strip(),
        api_key=api_key,
        model=str(stored.get("model", "")).strip(),
    )


def public_ai_config(connection: sqlite3.Connection) -> dict[str, Any]:
    config = get_ai_config(connection)
    return {
        "enabled": config.enabled,
        "endpoint": config.endpoint,
        "model": config.model,
        "api_key_set": bool(config.api_key),
    }


def save_ai_config(
    connection: sqlite3.Connection, values: dict[str, Any]
) -> dict[str, Any]:
    endpoint = str(values["endpoint"]).strip()
    model = str(values["model"]).strip()
    enabled = bool(values["enabled"])
    if endpoint:
        endpoint = validate_http_url(endpoint)
    if enabled and (not endpoint or not model):
        raise ValueError("AI endpoint and model are required when AI is enabled")

    api_key = str(values.get("api_key", ""))
    clear_api_key = bool(values.get("clear_api_key", False))
    secrets = _read_secrets()
    if clear_api_key:
        # An explicit empty value also masks any legacy environment fallback.
        secrets["ai_api_key"] = ""
    elif api_key:
        secrets["ai_api_key"] = api_key
    if clear_api_key or api_key:
        _write_secrets(secrets)

    stored = {"enabled": enabled, "endpoint": endpoint, "model": model}
    with transaction(connection):
        connection.execute(
            """
            INSERT INTO app_settings(key, value_json) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (AI_SETTINGS_KEY, json.dumps(stored, separators=(",", ":"))),
        )
    return public_ai_config(connection)


async def test_ai_connection(connection: sqlite3.Connection) -> None:
    config = get_ai_config(connection)
    if not config.endpoint or not config.model:
        raise ValueError("Save an AI endpoint and model first")
    headers = {"Content-Type": "application/json"}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(30.0), headers=headers, trust_env=False
    ) as client:
        response = await client.post(
            config.endpoint,
            json={
                "model": config.model,
                "messages": [
                    {
                        "role": "user",
                        "content": "Reply with the single word OK.",
                    }
                ],
                "temperature": 0,
                "max_tokens": 8,
            },
        )
        response.raise_for_status()
        body = response.json()
    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError("AI provider returned an unexpected response") from exc
    if not isinstance(content, str) or not content.strip():
        raise ValueError("AI provider returned an empty response")


def get_mqtt_config(connection: sqlite3.Connection) -> MQTTServiceConfig:
    runtime = get_settings()
    stored = _stored_settings(connection, MQTT_SETTINGS_KEY)
    secrets = _read_secrets()
    password = (
        secrets["mqtt_password"]
        if "mqtt_password" in secrets
        else runtime.mqtt_password
    )
    if stored is None:
        return MQTTServiceConfig(
            enabled=bool(runtime.mqtt_host),
            host=runtime.mqtt_host,
            port=runtime.mqtt_port,
            username=runtime.mqtt_username,
            password=password,
            base_topic=runtime.mqtt_base_topic,
            discovery_prefix=runtime.mqtt_discovery_prefix,
            client_id=runtime.mqtt_client_id,
            publish_interval_seconds=runtime.mqtt_publish_interval_seconds,
        )
    return MQTTServiceConfig(
        enabled=bool(stored.get("enabled", False)),
        host=str(stored.get("host", "")).strip(),
        port=int(stored.get("port", 1883)),
        username=str(stored.get("username", "")).strip(),
        password=password,
        base_topic=str(stored.get("base_topic", "findstuff")).strip("/"),
        discovery_prefix=str(
            stored.get("discovery_prefix", "homeassistant")
        ).strip("/"),
        client_id=str(stored.get("client_id", "findstuff")).strip(),
        publish_interval_seconds=int(stored.get("publish_interval_seconds", 60)),
    )


def public_mqtt_config(connection: sqlite3.Connection) -> dict[str, Any]:
    config = get_mqtt_config(connection)
    return {
        **{
            key: value
            for key, value in asdict(config).items()
            if key != "password"
        },
        "password_set": bool(config.password),
    }


def save_mqtt_config(
    connection: sqlite3.Connection, values: dict[str, Any]
) -> dict[str, Any]:
    stored = {
        "enabled": bool(values["enabled"]),
        "host": str(values["host"]).strip(),
        "port": int(values["port"]),
        "username": str(values["username"]).strip(),
        "base_topic": str(values["base_topic"]).strip("/"),
        "discovery_prefix": str(values["discovery_prefix"]).strip("/"),
        "client_id": str(values["client_id"]).strip(),
        "publish_interval_seconds": int(values["publish_interval_seconds"]),
    }
    if stored["enabled"] and not stored["host"]:
        raise ValueError("MQTT broker host is required when MQTT is enabled")
    if "://" in stored["host"] or any(character.isspace() for character in stored["host"]):
        raise ValueError("MQTT host must be a hostname or IP address without a URL scheme")
    if stored["enabled"] and (
        not stored["base_topic"]
        or not stored["discovery_prefix"]
        or not stored["client_id"]
    ):
        raise ValueError("MQTT topics and client ID cannot be empty")
    if any(
        character in f"{stored['base_topic']}{stored['discovery_prefix']}"
        for character in ("#", "+", "\x00")
    ):
        raise ValueError("MQTT base topic and discovery prefix cannot contain wildcards")

    password = str(values.get("password", ""))
    clear_password = bool(values.get("clear_password", False))
    secrets = _read_secrets()
    if clear_password:
        secrets["mqtt_password"] = ""
    elif password:
        secrets["mqtt_password"] = password
    if clear_password or password:
        _write_secrets(secrets)

    with transaction(connection):
        connection.execute(
            """
            INSERT INTO app_settings(key, value_json) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (MQTT_SETTINGS_KEY, json.dumps(stored, separators=(",", ":"))),
        )
    return public_mqtt_config(connection)
