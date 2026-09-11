"""Read endpoints for structured metadata and project planning."""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, UploadFile
from pydantic import Field

from .compatibility import effective_compatibility, resolve_target, serialize_target, targets
from .custom_fields import category_fields, serialize_field
from .db import database_dependency
from .extensions import item_extensions
from .inventory import get_item
from .projects import acquired_to_inventory, inventory_candidates, project_detail
from .schemas import StrictModel

router = APIRouter(prefix="/api/v1", tags=["planning and metadata"])
Database = Annotated[Any, Depends(database_dependency)]


@router.get("/category-fields")
async def get_fields(database: Database, category: int | None = None):
    if category is not None:
        return category_fields(database, category, include_inactive=True)
    return [
        serialize_field(database, row)
        for row in database.execute("SELECT * FROM category_fields ORDER BY sort_order,id")
    ]


@router.get("/compatibility-targets")
async def get_targets(database: Database):
    return targets(database)


@router.get("/compatibility-targets/{public_id}")
async def target_detail(public_id: str, database: Database, offset: int = Query(0, ge=0)):
    target = resolve_target(database, public_id)
    matching = []
    for row in database.execute(
        "SELECT id,public_id FROM items WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE,id"
    ):
        relation = effective_compatibility(database, row["id"], public_id)
        if relation["status"] != "unknown":
            matching.append((row["public_id"], relation))
    related = [
        dict(row)
        for row in database.execute(
            (
                "SELECT p.public_id,p.name FROM projects p JOIN "
                "project_compatibility c ON c.project_id=p.id WHERE c.target_id=? "
                "UNION SELECT p.public_id,p.name FROM projects p JOIN project_requirements r "
                "ON r.project_id=p.id JOIN requirement_compatibility c "
                "ON c.requirement_id=r.id WHERE c.target_id=?"
            ),
            (target["id"], target["id"]),
        )
    ]
    return {
        "target": serialize_target(database, target),
        "linked_items": [
            get_item(database, row[0])
            for row in database.execute(
                "SELECT i.public_id FROM items i JOIN target_inventory_items r "
                "ON r.item_id=i.id WHERE r.target_id=? ORDER BY i.name,i.id",
                (target["id"],),
            )
        ],
        "total": len(matching),
        "items": [
            {**get_item(database, item_id), "effective_compatibility": relation}
            for item_id, relation in matching[offset : offset + 100]
        ],
        "next_offset": offset + 100 if offset + 100 < len(matching) else None,
        "projects": related,
    }


@router.get("/projects/{public_id}")
async def get_project(public_id: str, database: Database):
    return project_detail(database, public_id)


@router.get("/projects/{public_id}/candidates")
async def project_candidates(
    public_id: str,
    database: Database,
    requirement: str | None = None,
    q: str = Query("", max_length=240),
    offset: int = Query(0, ge=0),
):
    return inventory_candidates(database, public_id, requirement, q, offset)


@router.get("/items/{public_id}/extensions")
async def get_item_extensions(public_id: str, database: Database):
    return item_extensions(database, public_id)


class AcquiredStock(StrictModel):
    request_id: str = Field(min_length=8, max_length=120)
    expected_version: int = Field(ge=1)
    quantity: Decimal = Field(gt=0, decimal_places=3)
    location: str = "unassigned"
    custom_fields: dict[str, Any] = Field(default_factory=dict)


@router.post("/project-requirements/{public_id}/stock")
async def stock_acquisition(public_id: str, payload: AcquiredStock, database: Database):
    return acquired_to_inventory(database, public_id, payload.model_dump(mode="json"))


@router.get("/items/{public_id}/contents")
async def item_contents(public_id: str, database: Database):
    from .inventory import from_milli, get_item_row

    parent = get_item_row(database, public_id)
    rows = database.execute(
        "SELECT public_id,quantity_milli,unit FROM items WHERE container_item_id=? "
        "AND archived_at IS NULL ORDER BY name COLLATE NOCASE,id",
        (parent["id"],),
    ).fetchall()
    totals = {}
    for row in rows:
        totals[row["unit"]] = totals.get(row["unit"], 0) + row["quantity_milli"]
    return {
        "items": [get_item(database, row["public_id"]) for row in rows],
        "total": len(rows),
        "quantities_by_unit": {unit: from_milli(value) for unit, value in totals.items()},
    }


class ProjectAction(StrictModel):
    request_id: str = Field(min_length=8, max_length=120)
    action: Literal["clone", "finish", "output"]
    name: str = Field(default="", max_length=240)
    outputs: list[dict[str, Any]] = Field(default_factory=list, max_length=100)


@router.post("/projects/{public_id}/actions")
async def run_project_action(public_id: str, payload: ProjectAction, database: Database):
    from .project_workflows import project_action
    from .schemas import ItemCreate

    values = payload.model_dump(mode="json")
    values["outputs"] = [
        ItemCreate.model_validate(value).model_dump(mode="json") for value in values["outputs"]
    ]
    return project_action(database, public_id, values)


@router.post("/projects/{public_id}/files")
async def upload_project_file(public_id: str, database: Database, file: UploadFile):
    from pathlib import Path

    from .config import get_settings
    from .db import transaction
    from .documents import MAX_DOCUMENT_BYTES, _validate_document
    from .inventory import new_public_id
    from .projects import resolve_project

    project = resolve_project(database, public_id)
    data = await file.read(MAX_DOCUMENT_BYTES + 1)
    mime, extension = _validate_document(data, file.content_type or "")
    file_id = new_public_id("pfl")
    relative = f"documents/projects/{file_id}{extension}"
    path = get_settings().data_dir / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_bytes(data)
        with transaction(database):
            database.execute(
                (
                    "INSERT INTO "
                    "project_files(public_id,project_id,name,mime_type,file_path,size_byt"
                    "es) VALUES(?,?,?,?,?,?)"
                ),
                (
                    file_id,
                    project["id"],
                    Path(file.filename or "Attachment").name[:240],
                    mime,
                    relative,
                    len(data),
                ),
            )
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return project_detail(database, public_id)


@router.get("/project-files/{public_id}/content")
async def project_file_content(public_id: str, database: Database):
    from fastapi.responses import FileResponse

    from .config import get_settings
    from .inventory import NotFoundError

    row = database.execute("SELECT * FROM project_files WHERE public_id=?", (public_id,)).fetchone()
    if row is None:
        raise NotFoundError("Project attachment not found")
    root = get_settings().data_dir.resolve()
    base = root / "documents" / "projects"
    path = (root / row["file_path"]).resolve()
    if base not in path.parents or not path.is_file():
        raise NotFoundError("Project attachment file is unavailable")
    return FileResponse(
        path,
        media_type=row["mime_type"],
        filename=row["name"],
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.delete("/project-files/{public_id}")
async def delete_project_file(public_id: str, database: Database):
    from .db import transaction
    from .inventory import NotFoundError

    with transaction(database):
        if not database.execute(
            "DELETE FROM project_files WHERE public_id=?", (public_id,)
        ).rowcount:
            raise NotFoundError("Project attachment not found")
    # Keep bytes: a clone or completion snapshot can still reference this attachment.
    return {"deleted": public_id}
