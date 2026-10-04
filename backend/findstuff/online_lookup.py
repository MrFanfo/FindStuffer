"""Review-first, keyless discovery of manuals and product facts."""
from __future__ import annotations

import json
import re
import sqlite3
from html import unescape
from html.parser import HTMLParser
from urllib.parse import parse_qs, urljoin, urlsplit

import httpx

from .documents import MAX_DOCUMENT_BYTES
from .inventory import get_item_row
from .network_security import validate_http_url, validate_public_http_target

SEARCH_URL = "https://html.duckduckgo.com/html/"
LITE_SEARCH_URL = "https://lite.duckduckgo.com/lite/"
MAX_PAGE_BYTES = 2 * 1024 * 1024
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; Findstuff/1.0)"}
PRODUCT_TYPES = {"product", "productmodel", "individualproduct"}
MANUAL_WORDS = ("manual", "guide", "instructions", "handbook", "user guide")


def _clean(value: str, limit: int = 240) -> str:
    return " ".join(unescape(re.sub(r"<[^>]*>", " ", value)).split())[:limit]


def _public_url(value: str, base: str = "") -> str | None:
    try:
        url = urljoin(base, unescape(value))
        validate_http_url(url)
        return url
    except ValueError:
        return None


def _search_target(href: str) -> str | None:
    url = _public_url(href, "https://duckduckgo.com/")
    if not url:
        return None
    parsed = urlsplit(url)
    if parsed.hostname in {"duckduckgo.com", "www.duckduckgo.com"}:
        target = parse_qs(parsed.query).get("uddg", [])
        if not target:
            return None
        url = target[0]
    return _public_url(url)


class _SearchParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.results: list[tuple[str, str]] = []
        self.href: str | None = None
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        values = dict(attrs)
        classes = (values.get("class") or "").split()
        if "result__a" in classes or "result-link" in classes:
            self.href = values.get("href")
            self.parts = []

    def handle_data(self, data: str) -> None:
        if self.href is not None:
            self.parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self.href is not None:
            title = _clean(" ".join(self.parts))
            url = _search_target(self.href)
            if title and url:
                self.results.append((title, url))
            self.href = None
            self.parts = []


class _PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.heading = ""
        self.meta: dict[str, str] = {}
        self.json_scripts: list[str] = []
        self.links: list[tuple[str, str]] = []
        self._capture = ""
        self._parts: list[str] = []
        self._href = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "meta":
            key = (values.get("property") or values.get("name") or "").lower()
            content = values.get("content")
            if key and content and key not in self.meta:
                self.meta[key] = _clean(content, 4000)
        elif tag == "script" and "ld+json" in (values.get("type") or "").lower():
            self._capture = "script"
            self._parts = []
        elif tag in {"title", "h1", "a"} and not self._capture:
            self._capture = tag
            self._parts = []
            if tag == "a":
                self._href = values.get("href") or ""

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != self._capture:
            return
        value = "".join(self._parts)
        if tag == "script":
            self.json_scripts.append(value)
        elif tag == "title" and not self.title:
            self.title = _clean(value)
        elif tag == "h1" and not self.heading:
            self.heading = _clean(value)
        elif tag == "a" and self._href:
            self.links.append((_clean(value), self._href))
        self._capture = ""
        self._parts = []
        self._href = ""


def _query(item: sqlite3.Row, kind: str) -> str:
    brand = (item["brand"] or "").strip()
    model = (item["model"] or "").strip()
    name = (item["name"] or "").strip()
    identity = " ".join(part for part in (brand, model or name) if part)
    if brand and brand.casefold() in (model or name).casefold():
        identity = model or name
    return f"{identity} {'user manual pdf' if kind == 'manual' else 'product specifications'}"


def _rank(title: str, url: str, item: sqlite3.Row, kind: str) -> int:
    haystack = f"{title} {url}".casefold()
    model = (item["model"] or "").strip().casefold()
    brand = (item["brand"] or "").strip().casefold()
    score = 0
    if model and model in haystack:
        score += 7
    if brand and any(token in urlsplit(url).hostname.casefold() for token in brand.split()
                     if len(token) > 3):
        score += 4
    if kind == "manual":
        if urlsplit(url).path.casefold().endswith(".pdf"):
            score += 5
        if any(word in title.casefold() for word in MANUAL_WORDS):
            score += 3
    elif "spec" in title.casefold() or "product" in title.casefold():
        score += 2
    return score


async def search_sources(
    connection: sqlite3.Connection, public_id: str, kind: str, query: str = ""
) -> dict[str, object]:
    if kind not in {"manual", "details"}:
        raise ValueError("Unknown online lookup kind")
    item = get_item_row(connection, public_id)
    query = " ".join((query or _query(item, kind)).split())[:180]
    if not query:
        raise ValueError("Add an item name or search terms first")
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(15), trust_env=False, follow_redirects=False, headers=HEADERS
    ) as client:
        results: list[tuple[str, str]] = []
        for endpoint in (SEARCH_URL, LITE_SEARCH_URL):
            try:
                response = await client.get(endpoint, params={"q": query, "kl": "us-en"})
                if response.status_code != 200 or len(response.content) > MAX_PAGE_BYTES:
                    continue
                parser = _SearchParser()
                parser.feed(response.text)
                results = parser.results
                if results:
                    break
            except (httpx.HTTPError, UnicodeError):
                continue
    if not results:
        raise ValueError("Online search is unavailable. Paste a manual or product URL instead.")
    seen: set[str] = set()
    candidates = []
    for position, (title, url) in enumerate(results):
        if url in seen:
            continue
        seen.add(url)
        candidates.append({
            "title": title,
            "url": url,
            "domain": urlsplit(url).hostname or "",
            "is_pdf": urlsplit(url).path.casefold().endswith(".pdf"),
            "rank": _rank(title, url, item, kind),
            "position": position,
        })
    candidates.sort(key=lambda entry: (-entry["rank"], entry["position"]))
    for candidate in candidates:
        candidate.pop("rank")
        candidate.pop("position")
    return {"query": query, "results": candidates[:12]}


async def _download_public(
    client: httpx.AsyncClient, url: str, max_bytes: int
) -> tuple[bytes, str, str]:
    for _ in range(6):
        url = await validate_public_http_target(url)
        async with client.stream("GET", url) as response:
            if response.is_redirect:
                target = response.headers.get("location")
                if not target:
                    raise ValueError("Source has an invalid redirect")
                url = urljoin(url, target)
                continue
            response.raise_for_status()
            declared = response.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > max_bytes:
                raise ValueError("Source exceeds the download limit")
            chunks: list[bytes] = []
            size = 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > max_bytes:
                    raise ValueError("Source exceeds the download limit")
                chunks.append(chunk)
            return b"".join(chunks), url, response.headers.get("content-type", "").lower()
    raise ValueError("Source redirected too many times")


async def fetch_manual_pdf(url: str) -> tuple[bytes, str]:
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(20), trust_env=False, follow_redirects=False, headers=HEADERS
    ) as client:
        data, final_url, _ = await _download_public(client, url, MAX_DOCUMENT_BYTES)
    if not data.startswith(b"%PDF-"):
        raise ValueError("The selected source is not a valid PDF manual")
    return data, final_url


def _product_nodes(value: object, depth: int = 0) -> list[dict[str, object]]:
    if depth > 7:
        return []
    if isinstance(value, list):
        return [node for part in value for node in _product_nodes(part, depth + 1)]
    if not isinstance(value, dict):
        return []
    types = value.get("@type") or []
    if isinstance(types, str):
        types = [types]
    found = [value] if any(str(part).casefold().split("/")[-1] in PRODUCT_TYPES
                           for part in types) else []
    for key in ("@graph", "mainEntity", "itemListElement", "hasVariant"):
        found.extend(_product_nodes(value.get(key), depth + 1))
    return found


def _text(value: object) -> str:
    if isinstance(value, str):
        return _clean(value, 4000)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, dict):
        return _text(value.get("name") or value.get("value"))
    if isinstance(value, list):
        return next((text for part in value if (text := _text(part))), "")
    return ""


def _millimetres(value: object) -> int | None:
    if isinstance(value, dict):
        unit = _text(value.get("unitCode") or value.get("unitText")).casefold()
        amount = value.get("value")
    else:
        unit = ""
        amount = value
    try:
        number = float(amount)
    except (TypeError, ValueError):
        return None
    factor = {"mmt": 1, "mm": 1, "cmt": 10, "cm": 10, "mtr": 1000, "m": 1000}.get(unit)
    if factor is None or not 0 < number * factor <= 100000:
        return None
    return round(number * factor)


def _grams(value: object) -> int | None:
    if isinstance(value, dict):
        unit = _text(value.get("unitCode") or value.get("unitText")).casefold()
        amount = value.get("value")
    else:
        unit = ""
        amount = value
    try:
        number = float(amount)
    except (TypeError, ValueError):
        return None
    factor = {"grm": 1, "g": 1, "kgm": 1000, "kg": 1000}.get(unit)
    if factor is None or not 0 < number * factor <= 100000000:
        return None
    return round(number * factor)


def _product_fields(
    page: _PageParser, item: sqlite3.Row
) -> tuple[dict[str, str | int], bool, bool]:
    nodes: list[dict[str, object]] = []
    for script in page.json_scripts[:20]:
        try:
            nodes.extend(_product_nodes(json.loads(unescape(script))))
        except (json.JSONDecodeError, ValueError):
            continue
    model = (item["model"] or "").casefold()
    nodes.sort(
        key=lambda node: model in (
            f"{_text(node.get('name'))} {_text(node.get('model'))}".casefold()
        ) if model else False,
        reverse=True,
    )
    product = nodes[0] if nodes else {}
    mpn = _text(product.get("mpn"))
    if re.fullmatch(r"\d{8}|\d{12,14}", mpn):
        mpn = ""
    fields: dict[str, str | int] = {}
    for target, source in (
        ("name", product.get("name") or page.meta.get("og:title") or page.heading),
        ("brand", product.get("brand") or page.meta.get("product:brand")),
        ("model", product.get("model") or mpn),
        ("description", product.get("description") or page.meta.get("description")),
    ):
        text = _text(source)
        if text:
            fields[target] = text[:4000 if target == "description" else 240]
    for key in ("gtin", "gtin8", "gtin12", "gtin13", "gtin14"):
        code = re.sub(r"\D", "", _text(product.get(key)))
        if len(code) in {8, 12, 13, 14}:
            fields["barcode"] = code
            break
    for target, source in (
        ("weight_g", product.get("weight")),
        ("length_mm", product.get("depth")),
        ("width_mm", product.get("width")),
        ("height_mm", product.get("height")),
    ):
        amount = _grams(source) if target == "weight_g" else _millimetres(source)
        if amount is not None:
            fields[target] = amount
    match_text = f"{page.title} {fields.get('name', '')} {fields.get('model', '')}".casefold()
    exact_model = not model or model in match_text
    return fields, exact_model, bool(nodes)


async def preview_source(
    connection: sqlite3.Connection, public_id: str, kind: str, url: str
) -> dict[str, object]:
    if kind not in {"manual", "details"}:
        raise ValueError("Unknown online lookup kind")
    item = get_item_row(connection, public_id)
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(20), trust_env=False, follow_redirects=False, headers=HEADERS
    ) as client:
        try:
            data, final_url, content_type = await _download_public(
                client, url, MAX_DOCUMENT_BYTES if kind == "manual" else MAX_PAGE_BYTES
            )
        except httpx.HTTPError as exc:
            raise ValueError(
                "Could not fetch this source. Try another result or paste a URL."
            ) from exc
    if data.startswith(b"%PDF-"):
        if kind != "manual":
            raise ValueError("This is a PDF. Choose an HTML product page for item details.")
        title = _clean(urlsplit(final_url).path.rsplit("/", 1)[-1].removesuffix(".pdf")) or "Manual"
        return {
            "format": "pdf", "source_url": final_url, "title": title,
            "size_bytes": len(data), "pdf_links": [],
        }
    if "html" not in content_type and not data.lstrip().startswith((b"<!DOCTYPE html", b"<html")):
        raise ValueError("This source is not a readable product page or PDF")
    page = _PageParser()
    page.feed(data.decode("utf-8", errors="replace"))
    if kind == "details":
        fields, exact_model, structured = _product_fields(page, item)
        if not fields:
            raise ValueError("No product details found on this page. Try another result.")
        return {
            "format": "product", "source_url": final_url,
            "title": page.title or page.heading or "Product page",
            "fields": fields, "exact_model": exact_model,
            "structured": structured,
        }
    links: list[dict[str, str]] = []
    seen: set[str] = set()
    for text, href in page.links:
        target = _public_url(href, final_url)
        if not target or target in seen or target == final_url:
            continue
        path = urlsplit(target).path.casefold()
        if not path.endswith(".pdf") and not any(word in f"{text} {path}".casefold()
                                                  for word in MANUAL_WORDS):
            continue
        seen.add(target)
        links.append({"title": text or "Download PDF", "url": target})
        if len(links) == 8:
            break
    return {
        "format": "page", "source_url": final_url,
        "title": page.title or page.heading or "Manual page", "pdf_links": links,
    }
