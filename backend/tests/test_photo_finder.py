from __future__ import annotations

import asyncio
from io import BytesIO

import httpx
from PIL import Image

from findstuff import photo_finder


def test_photo_search_query_uses_brand_once() -> None:
    assert photo_finder.photo_search_query("PO-33 K.O!", "Teenage Engineering") == (
        "Teenage Engineering PO-33 K.O!"
    )
    assert photo_finder.photo_search_query(
        "Teenage Engineering PO-33 K.O!", "Teenage Engineering"
    ) == (
        "Teenage Engineering PO-33 K.O!"
    )
    assert photo_finder.photo_search_query("Plain unbranded item", "") == "Plain unbranded item"


def test_finder_returns_compressed_first_image_without_saving(monkeypatch) -> None:
    image = Image.new("RGB", (1600, 1200), "blue")
    source = BytesIO()
    image.save(source, format="PNG")
    original_client = httpx.AsyncClient
    requests: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(str(request.url))
        if request.url.path == "/":
            return httpx.Response(200, text='<script>vqd="4-testtoken"</script>')
        if request.url.path == "/i.js":
            return httpx.Response(200, json={"results": [{
                "title": "Exact product", "image": "https://example.com/photo.png",
                "url": "https://example.com/product",
            }]})
        return httpx.Response(200, content=source.getvalue(), headers={"content-type": "image/png"})

    monkeypatch.setattr(photo_finder, "get_item_row", lambda _db, _id: {
        "name": "PO-33 K.O!", "brand": "Teenage Engineering",
    })
    monkeypatch.setattr(
        photo_finder, "validate_public_http_target", lambda url: asyncio.sleep(0, result=url)
    )
    monkeypatch.setattr(
        photo_finder.httpx, "AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(handle), **kwargs),
    )
    result = asyncio.run(photo_finder.find_item_photo(None, "itm_example"))  # type: ignore[arg-type]
    assert result["query"] == "Teenage Engineering PO-33 K.O!"
    assert result["source_page"] == "https://example.com/product"
    assert result["width"] == 900
    assert result["height"] == 675
    assert result["size_bytes"] <= photo_finder.MAX_PREVIEW_BYTES
    assert str(result["data_url"]).startswith("data:image/webp;base64,")
    assert len(requests) == 3
