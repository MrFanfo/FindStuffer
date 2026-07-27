from __future__ import annotations

import asyncio
import importlib
import json
import stat
import zipfile
from pathlib import Path

import httpx

from findstuff.backups import backup_archive
from findstuff.db import connect, migrate
from findstuff.extended import export_inventory
from findstuff.service_config import get_ai_config, get_mqtt_config


def test_ai_and_mqtt_secrets_are_write_only_and_not_exported(
    tmp_path: Path, monkeypatch
) -> None:
    database_path = tmp_path / "findstuff.sqlite3"
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FINDSTUFF_DATABASE_PATH", str(database_path))
    monkeypatch.setenv("FINDSTUFF_AUTO_BACKUP_ENABLED", "false")
    monkeypatch.delenv("FINDSTUFF_AI_API_KEY", raising=False)
    monkeypatch.delenv("FINDSTUFF_MQTT_PASSWORD", raising=False)

    import findstuff.app as app_module

    app_module = importlib.reload(app_module)

    async def scenario() -> None:
        transport = httpx.ASGITransport(app=app_module.app)
        async with app_module.app.router.lifespan_context(app_module.app):
            async with httpx.AsyncClient(
                transport=transport, base_url="http://testserver"
            ) as client:
                ai = await client.put(
                    "/api/v1/settings/ai",
                    json={
                        "enabled": True,
                        "endpoint": "https://ai.example/v1/chat/completions",
                        "model": "vision-model",
                        "api_key": "private-ai-key",
                        "clear_api_key": False,
                    },
                )
                assert ai.status_code == 200
                assert ai.json()["api_key_set"] is True
                assert "private-ai-key" not in ai.text

                mqtt = await client.put(
                    "/api/v1/settings/mqtt",
                    json={
                        "enabled": False,
                        "host": "mqtt.example",
                        "port": 1883,
                        "username": "findstuff",
                        "password": "private-mqtt-password",
                        "clear_password": False,
                        "base_topic": "findstuff",
                        "discovery_prefix": "homeassistant",
                        "client_id": "findstuff",
                        "publish_interval_seconds": 60,
                    },
                )
                assert mqtt.status_code == 200
                assert mqtt.json()["password_set"] is True
                assert "private-mqtt-password" not in mqtt.text

                settings = await client.get("/api/v1/settings")
                assert settings.status_code == 200
                assert "private-ai-key" not in settings.text
                assert "private-mqtt-password" not in settings.text

    asyncio.run(scenario())

    connection = connect(database_path)
    try:
        assert get_ai_config(connection).api_key == "private-ai-key"
        assert get_mqtt_config(connection).password == "private-mqtt-password"
        exported = json.dumps(export_inventory(connection))
        assert "private-ai-key" not in exported
        assert "private-mqtt-password" not in exported
    finally:
        connection.close()

    secrets_path = tmp_path / "service-secrets.json"
    assert stat.S_IMODE(secrets_path.stat().st_mode) == 0o600
    archive = backup_archive(tmp_path / "downloads")
    with zipfile.ZipFile(archive) as zipped:
        assert "service-secrets.json" not in zipped.namelist()
        assert b"private-ai-key" not in zipped.read("findstuff.sqlite3")
        assert b"private-mqtt-password" not in zipped.read("findstuff.sqlite3")


def test_legacy_environment_values_seed_editable_configuration(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FINDSTUFF_DATABASE_PATH", str(tmp_path / "legacy.sqlite3"))
    monkeypatch.setenv("FINDSTUFF_AI_ENDPOINT", "https://legacy.example/v1/chat/completions")
    monkeypatch.setenv("FINDSTUFF_AI_API_KEY", "legacy-ai-key")
    monkeypatch.setenv("FINDSTUFF_AI_MODEL", "legacy-model")
    monkeypatch.setenv("FINDSTUFF_MQTT_HOST", "legacy-broker")
    monkeypatch.setenv("FINDSTUFF_MQTT_PASSWORD", "legacy-mqtt-password")
    migrate()
    connection = connect()
    try:
        ai = get_ai_config(connection)
        mqtt = get_mqtt_config(connection)
        assert ai.enabled is True
        assert ai.api_key == "legacy-ai-key"
        assert mqtt.enabled is True
        assert mqtt.password == "legacy-mqtt-password"
    finally:
        connection.close()
