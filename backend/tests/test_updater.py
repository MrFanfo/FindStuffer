from __future__ import annotations

import json
from pathlib import Path

from findstuff import updater
from findstuff.updater import request_software_update, software_update_status


def test_software_update_request_writes_trigger_and_status(
    tmp_path: Path, monkeypatch,
) -> None:
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))

    initial = software_update_status()
    assert initial["status"] == "idle"
    assert initial["request_pending"] is False

    queued = request_software_update()

    request_path = tmp_path / "update-request"
    status_path = tmp_path / "update-status.json"
    assert request_path.exists()
    assert status_path.exists()
    assert queued["status"] == "queued"
    assert queued["request_pending"] is True
    assert json.loads(request_path.read_text(encoding="utf-8"))["requested_at"]


def test_software_update_status_includes_last_30_log_lines(
    tmp_path: Path, monkeypatch,
) -> None:
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    (tmp_path / "update.log").write_text(
        "\n".join(f"line {index}" for index in range(40)),
        encoding="utf-8",
    )

    status = software_update_status()

    assert len(status["log_tail"]) == 30
    assert status["log_tail"][0] == "line 10"
    assert status["log_tail"][-1] == "line 39"


def test_software_update_status_compares_release_versions(
    tmp_path: Path, monkeypatch,
) -> None:
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FINDSTUFF_SOFTWARE_UPDATE_ENABLED", "true")
    monkeypatch.setattr(
        updater,
        "_latest_release",
        lambda: {
            "latest_version": "99.0.0",
            "release_url": "https://github.com/MrFanfo/FindStuffer/releases/tag/v99.0.0",
            "release_check_error": None,
        },
    )

    status = software_update_status()

    assert status["current_version"]
    assert status["latest_version"] == "99.0.0"
    assert status["update_available"] is True
