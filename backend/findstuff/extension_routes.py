"""Read endpoints for structured metadata and project planning."""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
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
