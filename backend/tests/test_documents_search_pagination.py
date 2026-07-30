from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from findstuff.db import connect, migrate
from findstuff.documents import (
    apply_document_extraction,
    delete_document,
    get_document,
    get_document_path,
    list_documents,
    store_document,
    warranties_due,
)
from findstuff.human_search import human_search, save_alias
from findstuff.inventory import (
    NotFoundError,
    create_item,
    create_location,
    get_item,
    list_items_page,
)


@pytest.fixture
def database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> sqlite3.Connection:
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    path = tmp_path / "findstuff.sqlite3"
    monkeypatch.setenv("FINDSTUFF_DATABASE_PATH", str(path))
    migrate(path)
    connection = connect(path)
    yield connection
    connection.close()


def test_document_lifecycle_extraction_and_warranty(
    database: sqlite3.Connection,
) -> None:
    item = create_item(database, {"name": "Oscilloscope", "quantity": 1})
    document = store_document(
        database,
        item["public_id"],
        b"%PDF-1.4\nsmall test document",
        "application/pdf",
        "scope-receipt.pdf",
        "Purchase receipt",
        "receipt",
        "2026-01-02",
        "2026-08-15",
    )

    assert document["document_type"] == "receipt"
    assert "file_path" not in document
    stored_path = get_document_path(database, document["public_id"])
    assert stored_path.is_file()
    assert list_documents(database, item["public_id"])[0]["public_id"] == document["public_id"]
    assert warranties_due(database, 365)[0]["item_name"] == "Oscilloscope"

    database.execute(
        """
        UPDATE item_documents SET extraction_status = 'complete',
            extracted_serial_number = 'SCOPE-1234',
            extracted_purchase_date = '2026-01-02',
            extracted_warranty_expires_at = '2026-08-15'
        WHERE public_id = ?
        """,
        (document["public_id"],),
    )
    applied = apply_document_extraction(database, document["public_id"])
    assert applied["warranty_expires_at"] == "2026-08-15"
    assert get_item(database, item["public_id"])["serial_number"] == "SCOPE-1234"

    delete_document(database, document["public_id"])
    assert not stored_path.exists()
    with pytest.raises(NotFoundError, match="Document not found"):
        get_document(database, document["public_id"])


def test_human_search_synonyms_typos_and_place_alias(
    database: sqlite3.Connection,
) -> None:
    workshop = create_location(database, {"name": "Workshop", "kind": "room"})
    drawer = create_location(
        database,
        {
            "name": "Drawer A",
            "kind": "drawer",
            "parent_public_id": workshop["public_id"],
        },
    )
    driver = create_item(
        database,
        {
            "name": "Phillips driver",
            "location_public_id": drawer["public_id"],
            "quantity": 1,
        },
    )

    synonym = human_search(database, "screwdrivers")
    assert synonym["items"][0]["public_id"] == driver["public_id"]
    typo = human_search(database, "philips drivr")
    assert typo["fuzzy"] is True
    assert typo["items"][0]["public_id"] == driver["public_id"]

    save_alias(
        database,
        {
            "alias": "top drawer",
            "target_type": "location",
            "target_public_id": drawer["public_id"],
        },
    )
    alias = human_search(database, "top drawer")
    assert alias["matched_by"] == ["place alias"]
    assert alias["items"][0]["public_id"] == driver["public_id"]


def test_cursor_pagination_is_stable_and_complete(database: sqlite3.Connection) -> None:
    created = {
        create_item(database, {"name": f"Item {index}", "quantity": 1})["public_id"]
        for index in range(7)
    }
    seen: set[str] = set()
    cursor: str | None = None
    while True:
        page = list_items_page(database, limit=2, cursor=cursor)
        page_ids = {item["public_id"] for item in page["items"]}
        assert not (seen & page_ids)
        seen |= page_ids
        cursor = page["next_cursor"]
        if not page["has_more"]:
            break
        assert cursor
    assert seen == created


def test_invalid_cursor_is_rejected(database: sqlite3.Connection) -> None:
    with pytest.raises(ValueError, match="Invalid inventory cursor"):
        list_items_page(database, cursor="not-a-real-cursor")
