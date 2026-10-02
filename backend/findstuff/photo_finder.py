from __future__ import annotations

import base64
import re
import sqlite3
import warnings
from io import BytesIO
from urllib.parse import urljoin

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError

from .inventory import get_item_row
from .network_security import validate_public_http_target

SEARCH_URL = "https://duckduckgo.com/"
IMAGE_RESULTS_URL = "https://duckduckgo.com/i.js"
MAX_SOURCE_BYTES = 8 * 1024 * 1024
MAX_PREVIEW_BYTES = 250 * 1024
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; Findstuff/1.0)", "Referer": SEARCH_URL}


def photo_search_query(name: str, brand: str) -> str:
    name = " ".join(name.split())
    brand = " ".join(brand.split())
    if not brand or brand.casefold() in name.casefold():
        return name
    return f"{brand} {name}"


def compact_photo(data: bytes) -> tuple[bytes, int, int]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            return _compact_opened_photo(data)
    except (
        Image.DecompressionBombError, Image.DecompressionBombWarning,
        UnidentifiedImageError, OSError,
    ) as exc:
        raise ValueError("Image result is not a readable photo") from exc


def _compact_opened_photo(data: bytes) -> tuple[bytes, int, int]:
    with Image.open(BytesIO(data)) as source:
        source = ImageOps.exif_transpose(source)
        source.thumbnail((900, 900), Image.Resampling.LANCZOS)
        background = Image.new("RGB", source.size, "white")
        if source.mode in {"RGBA", "LA"} or "transparency" in source.info:
            rgba = source.convert("RGBA")
            background.paste(rgba, mask=rgba.getchannel("A"))
        else:
            background.paste(source.convert("RGB"))
        width, height = background.size
        for quality in (78, 65, 50, 35):
            output = BytesIO()
            background.save(output, format="WEBP", quality=quality, method=4)
            if output.tell() <= MAX_PREVIEW_BYTES:
                return output.getvalue(), width, height
    raise ValueError("Image result could not be made small enough")


async def _download_photo(client: httpx.AsyncClient, url: str) -> bytes:
    for _ in range(5):
        url = await validate_public_http_target(url)
        async with client.stream("GET", url) as response:
            if response.is_redirect:
                destination = response.headers.get("location")
                if not destination:
                    raise ValueError("Image result has an invalid redirect")
                url = urljoin(url, destination)
                continue
            response.raise_for_status()
            kind = response.headers.get("content-type", "").split(";", 1)[0].lower()
            if kind not in {"image/jpeg", "image/png", "image/webp"}:
                raise ValueError("Image result is not a supported photo")
            declared_size = response.headers.get("content-length")
            if declared_size and int(declared_size) > MAX_SOURCE_BYTES:
                raise ValueError("Image result is too large")
            chunks: list[bytes] = []
            size = 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > MAX_SOURCE_BYTES:
                    raise ValueError("Image result is too large")
                chunks.append(chunk)
            return b"".join(chunks)
    raise ValueError("Image result redirected too many times")


async def find_item_photo(
    connection: sqlite3.Connection, public_id: str, result_index: int = 0
) -> dict[str, object]:
    item = get_item_row(connection, public_id)
    query = photo_search_query(item["name"], item["brand"])
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(15), follow_redirects=False, trust_env=False, headers=HEADERS
        ) as client:
            search = await client.get(
                SEARCH_URL, params={"q": query, "iax": "images", "ia": "images"}
            )
            search.raise_for_status()
            match = re.search(r'\bvqd=["\']([\w-]+)["\']', search.text)
            if not match:
                raise ValueError("Image search is temporarily unavailable")
            response = await client.get(
                IMAGE_RESULTS_URL,
                params={
                    "q": query, "vqd": match.group(1), "o": "json",
                    "l": "us-en", "f": ",,,", "p": "1",
                },
            )
            response.raise_for_status()
            results = response.json().get("results") or []
            if result_index >= len(results):
                raise LookupError("No more image results for this item")
            result = results[result_index]
            image_url = result.get("image") or ""
            if not image_url:
                raise LookupError("This image result has no photo URL")
            original = await _download_photo(client, image_url)
    except httpx.HTTPError as exc:
        raise ValueError("Could not fetch the image result") from exc
    compact, width, height = compact_photo(original)
    return {
        "query": query,
        "title": result.get("title") or "Image result",
        "source_page": result.get("url") or image_url,
        "image_url": image_url,
        "data_url": "data:image/webp;base64," + base64.b64encode(compact).decode("ascii"),
        "width": width,
        "height": height,
        "size_bytes": len(compact),
        "result_index": result_index,
    }
