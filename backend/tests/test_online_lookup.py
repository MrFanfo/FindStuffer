from __future__ import annotations

import asyncio
from pathlib import Path

import httpx
import pytest

from findstuff import online_lookup
from findstuff.db import connect, migrate
from findstuff.documents import store_document
from findstuff.inventory import create_item

ORIGINAL_ASYNC_CLIENT = httpx.AsyncClient

ITEM = {"name": "PO-33 K.O!", "brand": "Teenage Engineering", "model": "PO-33"}


def mock_client(monkeypatch, handler):
    monkeypatch.setattr(
        online_lookup.httpx,
        "AsyncClient",
        lambda **kwargs: ORIGINAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler), **kwargs),
    )

    async def public(url):
        if url.startswith("http://127.") or url.startswith("http://localhost"):
            raise ValueError("Private or local download targets are not allowed")
        return url

    monkeypatch.setattr(online_lookup, "validate_public_http_target", public)
    monkeypatch.setattr(online_lookup, "get_item_row", lambda _db, _id: ITEM)


def test_search_extracts_and_ranks_pdf_without_saving(monkeypatch):
    html = (
        '<a class="result__a" href="https://example.org/other">Other</a>'
        '<a class="result__a" href="https://teenage.engineering/po-33.pdf">'
        "PO-33 user manual</a>"
    )
    mock_client(monkeypatch, lambda _request: httpx.Response(200, text=html))
    found = asyncio.run(online_lookup.search_sources(None, "item", "manual"))
    assert found["query"] == "Teenage Engineering PO-33 user manual pdf"
    assert found["results"][0]["url"] == "https://teenage.engineering/po-33.pdf"
    assert found["results"][0]["is_pdf"] is True


def test_manual_page_finds_pdf_and_rejects_private_redirect(monkeypatch):
    html = '<html><title>PO-33 guide</title><a href="/manual.pdf">Download manual</a></html>'

    def handler(request):
        if request.url.path == "/redirect":
            return httpx.Response(302, headers={"location": "http://127.0.0.1/secret"})
        return httpx.Response(200, text=html, headers={"content-type": "text/html"})

    mock_client(monkeypatch, handler)
    page = asyncio.run(
        online_lookup.preview_source(None, "item", "manual", "https://example.org/guide")
    )
    assert page["format"] == "page"
    assert page["pdf_links"] == [
        {"title": "Download manual", "url": "https://example.org/manual.pdf"}
    ]
    with pytest.raises(ValueError, match="Private or local"):
        asyncio.run(
            online_lookup.preview_source(None, "item", "manual", "https://example.org/redirect")
        )


def test_product_json_ld_extracts_reviewable_fields(monkeypatch):
    html = """<html><title>PO-33 product</title><script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Product","name":"PO-33 K.O!",
    "brand":{"@type":"Brand","name":"Teenage Engineering"},"model":"PO-33",
    "description":"Pocket operator sampler","gtin13":"1234567890123",
    "weight":{"value":0.12,"unitCode":"KGM"},
    "width":{"value":8.5,"unitCode":"CMT"}}
    </script></html>"""
    mock_client(
        monkeypatch,
        lambda _request: httpx.Response(200, text=html, headers={"content-type": "text/html"}),
    )
    found = asyncio.run(
        online_lookup.preview_source(None, "item", "details", "https://example.org/po-33")
    )
    assert found["structured"] is True
    assert found["exact_model"] is True
    assert found["fields"] == {
        "name": "PO-33 K.O!",
        "brand": "Teenage Engineering",
        "model": "PO-33",
        "description": "Pocket operator sampler",
        "barcode": "1234567890123",
        "weight_g": 120,
        "width_mm": 85,
    }


def test_pdf_validation_and_source_url_storage(tmp_path: Path, monkeypatch):
    pdf = b"%PDF-1.4\nmanual"
    mock_client(
        monkeypatch,
        lambda _request: httpx.Response(
            200, content=pdf, headers={"content-type": "application/pdf"}
        ),
    )
    data, url = asyncio.run(online_lookup.fetch_manual_pdf("https://example.org/manual.pdf"))
    assert data == pdf
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    db_path = tmp_path / "items.sqlite3"
    migrate(db_path)
    db = connect(db_path)
    try:
        item = create_item(db, {"name": "PO-33 K.O!", "quantity": 1})
        doc = store_document(
            db,
            item["public_id"],
            data,
            "application/pdf",
            "manual.pdf",
            "PO-33 manual",
            "manual",
            None,
            None,
            source_url=url,
        )
        assert doc["source_url"] == url
        assert (
            store_document(
                db,
                item["public_id"],
                data,
                "application/pdf",
                "manual.pdf",
                "PO-33 manual",
                "manual",
                None,
                None,
            )["public_id"]
            == doc["public_id"]
        )
    finally:
        db.close()
    mock_client(monkeypatch, lambda _request: httpx.Response(200, content=b"not a PDF"))
    with pytest.raises(ValueError, match="valid PDF"):
        asyncio.run(online_lookup.fetch_manual_pdf("https://example.org/manual.pdf"))


def test_manual_url_api_attaches_document(tmp_path: Path, monkeypatch):
    import findstuff.app as app_module

    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FINDSTUFF_DATABASE_PATH", str(tmp_path / "api.sqlite3"))
    monkeypatch.setenv("FINDSTUFF_AUTO_BACKUP_ENABLED", "false")
    migrate(tmp_path / "api.sqlite3")
    db = connect(tmp_path / "api.sqlite3")
    try:
        item = create_item(db, {"name": "PO-33", "quantity": 1})
    finally:
        db.close()

    async def fetch(_url):
        return b"%PDF-1.4\nmanual", "https://example.org/manual.pdf"

    monkeypatch.setattr(app_module, "fetch_manual_pdf", fetch)
    monkeypatch.setattr(app_module, "extract_document_text", lambda *_args: None)

    async def scenario():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app_module.app), base_url="http://testserver"
        ) as client:
            response = await client.post(
                f"/api/v1/items/{item['public_id']}/manuals/from-url",
                json={"url": "https://example.org/manual.pdf", "title": "PO-33 manual"},
            )
            assert response.status_code == 201, response.text
            assert response.json()["source_url"] == "https://example.org/manual.pdf"
            documents = await client.get(f"/api/v1/items/{item['public_id']}/documents")
            assert documents.status_code == 200
            assert documents.json()[0]["title"] == "PO-33 manual"

    asyncio.run(scenario())
