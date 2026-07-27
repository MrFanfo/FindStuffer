from __future__ import annotations

import json
import os
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from . import __version__
from .config import get_settings

RELEASES_API = "https://api.github.com/repos/MrFanfo/FindStuffer/releases/latest"
RELEASE_CACHE_SECONDS = 300
_release_cache: tuple[float, dict[str, Any]] | None = None


def _now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _paths() -> tuple[Path, Path, Path]:
    data_dir = get_settings().data_dir
    return (
        data_dir / "update-request",
        data_dir / "update-status.json",
        data_dir / "update.log",
    )


def _log_tail(path: Path, lines: int = 30) -> list[str]:
    if not path.exists():
        return []
    try:
        return path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:]
    except OSError:
        return []


def _is_stale_queued(status: dict[str, Any], request_path: Path) -> bool:
    if status.get("status") != "queued" or not request_path.exists():
        return False
    requested_at = status.get("requested_at")
    if not isinstance(requested_at, str):
        return False
    try:
        requested = datetime.fromisoformat(requested_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    return (datetime.now(UTC) - requested).total_seconds() > 120


def _docker_hint() -> str:
    if not Path("/.dockerenv").exists() and os.environ.get("FINDSTUFF_CONTAINER") != "1":
        return ""
    return (
        " Docker installs need the host updater watcher because the container cannot "
        "rebuild and restart itself."
    )


def _version_key(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", value)[:3])


def _latest_release() -> dict[str, Any]:
    global _release_cache
    now = time.monotonic()
    if _release_cache and now - _release_cache[0] < RELEASE_CACHE_SECONDS:
        return _release_cache[1]
    result: dict[str, Any] = {
        "latest_version": None,
        "release_url": None,
        "release_check_error": None,
    }
    try:
        with httpx.Client(
            timeout=3,
            trust_env=False,
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": f"FindStuffer/{__version__}",
            },
        ) as client:
            response = client.get(RELEASES_API)
            response.raise_for_status()
            payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Unexpected release response")
        tag = payload.get("tag_name")
        if isinstance(tag, str) and tag.strip():
            result["latest_version"] = tag.removeprefix("v")
        url = payload.get("html_url")
        if isinstance(url, str) and url.startswith("https://github.com/"):
            result["release_url"] = url
    except (httpx.HTTPError, json.JSONDecodeError, ValueError):
        result["release_check_error"] = "Could not check GitHub releases."
    _release_cache = (now, result)
    return result


def software_update_status() -> dict[str, Any]:
    request_path, status_path, log_path = _paths()
    status: dict[str, Any] = {
        "status": "idle",
        "message": "No update has been requested yet.",
        "requested_at": None,
        "started_at": None,
        "completed_at": None,
        "version": None,
        "request_pending": request_path.exists(),
        "log_tail": _log_tail(log_path),
        "current_version": __version__,
        "latest_version": None,
        "update_available": None,
        "release_url": None,
        "release_check_error": None,
    }
    if status_path.exists():
        try:
            loaded = json.loads(status_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                status.update(loaded)
        except (OSError, json.JSONDecodeError):
            status["status"] = "unknown"
            status["message"] = "Update status file could not be read."
    if _is_stale_queued(status, request_path):
        status["status"] = "attention"
        status["message"] = (
            "Update request is still queued; no updater watcher has picked it up yet."
            + _docker_hint()
        )
    status["request_pending"] = request_path.exists()
    status["log_tail"] = _log_tail(log_path)
    status.pop("commit", None)
    if get_settings().software_update_enabled:
        release = _latest_release()
        status.update(release)
        latest = release["latest_version"]
        if isinstance(latest, str):
            status["update_available"] = _version_key(latest) > _version_key(__version__)
    return status


def request_software_update() -> dict[str, Any]:
    request_path, status_path, _log_path = _paths()
    request_path.parent.mkdir(parents=True, exist_ok=True)
    status = {
        "status": "queued",
        "message": "Software update queued. The app will restart after it is installed."
        + _docker_hint(),
        "requested_at": _now(),
        "started_at": None,
        "completed_at": None,
        "version": None,
    }
    status_path.write_text(json.dumps(status, indent=2), encoding="utf-8")
    request_path.write_text(json.dumps({"requested_at": status["requested_at"]}), encoding="utf-8")
    return software_update_status()
