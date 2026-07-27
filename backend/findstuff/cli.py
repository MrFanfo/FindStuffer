from __future__ import annotations

import argparse
import asyncio
import json
import sqlite3
from pathlib import Path

from .backups import backup
from .config import get_settings
from .db import connect, migrate, transaction
from .enrichment import queue_missing_enrichment, run_pending
from .inventory import rebuild_search_index
from .notifications import deliver_pending_notifications


def doctor() -> dict[str, object]:
    settings = get_settings()
    migrate(settings.database_path)
    connection = connect(settings.database_path)
    try:
        connection.execute("SELECT count(*) FROM item_fts").fetchone()
        return {
            "status": "ok",
            "database": str(settings.database_path),
            "sqlite_version": sqlite3.sqlite_version,
            "fts5": True,
            "items": connection.execute(
                "SELECT count(*) FROM items WHERE archived_at IS NULL"
            ).fetchone()[0],
            "locations": connection.execute(
                "SELECT count(*) FROM locations WHERE archived_at IS NULL"
            ).fetchone()[0],
        }
    finally:
        connection.close()


def reindex() -> int:
    migrate()
    connection = connect()
    try:
        with transaction(connection):
            rebuild_search_index(connection)
        return connection.execute("SELECT count(*) FROM item_fts").fetchone()[0]
    finally:
        connection.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="findstuff")
    commands = parser.add_subparsers(dest="command", required=True)
    backup_command = commands.add_parser("backup", help="Create an online database backup")
    backup_command.add_argument("--output", type=Path)
    backup_command.add_argument("--keep", type=int, default=14)
    commands.add_parser("doctor", help="Check the database and required SQLite features")
    commands.add_parser("reindex", help="Rebuild the item full-text search index")
    jobs_command = commands.add_parser("jobs", help="Process queued enrichment jobs")
    jobs_command.add_argument("--limit", type=int, default=5)
    jobs_command.add_argument(
        "--no-queue-missing",
        action="store_true",
        help="Only process already queued jobs; do not discover barcode items first",
    )
    mcp_command = commands.add_parser("mcp", help="Run the FindStuff MCP stdio server")
    mcp_command.add_argument("--database", type=Path, help="Override FINDSTUFF_DATABASE_PATH")
    return parser


def main() -> None:
    arguments = build_parser().parse_args()
    settings = get_settings()
    if arguments.command == "backup":
        output = arguments.output or settings.data_dir / "backups"
        print(backup(output.resolve(), arguments.keep))
    elif arguments.command == "doctor":
        print(json.dumps(doctor(), indent=2))
    elif arguments.command == "reindex":
        print(f"Indexed {reindex()} item(s)")
    elif arguments.command == "jobs":
        migrate()
        connection = connect()
        try:
            queued = 0 if arguments.no_queue_missing else queue_missing_enrichment(
                connection, limit=max(1, arguments.limit)
            )
            processed = asyncio.run(run_pending(connection, max(1, arguments.limit)))
            notifications = asyncio.run(deliver_pending_notifications(connection))
        finally:
            connection.close()
        print(
            f"Queued {queued} job(s); processed {processed} job(s); "
            f"notifications: {notifications}"
        )
    elif arguments.command == "mcp":
        from .mcp_server import serve_stdio

        serve_stdio(arguments.database)


if __name__ == "__main__":
    main()
