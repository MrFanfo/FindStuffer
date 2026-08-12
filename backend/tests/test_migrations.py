from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from findstuff import db


def test_hierarchy_migration_preserves_references_and_scopes_name_uniqueness(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    (migrations / "0001_legacy.sql").write_text(
        """
        CREATE TABLE locations (id INTEGER PRIMARY KEY);
        INSERT INTO locations(id) VALUES (1);
        CREATE TABLE categories (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL COLLATE NOCASE UNIQUE,
            slug TEXT NOT NULL UNIQUE,
            default_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
            default_low_stock_milli INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
            sort_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE items (
            id INTEGER PRIMARY KEY,
            category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
        );
        CREATE TABLE off_category_mappings (
            id INTEGER PRIMARY KEY,
            category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE
        );
        INSERT INTO categories(id, name, slug, default_location_id) VALUES
            (1, 'Electrical', 'electrical', 1),
            (2, 'Consumables', 'electrical-consumables', 1);
        UPDATE categories SET parent_id = 1 WHERE id = 2;
        INSERT INTO items(id, category_id) VALUES (1, 2);
        INSERT INTO off_category_mappings(id, category_id) VALUES (1, 2);
        """,
        encoding="utf-8",
    )
    hierarchy_script = (
        Path(db.__file__).resolve().parent
        / "migrations"
        / "0016_hierarchy_sibling_names.sql"
    ).read_text(encoding="utf-8")
    (migrations / "0016_hierarchy_sibling_names.sql").write_text(
        hierarchy_script, encoding="utf-8"
    )
    monkeypatch.setattr(db, "MIGRATIONS_DIR", migrations)
    database_path = tmp_path / "legacy.sqlite3"

    db.migrate(database_path)

    connection = db.connect(database_path)
    try:
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("SELECT category_id FROM items WHERE id = 1").fetchone()[0] == 2
        assert connection.execute(
            "SELECT category_id FROM off_category_mappings WHERE id = 1"
        ).fetchone()[0] == 2
        connection.execute(
            "INSERT INTO categories(id, name, slug, parent_id) "
            "VALUES (3, 'Plumbing', 'plumbing', NULL)"
        )
        connection.execute(
            "INSERT INTO categories(id, name, slug, parent_id) "
            "VALUES (4, 'Consumables', 'plumbing-consumables', 3)"
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO categories(id, name, slug, parent_id) "
                "VALUES (5, 'CONSUMABLES', 'duplicate', 3)"
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO categories(id, name, slug, parent_id) "
                "VALUES (6, 'electrical', 'duplicate-root', NULL)"
            )
    finally:
        connection.close()
