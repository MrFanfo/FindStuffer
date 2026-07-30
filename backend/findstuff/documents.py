from __future__ import annotations

import hashlib
import re
import shutil
import sqlite3
import subprocess
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .config import get_settings
from .db import connect, transaction
from .inventory import NotFoundError, get_item_row, new_public_id, record_event

MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
DOCUMENT_TYPES = {"receipt", "invoice", "manual", "certificate", "warranty", "other"}
MIME_EXTENSIONS = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
SIGNATURES = {
    "application/pdf": b"%PDF-",
    "image/jpeg": b"\xff\xd8\xff",
    "image/png": b"\x89PNG\r\n\x1a\n",
    "image/webp": b"RIFF",
}
SERIAL_PATTERN = re.compile(
    r"\b(?:serial(?:\s+number)?|s[\s./-]*n|sn)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{3,39})",
    re.IGNORECASE,
)
DATE_PATTERN = re.compile(
    r"\b(20\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])|"
    r"(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.]20\d{2})\b"
)


def _validate_document(data: bytes, declared_type: str) -> tuple[str, str]:
    mime_type = declared_type.split(";", 1)[0].strip().lower()
    if not data:
        raise ValueError("Document is empty")
    if len(data) > MAX_DOCUMENT_BYTES:
        raise ValueError("Document exceeds the 20 MB limit")
    signature = SIGNATURES.get(mime_type)
    if signature is None or not data.startswith(signature):
        raise ValueError("Only valid PDF, JPEG, PNG, and WebP documents are accepted")
    if mime_type == "image/webp" and data[8:12] != b"WEBP":
        raise ValueError("Invalid WebP document")
    return mime_type, MIME_EXTENSIONS[mime_type]


def serialize_document(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "public_id": row["public_id"],
        "item_public_id": row["item_public_id"],
        "document_type": row["document_type"],
        "title": row["title"],
        "original_name": row["original_name"],
        "mime_type": row["mime_type"],
        "size_bytes": row["size_bytes"],
        "purchase_date": row["purchase_date"],
        "warranty_expires_at": row["warranty_expires_at"],
        "extracted_text": row["extracted_text"],
        "extracted_serial_number": row["extracted_serial_number"],
        "extracted_purchase_date": row["extracted_purchase_date"],
        "extracted_warranty_expires_at": row["extracted_warranty_expires_at"],
        "extraction_status": row["extraction_status"],
        "extraction_error": row["extraction_error"],
        "content_url": f"/api/v1/documents/{row['public_id']}/content",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _document_row(connection: sqlite3.Connection, public_id: str) -> sqlite3.Row:
    row = connection.execute(
        """
        SELECT item_documents.*, items.public_id AS item_public_id
        FROM item_documents JOIN items ON items.id = item_documents.item_id
        WHERE item_documents.public_id = ?
        """,
        (public_id,),
    ).fetchone()
    if row is None:
        raise NotFoundError("Document not found")
    return row


def get_document(connection: sqlite3.Connection, public_id: str) -> dict[str, Any]:
    return serialize_document(_document_row(connection, public_id))


def get_document_path(connection: sqlite3.Connection, public_id: str) -> Path:
    row = _document_row(connection, public_id)
    base = get_settings().data_dir.resolve()
    path = (base / row["file_path"]).resolve()
    if base not in path.parents or not path.is_file():
        raise ValueError("Document file not found")
    return path


def list_documents(
    connection: sqlite3.Connection, item_public_id: str
) -> list[dict[str, Any]]:
    item = get_item_row(connection, item_public_id)
    rows = connection.execute(
        """
        SELECT item_documents.*, items.public_id AS item_public_id
        FROM item_documents JOIN items ON items.id = item_documents.item_id
        WHERE item_documents.item_id = ?
        ORDER BY item_documents.created_at DESC, item_documents.id DESC
        """,
        (item["id"],),
    ).fetchall()
    return [serialize_document(row) for row in rows]


def store_document(
    connection: sqlite3.Connection,
    item_public_id: str,
    data: bytes,
    declared_type: str,
    original_name: str,
    title: str,
    document_type: str,
    purchase_date: str | None,
    warranty_expires_at: str | None,
) -> dict[str, Any]:
    item = get_item_row(connection, item_public_id)
    mime_type, extension = _validate_document(data, declared_type)
    kind = document_type if document_type in DOCUMENT_TYPES else "other"
    digest = hashlib.sha256(data).hexdigest()
    existing = connection.execute(
        "SELECT public_id FROM item_documents WHERE item_id = ? AND sha256 = ?",
        (item["id"], digest),
    ).fetchone()
    if existing:
        return get_document(connection, existing["public_id"])
    public_id = new_public_id("doc")
    relative = Path("documents") / item_public_id / f"{public_id}{extension}"
    absolute = get_settings().data_dir / relative
    absolute.parent.mkdir(parents=True, exist_ok=True)
    temporary = absolute.with_suffix(f"{absolute.suffix}.tmp")
    temporary.write_bytes(data)
    temporary.replace(absolute)
    safe_name = Path(original_name or f"{kind}{extension}").name[:240]
    display_title = (title.strip() or Path(safe_name).stem or kind.title())[:240]
    try:
        with transaction(connection):
            connection.execute(
                """
                INSERT INTO item_documents(
                    public_id, item_id, document_type, title, file_path, original_name,
                    mime_type, size_bytes, sha256, purchase_date, warranty_expires_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    public_id,
                    item["id"],
                    kind,
                    display_title,
                    relative.as_posix(),
                    safe_name,
                    mime_type,
                    len(data),
                    digest,
                    purchase_date,
                    warranty_expires_at,
                ),
            )
            record_event(
                connection,
                item["id"],
                "add_document",
                None,
                {"public_id": public_id, "title": display_title, "document_type": kind},
            )
    except Exception:
        absolute.unlink(missing_ok=True)
        raise
    return get_document(connection, public_id)


def update_document(
    connection: sqlite3.Connection, public_id: str, changes: dict[str, Any]
) -> dict[str, Any]:
    row = _document_row(connection, public_id)
    allowed = {"title", "document_type", "purchase_date", "warranty_expires_at"}
    values = {key: value for key, value in changes.items() if key in allowed}
    if values.get("document_type") not in DOCUMENT_TYPES:
        values.pop("document_type", None)
    if not values:
        return serialize_document(row)
    assignments = [f"{key} = ?" for key in values]
    with transaction(connection):
        connection.execute(
            f"UPDATE item_documents SET {', '.join(assignments)}, "
            "updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (*values.values(), row["id"]),
        )
    return get_document(connection, public_id)


def delete_document(connection: sqlite3.Connection, public_id: str) -> None:
    row = _document_row(connection, public_id)
    absolute = get_document_path(connection, public_id)
    with transaction(connection):
        connection.execute("DELETE FROM item_documents WHERE id = ?", (row["id"],))
    absolute.unlink(missing_ok=True)


def _parse_date(value: str) -> str | None:
    normalized = value.replace(".", "-").replace("/", "-")
    for pattern in ("%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(normalized, pattern).date().isoformat()
        except ValueError:
            continue
    return None


def _date_near(text: str, keywords: tuple[str, ...]) -> str | None:
    lowered = text.casefold()
    for match in DATE_PATTERN.finditer(text):
        context = lowered[max(0, match.start() - 80) : match.end() + 30]
        if any(keyword in context for keyword in keywords):
            parsed = _parse_date(match.group(1))
            if parsed:
                return parsed
    return None


def _extract_text(path: Path, mime_type: str) -> tuple[str, str | None]:
    if mime_type == "application/pdf":
        command = shutil.which("pdftotext")
        if not command:
            return "", "Install poppler-utils to extract PDF text"
        result = subprocess.run(
            [command, "-layout", str(path), "-"],
            capture_output=True,
            check=False,
            timeout=45,
        )
    else:
        command = shutil.which("tesseract")
        if not command:
            return "", "Install tesseract-ocr to extract image text"
        result = subprocess.run(
            [command, str(path), "stdout"],
            capture_output=True,
            check=False,
            timeout=45,
        )
    if result.returncode != 0:
        return "", result.stderr.decode("utf-8", errors="replace")[:500]
    return result.stdout.decode("utf-8", errors="replace")[:100_000].strip(), None


def extract_document_text(public_id: str, database_path: Path | None = None) -> None:
    connection = connect(database_path)
    try:
        row = _document_row(connection, public_id)
        base = get_settings().data_dir.resolve()
        path = (base / row["file_path"]).resolve()
        if base not in path.parents or not path.is_file():
            raise ValueError("Document file not found")
        connection.execute(
            "UPDATE item_documents SET extraction_status = 'processing', "
            "extraction_error = NULL WHERE id = ?",
            (row["id"],),
        )
        text, unavailable = _extract_text(path, row["mime_type"])
        serial_match = SERIAL_PATTERN.search(text)
        serial = serial_match.group(1) if serial_match else ""
        purchase = _date_near(
            text, ("purchase", "purchased", "invoice date", "receipt date", "acquisto", "data")
        )
        warranty = _date_near(
            text, ("warranty", "guarantee", "valid until", "expires", "garanzia", "scadenza")
        )
        status = "unavailable" if unavailable else "complete"
        with transaction(connection):
            connection.execute(
                """
                UPDATE item_documents SET extracted_text = ?,
                    extracted_serial_number = ?, extracted_purchase_date = ?,
                    extracted_warranty_expires_at = ?, extraction_status = ?,
                    extraction_error = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (text, serial, purchase, warranty, status, unavailable, row["id"]),
            )
    except Exception as exc:
        connection.execute(
            "UPDATE item_documents SET extraction_status = 'failed', extraction_error = ?, "
            "updated_at = CURRENT_TIMESTAMP WHERE public_id = ?",
            (str(exc)[:500], public_id),
        )
    finally:
        connection.close()


def apply_document_extraction(
    connection: sqlite3.Connection, public_id: str
) -> dict[str, Any]:
    row = _document_row(connection, public_id)
    item = get_item_row(connection, row["item_public_id"])
    before = {
        "serial_number": item["serial_number"],
        "purchase_date": row["purchase_date"],
        "warranty_expires_at": row["warranty_expires_at"],
    }
    serial = item["serial_number"] or row["extracted_serial_number"]
    purchase = row["purchase_date"] or row["extracted_purchase_date"]
    warranty = row["warranty_expires_at"] or row["extracted_warranty_expires_at"]
    with transaction(connection):
        if serial != item["serial_number"]:
            connection.execute(
                "UPDATE items SET serial_number = ?, version = version + 1, "
                "updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (serial, item["id"]),
            )
        connection.execute(
            "UPDATE item_documents SET purchase_date = ?, warranty_expires_at = ?, "
            "updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (purchase, warranty, row["id"]),
        )
        record_event(
            connection,
            item["id"],
            "apply_document_extraction",
            before,
            {
                "serial_number": serial,
                "purchase_date": purchase,
                "warranty_expires_at": warranty,
            },
        )
    return get_document(connection, public_id)


def warranties_due(
    connection: sqlite3.Connection, days: int = 30
) -> list[dict[str, Any]]:
    modifier = f"+{max(0, min(days, 3650))} days"
    rows = connection.execute(
        """
        SELECT item_documents.*, items.public_id AS item_public_id, items.name AS item_name
        FROM item_documents JOIN items ON items.id = item_documents.item_id
        WHERE items.archived_at IS NULL
          AND item_documents.warranty_expires_at IS NOT NULL
          AND date(item_documents.warranty_expires_at) <= date('now', ?)
        ORDER BY date(item_documents.warranty_expires_at), item_documents.id
        """,
        (modifier,),
    ).fetchall()
    return [
        {
            **serialize_document(row),
            "item_name": row["item_name"],
            "expired": row["warranty_expires_at"] < date.today().isoformat(),
        }
        for row in rows
    ]
