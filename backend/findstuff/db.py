from __future__ import annotations

import sqlite3
from collections.abc import AsyncGenerator, Iterator
from contextlib import contextmanager
from pathlib import Path

from .config import get_settings

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def connect(database_path: Path | None = None) -> sqlite3.Connection:
    path = database_path or get_settings().database_path
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=5, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def migrate(database_path: Path | None = None) -> None:
    connection = connect(database_path)
    try:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                name TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        applied = {row["name"] for row in connection.execute("SELECT name FROM schema_migrations")}
        for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if migration.name in applied:
                continue
            safe_name = migration.name.replace("'", "''")
            script = migration.read_text(encoding="utf-8")
            disable_foreign_keys = script.lstrip().startswith(
                "-- findstuff: foreign_keys=off"
            )
            if disable_foreign_keys:
                connection.execute("PRAGMA foreign_keys = OFF")
            try:
                connection.executescript(
                    "BEGIN IMMEDIATE;\n"
                    f"{script}\n"
                    f"INSERT INTO schema_migrations(name) VALUES ('{safe_name}');\n"
                    "COMMIT;"
                )
            except Exception:
                if connection.in_transaction:
                    connection.rollback()
                raise
            finally:
                if disable_foreign_keys:
                    connection.execute("PRAGMA foreign_keys = ON")
    finally:
        connection.close()


@contextmanager
def transaction(connection: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    connection.execute("BEGIN IMMEDIATE")
    try:
        yield connection
    except Exception:
        connection.rollback()
        raise
    else:
        connection.commit()


async def database_dependency() -> AsyncGenerator[sqlite3.Connection, None]:
    connection = connect()
    try:
        yield connection
    finally:
        connection.close()
