from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    database_path: Path
    frontend_dist: Path
    secure_cookies: bool
    ai_endpoint: str
    ai_api_key: str
    ai_model: str
    stt_endpoint: str
    stt_api_key: str
    stt_model: str
    mqtt_host: str
    mqtt_port: int
    mqtt_username: str
    mqtt_password: str
    mqtt_base_topic: str
    mqtt_discovery_prefix: str
    mqtt_client_id: str
    mqtt_publish_interval_seconds: int
    auto_backup_enabled: bool
    backup_dir: Path
    backup_keep: int
    backup_check_interval_seconds: int
    admin_username: str
    admin_password: str
    require_auth: bool
    software_update_enabled: bool
    allow_private_integration_urls: bool
    external_image_hosts: tuple[str, ...]


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _secret(name: str) -> str:
    file_value = os.environ.get(f"{name}_FILE", "").strip()
    if file_value:
        try:
            return Path(file_value).read_text(encoding="utf-8").strip()
        except OSError:
            return ""
    return os.environ.get(name, "")


def get_settings() -> Settings:
    project_root = Path(__file__).resolve().parents[2]
    data_dir = Path(os.environ.get("FINDSTUFF_DATA_DIR", project_root / "data")).resolve()
    database_path = Path(
        os.environ.get("FINDSTUFF_DATABASE_PATH", data_dir / "findstuff.sqlite3")
    ).resolve()
    frontend_dist = Path(
        os.environ.get("FINDSTUFF_FRONTEND_DIST", project_root / "frontend" / "dist")
    ).resolve()
    backup_dir = Path(os.environ.get("FINDSTUFF_BACKUP_DIR", data_dir / "backups")).resolve()
    return Settings(
        data_dir=data_dir,
        database_path=database_path,
        frontend_dist=frontend_dist,
        secure_cookies=os.environ.get("FINDSTUFF_SECURE_COOKIES", "false").lower()
        in {"1", "true", "yes"},
        ai_endpoint=os.environ.get("FINDSTUFF_AI_ENDPOINT", ""),
        ai_api_key=os.environ.get("FINDSTUFF_AI_API_KEY", ""),
        ai_model=os.environ.get("FINDSTUFF_AI_MODEL", ""),
        stt_endpoint=os.environ.get("FINDSTUFF_STT_ENDPOINT", ""),
        stt_api_key=os.environ.get("FINDSTUFF_STT_API_KEY", ""),
        stt_model=os.environ.get("FINDSTUFF_STT_MODEL", ""),
        mqtt_host=os.environ.get("FINDSTUFF_MQTT_HOST", ""),
        mqtt_port=_env_int("FINDSTUFF_MQTT_PORT", 1883),
        mqtt_username=os.environ.get("FINDSTUFF_MQTT_USERNAME", ""),
        mqtt_password=os.environ.get("FINDSTUFF_MQTT_PASSWORD", ""),
        mqtt_base_topic=os.environ.get("FINDSTUFF_MQTT_BASE_TOPIC", "findstuff"),
        mqtt_discovery_prefix=os.environ.get(
            "FINDSTUFF_MQTT_DISCOVERY_PREFIX", "homeassistant"
        ),
        mqtt_client_id=os.environ.get("FINDSTUFF_MQTT_CLIENT_ID", "findstuff"),
        mqtt_publish_interval_seconds=max(
            15, _env_int("FINDSTUFF_MQTT_PUBLISH_INTERVAL_SECONDS", 60)
        ),
        auto_backup_enabled=os.environ.get("FINDSTUFF_AUTO_BACKUP_ENABLED", "true").lower()
        not in {"0", "false", "no", "off"},
        backup_dir=backup_dir,
        backup_keep=min(5, max(1, _env_int("FINDSTUFF_BACKUP_KEEP", 5))),
        backup_check_interval_seconds=max(
            60, _env_int("FINDSTUFF_BACKUP_CHECK_INTERVAL_SECONDS", 3600)
        ),
        admin_username=os.environ.get("FINDSTUFF_ADMIN_USERNAME", "admin").strip() or "admin",
        admin_password=_secret("FINDSTUFF_ADMIN_PASSWORD"),
        require_auth=os.environ.get("FINDSTUFF_REQUIRE_AUTH", "false").lower()
        in {"1", "true", "yes", "on"},
        software_update_enabled=os.environ.get(
            "FINDSTUFF_SOFTWARE_UPDATE_ENABLED", "false"
        ).lower()
        in {"1", "true", "yes", "on"},
        allow_private_integration_urls=os.environ.get(
            "FINDSTUFF_ALLOW_PRIVATE_INTEGRATION_URLS", "false"
        ).lower()
        in {"1", "true", "yes", "on"},
        external_image_hosts=tuple(
            host.strip().casefold().rstrip(".")
            for host in os.environ.get(
                "FINDSTUFF_EXTERNAL_IMAGE_HOSTS", "images.openfoodfacts.org"
            ).split(",")
            if host.strip()
        ),
    )
