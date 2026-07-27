from __future__ import annotations

import json
import sqlite3
import zipfile
from pathlib import Path

import pytest

from findstuff.backups import (
    apply_pending_restore,
    backup_archive,
    backup_if_due,
    backup_status,
    restore_status,
    stage_backup_restore,
)
from findstuff.cli import backup
from findstuff.db import connect, migrate
from findstuff.inventory import create_item
from findstuff.photos import store_photo


def test_online_backup_contains_inventory(tmp_path: Path, monkeypatch) -> None:
    data = tmp_path / "data"
    database_path = data / "findstuff.sqlite3"
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(data))
    monkeypatch.setenv("FINDSTUFF_DATABASE_PATH", str(database_path))
    migrate(database_path)
    connection = connect(database_path)
    create_item(connection, {"name": "Backed up item", "quantity": 1})
    connection.close()

    result = backup(tmp_path / "backups", keep=2)
    assert (result / "manifest.json").is_file()
    restored = sqlite3.connect(result / "findstuff.sqlite3")
    try:
        assert restored.execute("SELECT name FROM items").fetchone()[0] == "Backed up item"
    finally:
        restored.close()


def test_backup_archive_contains_inventory_and_manifest(tmp_path: Path, monkeypatch) -> None:
    data = tmp_path / "data"
    database_path = data / "findstuff.sqlite3"
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(data))
    monkeypatch.setenv("FINDSTUFF_DATABASE_PATH", str(database_path))
    migrate(database_path)
    connection = connect(database_path)
    create_item(connection, {"name": "Archived backup item", "quantity": 1})
    connection.close()
    (data / "admin-password").write_text("private-admin-password\n", encoding="utf-8")
    (data / "session-secret").write_text("private-session-secret\n", encoding="utf-8")
    (data / "service-secrets.json").write_text(
        '{"ai_api_key":"private-ai-key"}\n',
        encoding="utf-8",
    )

    result = backup_archive(tmp_path / "downloads")

    assert result.name.startswith("findstuff-backup-")
    with zipfile.ZipFile(result) as archive:
        names = set(archive.namelist())
        assert {"findstuff.sqlite3", "manifest.json"}.issubset(names)
        assert "admin-password" not in names
        assert "session-secret" not in names
        assert "service-secrets.json" not in names
        archive.extract("findstuff.sqlite3", tmp_path / "restored")
    restored = sqlite3.connect(tmp_path / "restored" / "findstuff.sqlite3")
    try:
        assert restored.execute("SELECT name FROM items").fetchone()[0] == "Archived backup item"
    finally:
        restored.close()


def test_backup_if_due_runs_once_per_utc_day(tmp_path: Path, monkeypatch) -> None:
    data = tmp_path / "data"
    database_path = data / "findstuff.sqlite3"
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(data))
    monkeypatch.setenv("FINDSTUFF_DATABASE_PATH", str(database_path))
    migrate(database_path)
    connection = connect(database_path)
    create_item(connection, {"name": "Daily backup item", "quantity": 1})
    connection.close()

    output = tmp_path / "backups"
    first = backup_if_due(output, keep=2)
    second = backup_if_due(output, keep=2)

    assert first is not None
    assert (first / "findstuff.sqlite3").is_file()
    assert second is None


def test_backup_status_reports_latest_automatic_backup(tmp_path: Path, monkeypatch) -> None:
    data = tmp_path / "data"
    database_path = data / "findstuff.sqlite3"
    output = data / "backups"
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(data))
    monkeypatch.setenv("FINDSTUFF_DATABASE_PATH", str(database_path))
    monkeypatch.setenv("FINDSTUFF_BACKUP_DIR", str(output))
    monkeypatch.setenv("FINDSTUFF_BACKUP_KEEP", "7")
    migrate(database_path)

    created = backup_if_due(output, keep=7)
    status = backup_status(output)

    assert created is not None
    assert status["enabled"] is True
    assert status["backup_count"] == 1
    assert status["retention"] == 7
    assert status["last_backup_at"] is not None


def test_full_backup_can_be_staged_and_restored_safely(
    tmp_path: Path, monkeypatch
) -> None:
    data = tmp_path / "data"
    database_path = data / "findstuff.sqlite3"
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(data))
    monkeypatch.setenv("FINDSTUFF_DATABASE_PATH", str(database_path))
    monkeypatch.setenv("FINDSTUFF_BACKUP_DIR", str(data / "backups"))
    migrate(database_path)

    connection = connect(database_path)
    restored_item = create_item(connection, {"name": "Restored item", "quantity": 1})
    store_photo(
        connection,
        restored_item["public_id"],
        b"\xff\xd8\xffrestore-photo",
        "image/jpeg",
        320,
        240,
    )
    connection.close()
    archive = backup_archive(tmp_path / "exports")

    connection = connect(database_path)
    create_item(connection, {"name": "Current item to replace", "quantity": 1})
    connection.close()
    secrets_path = data / "service-secrets.json"
    secrets_path.write_text('{"ai_api_key":"keep-me"}\n', encoding="utf-8")

    queued = stage_backup_restore(archive, archive.name)
    assert queued["status"] == "restart_queued"
    assert queued["counts"]["items"] == 1

    result = apply_pending_restore()
    assert result is not None
    assert result["status"] == "complete"
    assert (data / result["safety_backup"]).is_dir()
    assert restore_status()["status"] == "complete"

    restored = connect(database_path)
    try:
        names = [row[0] for row in restored.execute("SELECT name FROM items ORDER BY id")]
        photo_path = restored.execute("SELECT file_path FROM photos").fetchone()[0]
    finally:
        restored.close()
    assert names == ["Restored item"]
    assert (data / photo_path).read_bytes() == b"\xff\xd8\xffrestore-photo"
    assert json.loads(secrets_path.read_text(encoding="utf-8"))["ai_api_key"] == "keep-me"


def test_restore_rejects_unsafe_or_non_findstuff_archives(
    tmp_path: Path, monkeypatch
) -> None:
    data = tmp_path / "data"
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(data))
    monkeypatch.setenv("FINDSTUFF_DATABASE_PATH", str(data / "findstuff.sqlite3"))

    traversal = tmp_path / "traversal.zip"
    with zipfile.ZipFile(traversal, "w") as archive:
        archive.writestr("../outside", "no")
        archive.writestr(
            "manifest.json",
            json.dumps({"app": "findstuff", "format_version": 1}),
        )
        archive.writestr("findstuff.sqlite3", "not sqlite")
    with pytest.raises(ValueError, match="unsafe"):
        stage_backup_restore(traversal, traversal.name)
    assert not (tmp_path / "outside").exists()

    invalid = tmp_path / "invalid.zip"
    with zipfile.ZipFile(invalid, "w") as archive:
        archive.writestr(
            "manifest.json",
            json.dumps({"app": "some-other-app", "format_version": 1}),
        )
        archive.writestr("findstuff.sqlite3", "not sqlite")
    with pytest.raises(ValueError, match="supported Findstuff"):
        stage_backup_restore(invalid, invalid.name)
