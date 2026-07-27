from __future__ import annotations

import json
import os
import shutil
import sqlite3
import stat
import uuid
import zipfile
from datetime import UTC, date, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from .config import get_settings
from .db import connect, migrate

TIMESTAMP_FORMAT = "%Y%m%dT%H%M%SZ"
MAX_RESTORE_FILES = 25_000
MAX_RESTORE_UNCOMPRESSED_BYTES = 20 * 1024 * 1024 * 1024
MAX_RESTORE_COMPRESSION_RATIO = 250
RESTORE_MARKER = "restore-request.json"
RESTORE_STATUS = "restore-status.json"
REQUIRED_RESTORE_TABLES = {
    "app_settings",
    "categories",
    "inventory_events",
    "items",
    "locations",
    "photos",
    "schema_migrations",
}


def _timestamp() -> str:
    return datetime.now(UTC).strftime(TIMESTAMP_FORMAT)


def _manifest(includes: list[str]) -> dict[str, object]:
    return {
        "created_at": datetime.now(UTC).isoformat(),
        "app": "findstuff",
        "format_version": 1,
        "includes": includes,
    }


def backup(output: Path, keep: int) -> Path:
    settings = get_settings()
    migrate(settings.database_path)
    output.mkdir(parents=True, exist_ok=True)
    timestamp = _timestamp()
    final = output / timestamp
    temporary = output / f".{timestamp}.tmp"
    if temporary.exists():
        shutil.rmtree(temporary)
    temporary.mkdir()

    source = connect(settings.database_path)
    destination = sqlite3.connect(temporary / "findstuff.sqlite3")
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()

    includes = ["findstuff.sqlite3"]
    photos = settings.data_dir / "photos"
    if photos.is_dir():
        shutil.copytree(photos, temporary / "photos")
        includes.append("photos")

    (temporary / "manifest.json").write_text(
        json.dumps(_manifest(includes), indent=2) + "\n", encoding="utf-8"
    )
    os.replace(temporary, final)

    completed = sorted(
        (path for path in output.iterdir() if path.is_dir() and not path.name.startswith(".")),
        reverse=True,
    )
    for expired in completed[max(keep, 1) :]:
        shutil.rmtree(expired)
    return final


def _backup_dates(output: Path) -> set[date]:
    if not output.exists():
        return set()
    dates = set()
    for path in output.iterdir():
        if not path.is_dir() or path.name.startswith("."):
            continue
        try:
            dates.add(datetime.strptime(path.name, TIMESTAMP_FORMAT).replace(tzinfo=UTC).date())
        except ValueError:
            continue
    return dates


def backup_status(output: Path | None = None) -> dict[str, Any]:
    settings = get_settings()
    backup_output = output or settings.backup_dir
    completed: list[datetime] = []
    if backup_output.exists():
        for path in backup_output.iterdir():
            if not path.is_dir() or path.name.startswith("."):
                continue
            try:
                completed.append(
                    datetime.strptime(path.name, TIMESTAMP_FORMAT).replace(tzinfo=UTC)
                )
            except ValueError:
                continue
    completed.sort(reverse=True)
    return {
        "enabled": settings.auto_backup_enabled,
        "last_backup_at": completed[0].isoformat() if completed else None,
        "backup_count": len(completed),
        "retention": settings.backup_keep,
    }


def backup_if_due(
    output: Path | None = None,
    *,
    keep: int | None = None,
    now: datetime | None = None,
) -> Path | None:
    settings = get_settings()
    backup_output = output or settings.backup_dir
    retention = keep if keep is not None else settings.backup_keep
    today = (now or datetime.now(UTC)).astimezone(UTC).date()
    if today in _backup_dates(backup_output):
        return None
    return backup(backup_output, retention)


def backup_archive(output_dir: Path) -> Path:
    settings = get_settings()
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = _timestamp()
    archive_path = output_dir / f"findstuff-backup-{timestamp}.zip"
    snapshot_path = output_dir / f".findstuff-{timestamp}.sqlite3"

    source = connect(settings.database_path)
    destination = sqlite3.connect(snapshot_path)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()

    includes = ["findstuff.sqlite3"]
    photos = settings.data_dir / "photos"
    if photos.is_dir():
        includes.append("photos")

    try:
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(snapshot_path, "findstuff.sqlite3")
            archive.writestr("manifest.json", json.dumps(_manifest(includes), indent=2) + "\n")
            if photos.is_dir():
                for path in sorted(photos.rglob("*")):
                    if path.is_file():
                        archive.write(path, Path("photos") / path.relative_to(photos))
    finally:
        snapshot_path.unlink(missing_ok=True)

    return archive_path


def _restore_root() -> Path:
    return get_settings().data_dir / ".restore"


def _safe_restore_member(info: zipfile.ZipInfo) -> PurePosixPath:
    name = info.filename.replace("\\", "/")
    path = PurePosixPath(name)
    if (
        not name
        or path.is_absolute()
        or ".." in path.parts
        or any(not part for part in path.parts)
    ):
        raise ValueError("Backup contains an unsafe file path")
    file_type = (info.external_attr >> 16) & 0o170000
    if file_type and stat.S_ISLNK(file_type):
        raise ValueError("Backup cannot contain symbolic links")
    if path.parts[0] not in {"findstuff.sqlite3", "manifest.json", "photos"}:
        raise ValueError(f"Backup contains an unexpected file: {name}")
    if path.parts[0] in {"findstuff.sqlite3", "manifest.json"} and len(path.parts) != 1:
        raise ValueError(f"Backup contains an invalid path: {name}")
    return path


def _validate_restore_database(database_path: Path, stage: Path) -> dict[str, int]:
    uri = f"{database_path.resolve().as_uri()}?mode=ro&immutable=1"
    connection = sqlite3.connect(uri, uri=True)
    try:
        integrity = connection.execute("PRAGMA quick_check").fetchone()
        if integrity is None or integrity[0] != "ok":
            raise ValueError("Backup database failed SQLite integrity validation")
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')"
            )
        }
        missing = sorted(REQUIRED_RESTORE_TABLES - tables)
        if missing:
            raise ValueError(
                f"Backup database is missing required tables: {', '.join(missing)}"
            )
        for row in connection.execute("SELECT file_path, thumbnail_path FROM photos"):
            for value in row:
                if not value:
                    continue
                relative = PurePosixPath(str(value))
                if (
                    relative.is_absolute()
                    or ".." in relative.parts
                    or not relative.parts
                    or relative.parts[0] != "photos"
                    or not (stage / Path(*relative.parts)).is_file()
                ):
                    raise ValueError(f"Backup is missing photo file: {value}")
        return {
            "items": int(connection.execute("SELECT count(*) FROM items").fetchone()[0]),
            "locations": int(
                connection.execute("SELECT count(*) FROM locations").fetchone()[0]
            ),
            "categories": int(
                connection.execute("SELECT count(*) FROM categories").fetchone()[0]
            ),
            "photos": int(connection.execute("SELECT count(*) FROM photos").fetchone()[0]),
        }
    except sqlite3.DatabaseError as exc:
        raise ValueError("Backup does not contain a valid Findstuff database") from exc
    finally:
        connection.close()


def stage_backup_restore(archive_path: Path, original_name: str) -> dict[str, Any]:
    root = _restore_root()
    root.mkdir(parents=True, exist_ok=True)
    marker = root / RESTORE_MARKER
    if marker.exists():
        raise ValueError("A restore is already queued")

    stage_id = uuid.uuid4().hex
    stage = root / stage_id
    stage.mkdir(mode=0o700)
    try:
        with zipfile.ZipFile(archive_path) as archive:
            members = archive.infolist()
            if len(members) > MAX_RESTORE_FILES:
                raise ValueError("Backup contains too many files")
            total_size = sum(member.file_size for member in members)
            compressed_size = sum(max(member.compress_size, 1) for member in members)
            if total_size > MAX_RESTORE_UNCOMPRESSED_BYTES:
                raise ValueError("Backup is too large after extraction")
            if total_size > compressed_size * MAX_RESTORE_COMPRESSION_RATIO:
                raise ValueError("Backup compression ratio is unsafe")
            if any(member.flag_bits & 0x1 for member in members):
                raise ValueError("Encrypted backup archives are not supported")

            seen: set[str] = set()
            for member in members:
                relative = _safe_restore_member(member)
                relative_name = relative.as_posix().rstrip("/")
                if relative_name in seen:
                    raise ValueError(f"Backup contains duplicate file: {relative_name}")
                seen.add(relative_name)
                target = stage / Path(*relative.parts)
                if member.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as source, target.open("wb") as destination:
                    shutil.copyfileobj(source, destination, length=1024 * 1024)

        manifest_path = stage / "manifest.json"
        database_path = stage / "findstuff.sqlite3"
        if not manifest_path.is_file() or not database_path.is_file():
            raise ValueError("Backup must contain manifest.json and findstuff.sqlite3")
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError("Backup manifest is invalid") from exc
        if (
            not isinstance(manifest, dict)
            or manifest.get("app") != "findstuff"
            or manifest.get("format_version") != 1
        ):
            raise ValueError("This is not a supported Findstuff backup")
        (stage / "photos").mkdir(exist_ok=True)
        counts = _validate_restore_database(database_path, stage)
        queued_at = datetime.now(UTC).isoformat()
        request = {
            "stage_id": stage_id,
            "original_name": Path(original_name).name[:240],
            "queued_at": queued_at,
            "counts": counts,
        }
        temporary_marker = marker.with_suffix(".tmp")
        temporary_marker.write_text(
            json.dumps(request, separators=(",", ":")) + "\n", encoding="utf-8"
        )
        os.chmod(temporary_marker, 0o600)
        os.replace(temporary_marker, marker)
        _write_restore_status(
            "queued",
            "Backup validated and queued for restart-time restore",
            queued_at=queued_at,
            counts=counts,
        )
        return {"status": "restart_queued", "queued_at": queued_at, "counts": counts}
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def restore_status() -> dict[str, Any]:
    path = _restore_root() / RESTORE_STATUS
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"status": "none", "message": "No restore has run"}
    return value if isinstance(value, dict) else {"status": "unknown"}


def _write_restore_status(status: str, message: str, **details: Any) -> None:
    root = _restore_root()
    root.mkdir(parents=True, exist_ok=True)
    path = root / RESTORE_STATUS
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(
            {
                "status": status,
                "message": message,
                "updated_at": datetime.now(UTC).isoformat(),
                **details,
            },
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def apply_pending_restore() -> dict[str, Any] | None:
    settings = get_settings()
    root = _restore_root()
    marker = root / RESTORE_MARKER
    if not marker.is_file():
        return None
    try:
        request = json.loads(marker.read_text(encoding="utf-8"))
        stage_id = str(request["stage_id"])
        invalid_stage_id = len(stage_id) != 32 or any(
            character not in "0123456789abcdef" for character in stage_id
        )
        if invalid_stage_id:
            raise ValueError("Restore marker has an invalid staging identifier")
        stage = root / stage_id
        replacement_database = stage / "findstuff.sqlite3"
        replacement_photos = stage / "photos"
        counts = _validate_restore_database(replacement_database, stage)

        safety_backup = backup(settings.backup_dir / "pre-restore", keep=3)
        database_path = settings.database_path
        live_photos = settings.data_dir / "photos"
        old_database = root / f"{stage_id}.previous.sqlite3"
        old_photos = root / f"{stage_id}.previous-photos"
        database_path.parent.mkdir(parents=True, exist_ok=True)

        checkpoint = connect(database_path)
        try:
            checkpoint.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            checkpoint.close()
        Path(f"{database_path}-wal").unlink(missing_ok=True)
        Path(f"{database_path}-shm").unlink(missing_ok=True)

        database_moved = photos_moved = replacement_database_moved = False
        try:
            if database_path.exists():
                os.replace(database_path, old_database)
                database_moved = True
            os.replace(replacement_database, database_path)
            replacement_database_moved = True
            if live_photos.exists():
                os.replace(live_photos, old_photos)
                photos_moved = True
            os.replace(replacement_photos, live_photos)
            _validate_restore_database(database_path, settings.data_dir)
        except Exception:
            if live_photos.exists():
                shutil.rmtree(live_photos, ignore_errors=True)
            if photos_moved and old_photos.exists():
                os.replace(old_photos, live_photos)
            if replacement_database_moved and database_path.exists():
                database_path.unlink(missing_ok=True)
            if database_moved and old_database.exists():
                os.replace(old_database, database_path)
            raise

        old_database.unlink(missing_ok=True)
        shutil.rmtree(old_photos, ignore_errors=True)
        marker.unlink(missing_ok=True)
        shutil.rmtree(stage, ignore_errors=True)
        result = {
            "status": "complete",
            "message": "Full backup restored successfully",
            "counts": counts,
            "safety_backup": str(
                Path("backups") / "pre-restore" / safety_backup.name
            ),
        }
        _write_restore_status(**result)
        return result
    except Exception as exc:
        marker.rename(root / f"{RESTORE_MARKER}.failed-{_timestamp()}")
        _write_restore_status("failed", str(exc)[:1000])
        return {"status": "failed", "message": str(exc)}
