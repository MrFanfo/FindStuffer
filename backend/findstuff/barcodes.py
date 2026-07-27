from __future__ import annotations

import json
import re
import shutil
import sqlite3
import subprocess
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

from .db import transaction
from .inventory import get_item, suggest_default_location
from .off_categories import observe_categories, resolve_category

BARCODE_PROVIDERS = [
    {
        "id": "open_food_facts",
        "label": "Open Food Facts",
        "api": "https://world.openfoodfacts.org/api/v3/product/{code}",
        "page": "https://world.openfoodfacts.org/product/{code}",
    },
    {
        "id": "open_beauty_facts",
        "label": "Open Beauty Facts",
        "api": "https://world.openbeautyfacts.org/api/v3/product/{code}",
        "page": "https://world.openbeautyfacts.org/product/{code}",
    },
    {
        "id": "open_products_facts",
        "label": "Open Products Facts",
        "api": "https://world.openproductsfacts.org/api/v3/product/{code}",
        "page": "https://world.openproductsfacts.org/product/{code}",
    },
]

IMAGE_DECODE_LIMIT_BYTES = 8 * 1024 * 1024
SUPPORTED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
NUTRITION_KEYS = (
    "energy-kcal_100g",
    "energy_100g",
    "fat_100g",
    "saturated-fat_100g",
    "carbohydrates_100g",
    "sugars_100g",
    "fiber_100g",
    "proteins_100g",
    "salt_100g",
    "sodium_100g",
)


def _first_text(product: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = product.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, int | float):
            return str(value)
    return ""


def _ingredients_text(product: dict[str, Any]) -> str:
    direct = _first_text(
        product,
        "ingredients_text",
        "ingredients_text_it",
        "ingredients_text_en",
        "ingredients_text_with_allergens",
        "ingredients_text_with_allergens_it",
        "ingredients_text_with_allergens_en",
    )
    if direct:
        return direct
    for key, value in product.items():
        if key.startswith("ingredients_text_") and isinstance(value, str) and value.strip():
            return value.strip()
    ingredients = product.get("ingredients")
    if not isinstance(ingredients, list):
        return ""
    labels: list[str] = []
    for ingredient in ingredients:
        if not isinstance(ingredient, dict):
            continue
        label = _first_text(ingredient, "text", "name", "id")
        if label:
            labels.append(re.sub(r"^[a-z]{2}:", "", label).replace("-", " "))
    return ", ".join(dict.fromkeys(labels))


def _nutrition_values(nutriments: dict[str, Any]) -> dict[str, Any]:
    nutrition: dict[str, Any] = {}
    for key in NUTRITION_KEYS:
        candidates = [key]
        if key.endswith("_100g"):
            candidates.append(key.removesuffix("_100g"))
        for candidate in candidates:
            value = nutriments.get(candidate)
            if value not in (None, ""):
                nutrition[key] = value
                break
    return nutrition


def _direct_category_tags(product: dict[str, Any], expanded: list[str]) -> list[str]:
    direct: list[str] = []
    tag_sources = product.get("tags_sources")
    if isinstance(tag_sources, dict):
        for source in tag_sources.values():
            if not isinstance(source, dict):
                continue
            category_data = source.get("categories")
            tags = category_data.get("tags") if isinstance(category_data, dict) else None
            if isinstance(tags, list):
                direct.extend(str(tag) for tag in tags if str(tag).strip())
    if direct:
        return list(dict.fromkeys(direct))
    main_category = product.get("main_category")
    if isinstance(main_category, str) and main_category.strip():
        return [main_category.strip()]
    return expanded[-1:] if expanded else []


def _empty_product_details() -> dict[str, Any]:
    return {
        "categories": [],
        "direct_categories": [],
        "ingredients_text": "",
        "nutriscore_grade": "",
        "nova_group": "",
        "ecoscore_grade": "",
        "nutrition": {},
    }


def _merge_product_details(
    base: dict[str, Any], details: dict[str, Any] | None = None
) -> dict[str, Any]:
    merged = {**_empty_product_details(), **base}
    if not details:
        return merged
    for key in (
        "name",
        "brand",
        "package_quantity",
        "ingredients_text",
        "nutriscore_grade",
        "nova_group",
        "ecoscore_grade",
        "image_url",
        "source",
        "source_url",
    ):
        if not merged.get(key) and details.get(key):
            merged[key] = details[key]
    if not merged.get("categories") and isinstance(details.get("categories"), list):
        merged["categories"] = details["categories"]
    if not merged.get("direct_categories") and isinstance(details.get("direct_categories"), list):
        merged["direct_categories"] = details["direct_categories"]
    if not merged.get("nutrition") and isinstance(details.get("nutrition"), dict):
        merged["nutrition"] = details["nutrition"]
    return merged


def normalize_barcode(value: str) -> str:
    code = re.sub(r"\D", "", value)
    if not 4 <= len(code) <= 18:
        raise ValueError("Barcode must contain 4 to 18 digits")
    stripped = code.lstrip("0") or "0"
    if len(stripped) <= 7:
        return stripped.zfill(8)
    if len(stripped) <= 12:
        return stripped.zfill(13)
    return code


def decode_image_code(data: bytes, content_type: str | None = None) -> str:
    if len(data) > IMAGE_DECODE_LIMIT_BYTES:
        raise ValueError("Image exceeds the 8 MB limit")
    if not data:
        raise ValueError("Image is empty")
    mime_type = (content_type or "").split(";", 1)[0].strip().casefold()
    suffix = SUPPORTED_IMAGE_TYPES.get(mime_type, ".jpg")
    zbarimg = shutil.which("zbarimg")
    if zbarimg is None:
        raise RuntimeError("Photo scanning needs zbar-tools installed on the Pi")

    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
            temp_file.write(data)
            temp_path = Path(temp_file.name)
        result = subprocess.run(
            [zbarimg, "--raw", "--quiet", str(temp_path)],
            capture_output=True,
            check=False,
            text=True,
            timeout=20,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Photo scanning timed out; try a closer, brighter photo") from exc
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)

    values = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if values:
        return values[0]
    if result.stderr.strip():
        raise ValueError("No barcode or QR code found in that photo")
    raise ValueError("No barcode or QR code found in that photo")


def map_facts_product(
    code: str, payload: dict[str, Any], provider: dict[str, str]
) -> dict[str, Any] | None:
    product = payload.get("product")
    if not isinstance(product, dict):
        return None
    name = _first_text(
        product,
        "product_name",
        "product_name_it",
        "product_name_en",
        "generic_name",
        "generic_name_it",
        "generic_name_en",
    )
    brands = _first_text(product, "brands")
    categories = product.get("categories_tags") or []
    if not isinstance(categories, list):
        categories = []
    category_tags = [str(value) for value in categories[:20]]
    image = product.get("image_front_url") or product.get("image_url")
    nutriments = product.get("nutriments") if isinstance(product.get("nutriments"), dict) else {}
    return {
        "barcode": str(product.get("code") or code),
        "name": name,
        "brand": brands,
        "package_quantity": _first_text(product, "quantity", "serving_size"),
        "categories": category_tags,
        "direct_categories": _direct_category_tags(product, category_tags),
        "ingredients_text": _ingredients_text(product),
        "nutriscore_grade": _first_text(
            product, "nutriscore_grade", "nutrition_grade_fr", "nutrition_grades"
        ),
        "nova_group": _first_text(product, "nova_group"),
        "ecoscore_grade": _first_text(product, "ecoscore_grade", "ecoscore_grade_fr"),
        "nutrition": _nutrition_values(nutriments),
        "image_url": image if isinstance(image, str) else None,
        "source": provider["label"],
        "source_url": provider["page"].format(code=code),
    }


def map_open_food_facts(code: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    return map_facts_product(code, payload, BARCODE_PROVIDERS[0])


def cached_product_details(connection: sqlite3.Connection, code: str) -> dict[str, Any]:
    row = connection.execute(
        """
        SELECT response_json FROM external_cache
        WHERE provider = 'barcode_lookup' AND cache_key = ?
        ORDER BY fetched_at DESC LIMIT 1
        """,
        (code,),
    ).fetchone()
    if row is None or not row["response_json"]:
        return {}
    try:
        product = json.loads(row["response_json"]).get("product") or {}
    except json.JSONDecodeError:
        return {}
    return product if isinstance(product, dict) else {}


def cached_result(connection: sqlite3.Connection, code: str) -> dict[str, Any] | None:
    row = connection.execute(
        """
        SELECT response_json FROM external_cache
        WHERE provider = 'barcode_lookup' AND cache_key = ?
          AND expires_at > CURRENT_TIMESTAMP
        """,
        (code,),
    ).fetchone()
    return json.loads(row["response_json"]) if row and row["response_json"] else None


def stale_product(connection: sqlite3.Connection, code: str) -> dict[str, Any] | None:
    row = connection.execute("SELECT * FROM products WHERE barcode = ?", (code,)).fetchone()
    if row is None:
        return None
    details = cached_product_details(connection, code)
    return _merge_product_details(
        {
            "barcode": row["barcode"],
            "name": row["name"],
            "brand": row["brand"],
            "package_quantity": row["net_quantity_text"],
            "image_url": row["image_url"],
            "source": row["source"],
            "source_url": "",
            "stale": True,
        },
        details,
    )


def local_product(connection: sqlite3.Connection, code: str) -> dict[str, Any] | None:
    details = cached_product_details(connection, code)
    product = connection.execute("SELECT * FROM products WHERE barcode = ?", (code,)).fetchone()
    if product is not None and (product["name"] or product["brand"]):
        merged = _merge_product_details(
            {
                "barcode": product["barcode"],
                "name": product["name"],
                "brand": product["brand"],
                "package_quantity": product["net_quantity_text"],
                "image_url": product["local_image_url"] or product["image_url"],
                "source": product["source"] or "Findstuff",
                "source_url": "",
            },
            details,
        )
        if not merged.get("source_url") and product["source"] == "Open Food Facts":
            merged["source_url"] = f"https://world.openfoodfacts.org/product/{code}"
        return merged
    item = connection.execute(
        """
        SELECT name, brand, barcode_override FROM items
        WHERE barcode_override = ? AND archived_at IS NULL
        ORDER BY updated_at DESC LIMIT 1
        """,
        (code,),
    ).fetchone()
    if item is None:
        return None
    return _merge_product_details(
        {
            "barcode": code,
            "name": item["name"],
            "brand": item["brand"],
            "package_quantity": "",
            "image_url": None,
            "source": "Findstuff",
            "source_url": "",
        },
        details,
    )


def existing_item_for_barcode(
    connection: sqlite3.Connection, code: str
) -> dict[str, Any] | None:
    row = connection.execute(
        """
        SELECT items.public_id
        FROM items
        LEFT JOIN products ON products.id = items.product_id
        WHERE items.archived_at IS NULL
          AND (items.barcode_override = ? OR products.barcode = ?)
        ORDER BY items.updated_at DESC, items.id DESC
        LIMIT 1
        """,
        (code, code),
    ).fetchone()
    if row:
        return get_item(connection, row["public_id"])
    # Older scans may have stored an equivalent UPC/EAN without its padding zero.
    for candidate in connection.execute(
        """
        SELECT items.public_id,
               COALESCE(NULLIF(items.barcode_override, ''), products.barcode) AS barcode
        FROM items LEFT JOIN products ON products.id = items.product_id
        WHERE items.archived_at IS NULL
          AND COALESCE(NULLIF(items.barcode_override, ''), products.barcode, '') != ''
        ORDER BY items.updated_at DESC, items.id DESC
        """
    ):
        try:
            if normalize_barcode(candidate["barcode"]) == code:
                return get_item(connection, candidate["public_id"])
        except ValueError:
            continue
    return None


def suggest_location(
    connection: sqlite3.Connection, product: dict[str, Any] | None
) -> dict[str, str] | None:
    if not product:
        return None
    default = suggest_default_location(
        connection,
        name=product.get("name", ""),
        barcode=product.get("barcode", ""),
        category=" ".join(product.get("categories", [])),
    )
    if default:
        return default
    searchable = " ".join(
        [product.get("name", ""), product.get("brand", ""), *product.get("categories", [])]
    ).casefold()
    rules = connection.execute(
        """
        SELECT location_rules.match_value, locations.public_id, locations.name
        FROM location_rules JOIN locations ON locations.id = location_rules.location_id
        WHERE location_rules.enabled = 1 AND locations.archived_at IS NULL
        ORDER BY location_rules.priority DESC, location_rules.id
        """
    ).fetchall()
    for rule in rules:
        if rule["match_value"].casefold() in searchable:
            return {
                "public_id": rule["public_id"],
                "name": rule["name"],
                "reason": f"Rule matched '{rule['match_value']}'",
            }
    built_ins = [
        (("frozen",), "freezer"),
        (("milk", "yogurt", "cheese"), "fridge"),
        (("cat food", "pet food"), "pet shelf"),
        (("pasta", "rice", "cereal"), "pantry"),
    ]
    locations = connection.execute(
        "SELECT public_id, name FROM locations WHERE archived_at IS NULL"
    ).fetchall()
    for terms, desired in built_ins:
        if any(term in searchable for term in terms):
            match = next((row for row in locations if desired in row["name"].casefold()), None)
            if match:
                return {
                    "public_id": match["public_id"],
                    "name": match["name"],
                    "reason": f"Suggested for {terms[0]}",
                }
    return None


def add_category_mapping(
    connection: sqlite3.Connection, response: dict[str, Any], *, observe: bool = True
) -> dict[str, Any]:
    product = response.get("product")
    tags = product.get("categories", []) if isinstance(product, dict) else []
    cleaned = [str(tag) for tag in tags if str(tag).strip()] if isinstance(tags, list) else []
    if observe:
        barcode = str(product.get("barcode") or "") if isinstance(product, dict) else ""
        direct = product.get("direct_categories", []) if isinstance(product, dict) else []
        observe_categories(
            connection,
            cleaned,
            barcode,
            [str(tag) for tag in direct] if isinstance(direct, list) else [],
        )
    response["mapped_category"] = resolve_category(connection, cleaned)
    return response


def save_result(connection: sqlite3.Connection, code: str, result: dict[str, Any] | None) -> None:
    now = datetime.now(UTC)
    expires = now + (timedelta(days=30) if result else timedelta(days=1))
    envelope = {"found": result is not None, "product": result, "cached": False}
    with transaction(connection):
        connection.execute(
            """
            INSERT INTO external_cache(provider, cache_key, response_json, status, expires_at)
            VALUES ('barcode_lookup', ?, ?, ?, ?)
            ON CONFLICT(provider, cache_key) DO UPDATE SET
                response_json = excluded.response_json,
                status = excluded.status,
                fetched_at = CURRENT_TIMESTAMP,
                expires_at = excluded.expires_at
            """,
            (
                code,
                json.dumps(envelope, separators=(",", ":")),
                "found" if result else "not_found",
                expires.strftime("%Y-%m-%d %H:%M:%S"),
            ),
        )
        if result:
            connection.execute(
                """
                INSERT INTO products(
                    barcode, name, brand, net_quantity_text, image_url,
                    source, source_updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(barcode) DO UPDATE SET
                    name = excluded.name,
                    brand = excluded.brand,
                    net_quantity_text = excluded.net_quantity_text,
                    image_url = excluded.image_url,
                    source = excluded.source,
                    source_updated_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    code,
                    result["name"],
                    result["brand"],
                    result["package_quantity"],
                    result["image_url"],
                    result["source"],
                ),
            )


def save_full_product(
    connection: sqlite3.Connection,
    code: str,
    product: dict[str, Any],
    provider: dict[str, str],
) -> None:
    payload = {
        "product": product,
        "source": provider["label"],
        "source_url": provider["page"].format(code=code),
    }
    expires = datetime.now(UTC) + timedelta(days=30)
    with transaction(connection):
        connection.execute(
            """
            INSERT INTO external_cache(provider, cache_key, response_json, status, expires_at)
            VALUES ('facts_full_product', ?, ?, 'found', ?)
            ON CONFLICT(provider, cache_key) DO UPDATE SET
                response_json = excluded.response_json,
                status = excluded.status,
                fetched_at = CURRENT_TIMESTAMP,
                expires_at = excluded.expires_at
            """,
            (
                code,
                json.dumps(payload, separators=(",", ":")),
                expires.strftime("%Y-%m-%d %H:%M:%S"),
            ),
        )


def cached_full_product(connection: sqlite3.Connection, code: str) -> dict[str, Any] | None:
    row = connection.execute(
        """
        SELECT response_json FROM external_cache
        WHERE provider = 'facts_full_product' AND cache_key = ?
        """,
        (code,),
    ).fetchone()
    if row is None or not row["response_json"]:
        return None
    try:
        payload = json.loads(row["response_json"])
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


async def lookup_barcode(
    connection: sqlite3.Connection,
    value: str,
    *,
    refresh: bool = False,
    observe: bool = True,
    full: bool = False,
) -> dict[str, Any]:
    code = normalize_barcode(value)
    existing_item = existing_item_for_barcode(connection, code)
    if not refresh:
        local = local_product(connection, code)
        if local is not None:
            return add_category_mapping(connection, {
                "found": True,
                "product": local,
                "cached": True,
                "local": True,
                "existing_item": existing_item,
                "suggested_location": suggest_location(connection, local),
            }, observe=observe)
        cached = cached_result(connection, code)
        if cached is not None:
            cached["cached"] = True
            cached["existing_item"] = existing_item
            cached["suggested_location"] = suggest_location(connection, cached.get("product"))
            return add_category_mapping(connection, cached, observe=observe)
    last_error: Exception | None = None
    result: dict[str, Any] | None = None
    saw_response = False
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(12.0 if full else 4.0),
            follow_redirects=True,
            headers={"User-Agent": "Findstuff/0.1 (self-hosted inventory)"},
        ) as client:
            for provider in BARCODE_PROVIDERS:
                try:
                    parameters = (
                        {}
                        if full
                        else {
                            "fields": (
                                "code,product_name,product_name_it,product_name_en,"
                                "generic_name,generic_name_it,generic_name_en,brands,"
                                "quantity,serving_size,categories,categories_tags,main_category,"
                                "tags_sources,ingredients,"
                                "ingredients_tags,ingredients_text,"
                                "ingredients_text_it,ingredients_text_en,"
                                "ingredients_text_with_allergens,"
                                "ingredients_text_with_allergens_it,"
                                "ingredients_text_with_allergens_en,nutriscore_grade,"
                                "nutrition_grade_fr,nutrition_grades,nova_group,"
                                "ecoscore_grade,ecoscore_grade_fr,nutriments,"
                                "image_front_url,image_url"
                            )
                        }
                    )
                    response = await client.get(
                        provider["api"].format(code=code),
                        params=parameters,
                    )
                    if response.status_code == 404:
                        saw_response = True
                        continue
                    response.raise_for_status()
                    saw_response = True
                    payload = response.json()
                    mapped = map_facts_product(code, payload, provider)
                    if mapped and (mapped["name"] or mapped["brand"] or mapped["image_url"]):
                        result = mapped
                        raw_product = payload.get("product")
                        if full and isinstance(raw_product, dict):
                            save_full_product(connection, code, raw_product, provider)
                        break
                except (httpx.HTTPError, ValueError, json.JSONDecodeError) as exc:
                    last_error = exc
                    continue
    except httpx.HTTPError as exc:
        last_error = exc
    if result is None and last_error is not None and not saw_response:
        stale = stale_product(connection, code)
        if stale:
            return add_category_mapping(connection, {
                "found": True,
                "product": stale,
                "cached": True,
                "warning": str(last_error),
                "existing_item": existing_item,
                "suggested_location": suggest_location(connection, stale),
            }, observe=observe)
        raise RuntimeError("Product lookup is temporarily unavailable") from last_error
    save_result(connection, code, result)
    return add_category_mapping(connection, {
        "found": result is not None,
        "product": result,
        "cached": False,
        "existing_item": existing_item,
        "suggested_location": suggest_location(connection, result),
    }, observe=observe)
