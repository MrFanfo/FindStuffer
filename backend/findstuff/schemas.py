from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .network_security import validate_http_url


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class NaturalLanguageCommand(StrictModel):
    text: str = Field(min_length=1, max_length=2000)


class OfflineOperation(StrictModel):
    operation_id: str = Field(min_length=8, max_length=120)
    kind: Literal["create_item", "adjust_quantity"]
    payload: dict[str, Any]


class ShoppingEntryCreate(StrictModel):
    name: str = Field(min_length=1, max_length=240)
    item_public_id: str | None = None
    quantity: Decimal = Field(default=Decimal("1"), gt=0, decimal_places=3)
    unit: str = Field(default="pcs", min_length=1, max_length=24)


class ShoppingEntryCheck(StrictModel):
    checked: bool


class TagsUpdate(StrictModel):
    tags: list[str] = Field(max_length=50)
    expected_version: int = Field(ge=1)


class CategoryCreate(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: int | None = Field(default=None, ge=1)


class CategoryPatch(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    parent_id: int | None = Field(default=None, ge=1)


class CategoryDefaultLocationUpdate(StrictModel):
    location_public_id: str | None = None


class OffCategoryMappingUpdate(StrictModel):
    category_id: int | None = Field(default=None, ge=1)


class LocationTypeCreate(StrictModel):
    name: str = Field(min_length=1, max_length=40)
    icon: str = Field(default="pin", min_length=1, max_length=40)


class LocationRuleCreate(StrictModel):
    rule_type: Literal["name", "barcode", "category"] = "name"
    match_value: str = Field(min_length=1, max_length=240)
    location_public_id: str
    priority: int = Field(default=100, ge=0, le=10000)
    enabled: bool = True


class LocationRulePatch(StrictModel):
    rule_type: Literal["name", "barcode", "category"] | None = None
    match_value: str | None = Field(default=None, min_length=1, max_length=240)
    location_public_id: str | None = None
    priority: int | None = Field(default=None, ge=0, le=10000)
    enabled: bool | None = None


class LocationSuggestionQuery(StrictModel):
    name: str = Field(default="", max_length=240)
    barcode: str = Field(default="", max_length=80)
    category: str = Field(default="", max_length=120)


class ExternalPhotoCreate(StrictModel):
    url: str = Field(min_length=1, max_length=2000)
    source_label: str = Field(default="", max_length=240)

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        return validate_http_url(value)


class ItemDefaultLocationUpdate(StrictModel):
    location_public_id: str


class ItemRelationshipCreate(StrictModel):
    related_item_public_id: str
    relation_type: str = Field(default="related", min_length=1, max_length=40)
    note: str = Field(default="", max_length=1000)


class EnrichmentExportRequest(StrictModel):
    categories: list[str] = Field(default_factory=list, max_length=30)
    limit: int = Field(default=50, ge=1, le=250)
    include_photos: bool = True


class EnrichmentSuggestionAccept(StrictModel):
    value: Any | None = None
    edited: bool = False


class UnitSettingsUpdate(StrictModel):
    units: list[str] = Field(default_factory=list, min_length=1, max_length=80)


class CategoryDataSettingsUpdate(StrictModel):
    overrides: dict[str, dict[str, bool]] = Field(default_factory=dict)


class ProjectCreate(StrictModel):
    name: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=4000)


class ProjectStatusUpdate(StrictModel):
    status: Literal["active", "completed", "archived"]


class ReservationCreate(StrictModel):
    item_public_id: str
    quantity: Decimal = Field(gt=0, decimal_places=3)


class LoanCreate(StrictModel):
    item_public_id: str
    direction: Literal["lent", "borrowed"]
    person: str = Field(min_length=1, max_length=240)
    quantity: Decimal = Field(default=Decimal("1"), gt=0, decimal_places=3)
    due_date: date | None = None
    notes: str = Field(default="", max_length=4000)


class NotificationSettingsUpdate(StrictModel):
    enabled: bool
    ntfy_url: str = Field(default="", max_length=2000)
    ntfy_token: str = Field(default="", max_length=1000)
    expiration_days: int = Field(default=7, ge=0, le=365)
    notify_low_stock: bool = True
    notify_expiration: bool = True
    notify_warranty: bool = True


class DocumentPatch(StrictModel):
    title: str | None = Field(default=None, min_length=1, max_length=240)
    document_type: Literal[
        "receipt", "invoice", "manual", "certificate", "warranty", "other"
    ] | None = None
    purchase_date: date | None = None
    warranty_expires_at: date | None = None


class SearchAliasCreate(StrictModel):
    alias: str = Field(min_length=1, max_length=300)
    target_type: Literal["term", "item", "location"]
    replacement: str = Field(default="", max_length=300)
    target_public_id: str | None = Field(default=None, max_length=120)
    source: Literal["manual", "learned"] = "manual"


class AdminPasswordUpdate(StrictModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=10, max_length=256)


class AdminLogin(StrictModel):
    username: str = Field(min_length=1, max_length=256)
    password: str = Field(min_length=1, max_length=256)


class AISettingsUpdate(StrictModel):
    enabled: bool
    endpoint: str = Field(default="", max_length=2000)
    model: str = Field(default="", max_length=240)
    api_key: str = Field(default="", max_length=4000)
    clear_api_key: bool = False


class MQTTSettingsUpdate(StrictModel):
    enabled: bool
    host: str = Field(default="", max_length=253)
    port: int = Field(default=1883, ge=1, le=65535)
    username: str = Field(default="", max_length=240)
    password: str = Field(default="", max_length=4000)
    clear_password: bool = False
    base_topic: str = Field(default="findstuff", min_length=1, max_length=240)
    discovery_prefix: str = Field(default="homeassistant", min_length=1, max_length=240)
    client_id: str = Field(default="findstuff", min_length=1, max_length=240)
    publish_interval_seconds: int = Field(default=60, ge=15, le=86400)


class ImportMergeRequest(StrictModel):
    mode: Literal["merge"] = "merge"
    payload: dict[str, Any]


class LocationCreate(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str = Field(default="location", min_length=1, max_length=40)
    description: str = Field(default="", max_length=1000)
    parent_public_id: str | None = None


class LocationPatch(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: str | None = Field(default=None, min_length=1, max_length=40)
    description: str | None = Field(default=None, max_length=1000)
    parent_public_id: str | None = None


class ItemLink(StrictModel):
    label: str = Field(min_length=1, max_length=240)
    url: str = Field(min_length=1, max_length=2000)

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        return validate_http_url(value)


class AIScanProposalPatch(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=4000)
    notes: str | None = Field(default=None, max_length=8000)
    category_id: int | None = Field(default=None, ge=1)
    location_public_id: str | None = None
    quantity: Decimal | None = Field(default=None, ge=0, decimal_places=3)
    unit: str | None = Field(default=None, min_length=1, max_length=24)
    brand: str | None = Field(default=None, max_length=240)
    model: str | None = Field(default=None, max_length=240)
    serial_number: str | None = Field(default=None, max_length=240)
    barcode: str | None = Field(default=None, max_length=80)
    links: list[ItemLink] | None = Field(default=None, max_length=20)


class ItemBase(StrictModel):
    name: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=4000)
    notes: str = Field(default="", max_length=8000)
    category_id: int | None = None
    location_public_id: str = "unassigned"
    quantity: Decimal = Field(default=Decimal("1"), ge=0, decimal_places=3)
    unit: str = Field(default="pcs", min_length=1, max_length=24)
    purchase_price_minor: int | None = Field(default=None, ge=0)
    purchase_currency: str | None = None
    estimated_price_minor: int | None = Field(default=None, ge=0)
    estimated_price_currency: str | None = None
    weight_g: int | None = Field(default=None, ge=0)
    length_mm: int | None = Field(default=None, ge=0)
    width_mm: int | None = Field(default=None, ge=0)
    height_mm: int | None = Field(default=None, ge=0)
    serial_number: str = Field(default="", max_length=240)
    model: str = Field(default="", max_length=240)
    brand: str = Field(default="", max_length=240)
    expiration_date: date | None = None
    low_stock_threshold: Decimal | None = Field(default=None, ge=0, decimal_places=3)
    barcode: str = Field(default="", max_length=80)
    links: list[ItemLink] = Field(default_factory=list, max_length=20)

    @field_validator("purchase_currency", "estimated_price_currency")
    @classmethod
    def validate_currency(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        value = value.upper()
        if len(value) != 3 or not value.isalpha():
            raise ValueError("currency must be a three-letter code")
        return value


class ItemCreate(ItemBase):
    pass


class ItemPatch(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=4000)
    notes: str | None = Field(default=None, max_length=8000)
    category_id: int | None = None
    location_public_id: str | None = None
    quantity: Decimal | None = Field(default=None, ge=0, decimal_places=3)
    unit: str | None = Field(default=None, min_length=1, max_length=24)
    purchase_price_minor: int | None = Field(default=None, ge=0)
    purchase_currency: str | None = None
    estimated_price_minor: int | None = Field(default=None, ge=0)
    estimated_price_currency: str | None = None
    weight_g: int | None = Field(default=None, ge=0)
    length_mm: int | None = Field(default=None, ge=0)
    width_mm: int | None = Field(default=None, ge=0)
    height_mm: int | None = Field(default=None, ge=0)
    serial_number: str | None = Field(default=None, max_length=240)
    model: str | None = Field(default=None, max_length=240)
    brand: str | None = Field(default=None, max_length=240)
    expiration_date: date | None = None
    low_stock_threshold: Decimal | None = Field(default=None, ge=0, decimal_places=3)
    barcode: str | None = Field(default=None, max_length=80)
    links: list[ItemLink] | None = Field(default=None, max_length=20)
    expected_version: int = Field(ge=1)


class QuantityAdjustment(StrictModel):
    delta: Decimal = Field(decimal_places=3)
    expected_version: int = Field(ge=1)


class ItemMove(StrictModel):
    destination_public_id: str
    expected_version: int = Field(ge=1)


class ItemLotCreate(StrictModel):
    quantity: Decimal = Field(gt=0, decimal_places=3)
    expiration_date: date | None = None
    note: str = Field(default="", max_length=1000)


class ItemLotPatch(StrictModel):
    quantity: Decimal | None = Field(default=None, ge=0, decimal_places=3)
    expiration_date: date | None = None
    note: str | None = Field(default=None, max_length=1000)


class MaintenanceTaskCreate(StrictModel):
    title: str = Field(min_length=1, max_length=240)
    notes: str = Field(default="", max_length=4000)
    interval_days: int = Field(ge=1, le=3650)
    last_completed_at: date | None = None
    next_due_at: date


class MaintenanceTaskPatch(StrictModel):
    title: str | None = Field(default=None, min_length=1, max_length=240)
    notes: str | None = Field(default=None, max_length=4000)
    interval_days: int | None = Field(default=None, ge=1, le=3650)
    last_completed_at: date | None = None
    next_due_at: date | None = None
