from __future__ import annotations

import json
import sqlite3
from typing import Any

from .barcodes import cached_full_product, cached_product_details, lookup_barcode, normalize_barcode
from .db import transaction
from .inventory import (
    ConflictError,
    NotFoundError,
    get_item,
    get_item_row,
    new_public_id,
    update_item,
)


def queue_enrichment(
    connection: sqlite3.Connection,
    item_public_id: str,
    provider: str = "open_food_facts",
    job_type: str = "product",
    *,
    refresh: bool = False,
) -> dict[str, Any]:
    item = get_item_row(connection, item_public_id)
    if provider != "open_food_facts":
        raise ConflictError("Unsupported enrichment provider")
    reusable_statuses = "'queued', 'running'" if refresh else "'queued', 'running', 'completed'"
    existing = connection.execute(
        f"""
        SELECT public_id, status, provider, job_type FROM enrichment_jobs
        WHERE item_id = ? AND provider = ? AND job_type = ?
          AND status IN ({reusable_statuses})
        ORDER BY id DESC LIMIT 1
        """,
        (item["id"], provider, job_type),
    ).fetchone()
    if existing is not None:
        return dict(existing)
    public_id = new_public_id("job")
    with transaction(connection):
        connection.execute(
            """
            INSERT INTO enrichment_jobs(public_id, item_id, provider, job_type)
            VALUES (?, ?, ?, ?)
            """,
            (public_id, item["id"], provider, job_type),
        )
    return {"public_id": public_id, "status": "queued", "provider": provider, "job_type": job_type}


def queue_missing_enrichment(
    connection: sqlite3.Connection,
    *,
    provider: str = "open_food_facts",
    limit: int = 25,
) -> int:
    if provider != "open_food_facts":
        raise ConflictError("Unsupported enrichment provider")
    rows = connection.execute(
        """
        WITH RECURSIVE food_categories(id) AS (
            SELECT id FROM categories WHERE slug IN ('groceries', 'consumables')
            UNION ALL
            SELECT categories.id FROM categories
            JOIN food_categories ON categories.parent_id = food_categories.id
        )
        SELECT items.public_id
        FROM items
        LEFT JOIN categories ON categories.id = items.category_id
        LEFT JOIN products ON products.id = items.product_id
        WHERE items.archived_at IS NULL
          AND (
              categories.id IN (SELECT id FROM food_categories)
              OR products.source = 'Open Food Facts'
          )
          AND COALESCE(NULLIF(items.barcode_override, ''), products.barcode, '') != ''
          AND NOT EXISTS (
              SELECT 1 FROM enrichment_jobs
              WHERE enrichment_jobs.item_id = items.id
                AND enrichment_jobs.provider = ?
                AND enrichment_jobs.status IN ('queued', 'running', 'completed')
          )
        ORDER BY items.updated_at DESC
        LIMIT ?
        """,
        (provider, max(1, min(limit, 250))),
    ).fetchall()
    for row in rows:
        queue_enrichment(connection, row["public_id"], provider=provider)
    return len(rows)


def count_missing_enrichment(
    connection: sqlite3.Connection,
    *,
    provider: str = "open_food_facts",
) -> int:
    if provider != "open_food_facts":
        raise ConflictError("Unsupported enrichment provider")
    row = connection.execute(
        """
        WITH RECURSIVE food_categories(id) AS (
            SELECT id FROM categories WHERE slug IN ('groceries', 'consumables')
            UNION ALL
            SELECT categories.id FROM categories
            JOIN food_categories ON categories.parent_id = food_categories.id
        )
        SELECT COUNT(*) AS count
        FROM items
        LEFT JOIN categories ON categories.id = items.category_id
        LEFT JOIN products ON products.id = items.product_id
        WHERE items.archived_at IS NULL
          AND (
              categories.id IN (SELECT id FROM food_categories)
              OR products.source = 'Open Food Facts'
          )
          AND COALESCE(NULLIF(items.barcode_override, ''), products.barcode, '') != ''
          AND NOT EXISTS (
              SELECT 1 FROM enrichment_jobs
              WHERE enrichment_jobs.item_id = items.id
                AND enrichment_jobs.provider = ?
                AND enrichment_jobs.status IN ('queued', 'running', 'completed')
          )
        """,
        (provider,),
    ).fetchone()
    return int(row["count"])


async def run_one(connection: sqlite3.Connection, job_id: int) -> None:
    job = connection.execute(
        """
        SELECT enrichment_jobs.*, items.public_id AS item_public_id,
               COALESCE(NULLIF(items.barcode_override, ''), products.barcode, '') AS barcode
        FROM enrichment_jobs
        JOIN items ON items.id = enrichment_jobs.item_id
        LEFT JOIN products ON products.id = items.product_id
        WHERE enrichment_jobs.id = ?
        """,
        (job_id,),
    ).fetchone()
    if job is None:
        raise NotFoundError("Enrichment job not found")
    with transaction(connection):
        connection.execute(
            """
            UPDATE enrichment_jobs SET status = 'running', started_at = CURRENT_TIMESTAMP,
                attempt_count = attempt_count + 1 WHERE id = ?
            """,
            (job_id,),
        )
    try:
        if not job["barcode"]:
            raise ConflictError("Open Food Facts enrichment requires an item barcode")
        lookup = await lookup_barcode(
            connection, job["barcode"], refresh=True, observe=False, full=True
        )
        if not lookup["found"]:
            raise ConflictError("No Open Food Facts product was found")
        current = get_item(connection, job["item_public_id"])
        product = lookup["product"]
        proposed = {
            key: value
            for key, value in {
                "name": product["name"] if not current["name"] else None,
                "brand": product["brand"] if not current["brand"] else None,
            }.items()
            if value
        }
        with transaction(connection):
            connection.execute(
                """
                INSERT INTO enrichment_candidates(
                    public_id, job_id, proposed_json, source_url, source_label, confidence
                ) VALUES (?, ?, ?, ?, 'Open Food Facts', 0.9)
                """,
                (
                    new_public_id("candidate"),
                    job_id,
                    json.dumps(proposed, separators=(",", ":")),
                    product["source_url"],
                ),
            )
            connection.execute(
                """
                UPDATE enrichment_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (job_id,),
            )
            connection.execute(
                """
                DELETE FROM enrichment_jobs
                WHERE item_id = ? AND provider = ? AND id != ?
                  AND status IN ('completed', 'failed')
                """,
                (job["item_id"], job["provider"], job_id),
            )
    except Exception as exc:
        with transaction(connection):
            connection.execute(
                "UPDATE enrichment_jobs SET status = 'failed', error = ? WHERE id = ?",
                (str(exc), job_id),
            )


async def run_pending(connection: sqlite3.Connection, limit: int = 5) -> int:
    jobs = connection.execute(
        "SELECT id FROM enrichment_jobs WHERE status = 'queued' ORDER BY id LIMIT ?", (limit,)
    ).fetchall()
    for job in jobs:
        await run_one(connection, job["id"])
    return len(jobs)


def list_enrichment(connection: sqlite3.Connection, item_public_id: str) -> dict[str, Any]:
    item = get_item_row(connection, item_public_id)
    product_row = None
    if item["barcode"]:
        product_row = connection.execute(
            "SELECT * FROM products WHERE barcode = ?", (item["barcode"],)
        ).fetchone()
    product = None
    if product_row is not None:
        source_url = ""
        cached_details: dict[str, Any] = {}
        cached_details = cached_product_details(connection, item["barcode"])
        source_url = str(cached_details.get("source_url") or "")
        product = {
            "barcode": product_row["barcode"],
            "name": product_row["name"],
            "brand": product_row["brand"],
            "package_quantity": product_row["net_quantity_text"],
            "ingredients_text": str(cached_details.get("ingredients_text") or ""),
            "nutriscore_grade": str(cached_details.get("nutriscore_grade") or ""),
            "nova_group": str(cached_details.get("nova_group") or ""),
            "ecoscore_grade": str(cached_details.get("ecoscore_grade") or ""),
            "nutrition": cached_details.get("nutrition")
            if isinstance(cached_details.get("nutrition"), dict)
            else {},
            "image_url": product_row["local_image_url"] or product_row["image_url"],
            "source": product_row["source"],
            "source_url": source_url,
            "source_updated_at": product_row["source_updated_at"],
        }
    jobs = [
        dict(row)
        for row in connection.execute(
            """
            SELECT public_id, provider, job_type, status, error, requested_at, completed_at
            FROM enrichment_jobs WHERE item_id = ? ORDER BY id DESC
            """,
            (item["id"],),
        )
    ]
    candidates = [
        {
            **dict(row),
            "proposed": json.loads(row["proposed_json"]),
        }
        for row in connection.execute(
            """
            SELECT enrichment_candidates.public_id, enrichment_candidates.proposed_json,
                   enrichment_candidates.source_url, enrichment_candidates.source_label,
                   enrichment_candidates.confidence, enrichment_candidates.status
            FROM enrichment_candidates
            JOIN enrichment_jobs ON enrichment_jobs.id = enrichment_candidates.job_id
            WHERE enrichment_jobs.item_id = ? ORDER BY enrichment_candidates.id DESC
            """,
            (item["id"],),
        )
    ]
    full_product_available = False
    if item["barcode"]:
        try:
            full_product_available = bool(
                cached_full_product(connection, normalize_barcode(item["barcode"]))
            )
        except ValueError:
            full_product_available = False
    return {
        "product": product,
        "full_product_available": full_product_available,
        "jobs": jobs,
        "candidates": candidates,
    }


def get_full_product_data(
    connection: sqlite3.Connection, item_public_id: str
) -> dict[str, Any]:
    item = get_item_row(connection, item_public_id)
    if not item["barcode"]:
        raise NotFoundError("Item has no barcode product data")
    try:
        payload = cached_full_product(connection, normalize_barcode(item["barcode"]))
    except ValueError as exc:
        raise NotFoundError("Item has no barcode product data") from exc
    if payload is None:
        raise NotFoundError("Run Open Food Facts lookup first")
    return payload


def clear_enrichment_history(connection: sqlite3.Connection, item_public_id: str) -> None:
    item = get_item_row(connection, item_public_id)
    with transaction(connection):
        connection.execute("DELETE FROM enrichment_jobs WHERE item_id = ?", (item["id"],))


def apply_candidate(connection: sqlite3.Connection, public_id: str) -> dict[str, Any]:
    row = connection.execute(
        """
        SELECT enrichment_candidates.*, items.public_id AS item_public_id, items.version
        FROM enrichment_candidates
        JOIN enrichment_jobs ON enrichment_jobs.id = enrichment_candidates.job_id
        JOIN items ON items.id = enrichment_jobs.item_id
        WHERE enrichment_candidates.public_id = ?
        """,
        (public_id,),
    ).fetchone()
    if row is None:
        raise NotFoundError("Enrichment candidate not found")
    if row["status"] != "proposed":
        raise ConflictError(f"Candidate is already {row['status']}")
    changes = json.loads(row["proposed_json"])
    changes["expected_version"] = row["version"]
    result = update_item(connection, row["item_public_id"], changes, source="enrichment")
    with transaction(connection):
        connection.execute(
            "UPDATE enrichment_candidates SET status = 'accepted', decided_at = CURRENT_TIMESTAMP "
            "WHERE id = ?",
            (row["id"],),
        )
    return result
