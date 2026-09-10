"""Validated API and import contracts for inventory planning and structured metadata."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal

from pydantic import Field, field_validator

from .schemas import StrictModel

Reference = str | int


class FieldConstraints(StrictModel):
    min: Decimal | None = None
    max: Decimal | None = None
    min_length: int = Field(default=0, ge=0, le=8000)
    max_length: int = Field(default=8000, ge=1, le=8000)
    decimal_places: int = Field(default=6, ge=0, le=9)


class CategoryField(StrictModel):
    category: Reference
    overrides: str | None = None
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    label: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    type: Literal["string", "text", "integer", "decimal", "boolean", "enum", "date", "url"]
    required: bool = False
    nullable: bool = True
    default: Any = None
    allowed_values: list[str] = Field(default_factory=list, max_length=200)
    constraints: FieldConstraints = Field(default_factory=FieldConstraints)
    unit: str = Field(default="", max_length=24)
    sort_order: int = Field(default=0, ge=-10000, le=10000)
    active: bool = True


class CompatibilityTarget(StrictModel):
    name: str = Field(min_length=1, max_length=240)
    manufacturer: str = Field(default="", max_length=240)
    model: str = Field(default="", max_length=240)
    type: str = Field(default="", max_length=80)
    aliases: list[str] = Field(default_factory=list, max_length=50)
    parent: str | None = None
    active: bool = True

    @field_validator("aliases")
    @classmethod
    def clean_aliases(cls, values):
        if any(not value.strip() or len(value) > 240 for value in values):
            raise ValueError("Aliases must be nonempty strings of at most 240 characters")
        return list(dict.fromkeys(value.strip() for value in values))


class Project(StrictModel):
    name: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=4000)
    status: Literal["planned", "active", "completed", "archived"] = "planned"
    notes: str = Field(default="", max_length=8000)
    compatibility: list[str] = Field(default_factory=list, max_length=50)


class ProjectRequirement(StrictModel):
    project: str
    name: str = Field(min_length=1, max_length=240)
    item: str | dict[str, Any] | None = None
    category: Reference | None = None
    required_quantity: Decimal = Field(default=Decimal("1"), gt=0, decimal_places=3)
    inventory_quantity: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=3)
    purchased_quantity: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=3)
    acquired_quantity: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=3)
    unit: str = Field(default="pcs", min_length=1, max_length=24)
    reserve: bool = False
    notes: str = Field(default="", max_length=8000)
    status: Literal["needed", "in_progress", "satisfied", "cancelled"] = "needed"
    compatibility: list[str] = Field(default_factory=list, max_length=50)


ENTITY_MODELS = {
    "category_field": CategoryField,
    "compatibility_target": CompatibilityTarget,
    "project": Project,
    "project_requirement": ProjectRequirement,
}
ENTITY_TABLES = {
    "category_field": "category_fields",
    "compatibility_target": "compatibility_targets",
    "project": "projects",
    "project_requirement": "project_requirements",
}
