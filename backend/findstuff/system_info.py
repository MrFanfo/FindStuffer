from __future__ import annotations

import os
import platform
import resource
import shutil
import sqlite3
import sys
import time
from contextlib import suppress
from pathlib import Path
from typing import Any

from . import __version__
from .config import Settings

_STARTED_AT = time.time()
_STARTED_MONOTONIC = time.monotonic()
_LAST_CPU_SAMPLE: tuple[float, float] | None = None


def application_system_info(
    database: sqlite3.Connection, settings: Settings
) -> dict[str, Any]:
    database_sizes = _database_sizes(settings.database_path)
    photos_dir = settings.data_dir / "photos"
    photos_size = _directory_size(photos_dir)
    documents_size = _directory_size(settings.data_dir / "documents")
    data_dir_size = _directory_size(settings.data_dir)
    total_managed_size = database_sizes["total_bytes"] + photos_size + documents_size
    disk = _disk_usage(settings.data_dir)

    return {
        "app": {
            "version": __version__,
            "python_version": platform.python_version(),
            "platform": platform.platform(),
            "process_id": os.getpid(),
            "started_at": time.strftime(
                "%Y-%m-%dT%H:%M:%SZ", time.gmtime(_STARTED_AT)
            ),
            "uptime_seconds": round(time.monotonic() - _STARTED_MONOTONIC),
        },
        "resources": {
            "cpu_percent": _process_cpu_percent(),
            "cpu_count": os.cpu_count() or 1,
            "memory_rss_bytes": _process_rss_bytes(),
        },
        "storage": {
            "data_dir": str(settings.data_dir),
            "database_path": str(settings.database_path),
            "database_bytes": database_sizes["total_bytes"],
            "database_main_bytes": database_sizes["main_bytes"],
            "database_wal_bytes": database_sizes["wal_bytes"],
            "database_shm_bytes": database_sizes["shm_bytes"],
            "photos_bytes": photos_size,
            "documents_bytes": documents_size,
            "total_managed_bytes": total_managed_size,
            "data_dir_bytes": data_dir_size,
            "other_data_bytes": max(0, data_dir_size - total_managed_size),
            "disk_total_bytes": disk.total,
            "disk_free_bytes": disk.free,
        },
        "inventory": _inventory_counts(database),
        "database": _sqlite_info(database),
    }


def _process_cpu_percent() -> float:
    global _LAST_CPU_SAMPLE
    now = time.monotonic()
    cpu_now = time.process_time()
    if _LAST_CPU_SAMPLE is None:
        _LAST_CPU_SAMPLE = (now, cpu_now)
        return 0.0
    previous_time, previous_cpu = _LAST_CPU_SAMPLE
    _LAST_CPU_SAMPLE = (now, cpu_now)
    elapsed = max(now - previous_time, 0.001)
    used = max(cpu_now - previous_cpu, 0.0)
    return round((used / elapsed) * 100, 1)


def _process_rss_bytes() -> int:
    status = Path("/proc/self/status")
    with suppress(OSError):
        for line in status.read_text(encoding="utf-8").splitlines():
            if line.startswith("VmRSS:"):
                parts = line.split()
                if len(parts) >= 2:
                    return int(parts[1]) * 1024

    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform == "darwin":
        return int(usage)
    return int(usage) * 1024


def _database_sizes(database_path: Path) -> dict[str, int]:
    main = _file_size(database_path)
    wal = _file_size(Path(f"{database_path}-wal"))
    shm = _file_size(Path(f"{database_path}-shm"))
    return {
        "main_bytes": main,
        "wal_bytes": wal,
        "shm_bytes": shm,
        "total_bytes": main + wal + shm,
    }


def _file_size(path: Path) -> int:
    with suppress(OSError):
        if path.is_file():
            return path.stat().st_size
    return 0


def _directory_size(path: Path) -> int:
    total = 0
    with suppress(OSError):
        for entry in path.rglob("*"):
            with suppress(OSError):
                if entry.is_file():
                    total += entry.stat().st_size
    return total


def _disk_usage(path: Path):
    current = path if path.exists() else path.parent
    while not current.exists() and current != current.parent:
        current = current.parent
    return shutil.disk_usage(current)


def _inventory_counts(database: sqlite3.Connection) -> dict[str, int]:
    tables = {
        "items": "items",
        "locations": "locations",
        "categories": "categories",
        "photos": "photos",
        "documents": "item_documents",
        "schema_migrations": "schema_migrations",
    }
    counts: dict[str, int] = {}
    for label, table in tables.items():
        try:
            counts[label] = int(
                database.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            )
        except sqlite3.DatabaseError:
            counts[label] = 0
    return counts


def _sqlite_info(database: sqlite3.Connection) -> dict[str, int | str]:
    def pragma_int(name: str) -> int:
        return int(database.execute(f"PRAGMA {name}").fetchone()[0])

    def pragma_str(name: str) -> str:
        return str(database.execute(f"PRAGMA {name}").fetchone()[0])

    return {
        "page_count": pragma_int("page_count"),
        "page_size": pragma_int("page_size"),
        "freelist_count": pragma_int("freelist_count"),
        "journal_mode": pragma_str("journal_mode"),
    }
