from __future__ import annotations

import asyncio
import base64
import binascii
import contextlib
import html
import json
import logging
import os
import secrets
import shutil
import tempfile
import time
import zipfile
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from typing import Annotated, Any

import httpx
import segno
from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask
from starlette.middleware.gzip import GZipMiddleware

from . import __version__
from .ai_commands import confirm_command, get_command, parse_command, reject_command
from .ai_scans import (
    approve_scan,
    create_scan,
    get_scan,
    list_scans,
    process_scan,
    reject_scan,
    retry_scan,
    scan_photo_path,
    update_scan,
)
from .auth_config import (
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE_SECONDS,
    create_session_token,
    credentials_are_valid,
    get_admin_password,
    save_admin_password,
    session_token_is_valid,
)
from .backups import (
    apply_pending_restore,
    backup_archive,
    backup_if_due,
    backup_status,
    restore_status,
    stage_backup_restore,
)
from .barcodes import IMAGE_DECODE_LIMIT_BYTES, decode_image_code, lookup_barcode
from .config import get_settings
from .db import database_dependency, migrate, transaction
from .enrichment import (
    apply_candidate,
    clear_enrichment_history,
    get_full_product_data,
    list_enrichment,
    queue_enrichment,
    queue_missing_enrichment,
    run_pending,
)
from .extended import (
    add_shopping,
    apply_import_merge,
    check_shopping,
    create_loan,
    create_project,
    delete_project,
    duplicate_candidates,
    export_inventory,
    generate_low_stock_shopping,
    import_preview,
    list_import_batches,
    list_item_reservations,
    list_loans,
    list_projects,
    list_shopping,
    remove_reservation,
    reserve_item,
    return_loan,
    set_project_status,
    undo_import_batch,
)
from .homeassistant import (
    request_mqtt_reconfigure,
    run_home_assistant_mqtt,
    test_mqtt_connection,
)
from .inventory import (
    ConflictError,
    InventoryError,
    NotFoundError,
    add_item_relationship,
    adjust_quantity,
    archive_item,
    category_contents,
    category_data_settings,
    complete_maintenance_task,
    create_category,
    create_item,
    create_item_lot,
    create_location,
    create_location_rule,
    create_maintenance_task,
    dashboard,
    delete_category,
    delete_category_tree,
    delete_item_lot,
    delete_item_relationship,
    delete_location,
    delete_location_rule,
    delete_location_tree,
    ensure_location_type,
    expiring_items,
    get_item,
    get_location_row,
    hard_delete_item,
    item_history,
    list_categories,
    list_item_lots,
    list_item_relationships,
    list_items,
    list_location_rules,
    list_location_tree,
    list_location_types,
    list_maintenance_tasks,
    location_contents,
    move_item,
    restore_item,
    save_category_data_settings,
    serialize_location,
    set_category_default_location,
    set_item_default_location,
    set_item_tags,
    suggest_default_location,
    update_category,
    update_item,
    update_item_lot,
    update_location,
    update_location_rule,
)
from .metadata_enrichment import (
    accept_suggestion,
    create_export_request,
    import_response,
    list_suggestions,
    reject_suggestion,
)
from .notifications import (
    deliver_pending_notifications,
    public_notification_config,
    save_notification_config,
    send_test_notification,
)
from .off_categories import (
    export_mappings,
    import_mappings,
    items_for_category,
    list_mappings,
    set_mapping,
)
from .photos import delete_photo, get_photo, import_photo_from_url, list_photos, store_photo
from .schemas import (
    AdminLogin,
    AdminPasswordUpdate,
    AIScanProposalPatch,
    AISettingsUpdate,
    CategoryCreate,
    CategoryDataSettingsUpdate,
    CategoryDefaultLocationUpdate,
    CategoryPatch,
    EnrichmentExportRequest,
    EnrichmentSuggestionAccept,
    ExternalPhotoCreate,
    ImportMergeRequest,
    ItemCreate,
    ItemDefaultLocationUpdate,
    ItemLotCreate,
    ItemLotPatch,
    ItemMove,
    ItemPatch,
    ItemRelationshipCreate,
    LoanCreate,
    LocationCreate,
    LocationPatch,
    LocationRuleCreate,
    LocationRulePatch,
    LocationTypeCreate,
    MaintenanceTaskCreate,
    MQTTSettingsUpdate,
    NaturalLanguageCommand,
    NotificationSettingsUpdate,
    OffCategoryMappingUpdate,
    ProjectCreate,
    ProjectStatusUpdate,
    QuantityAdjustment,
    ReservationCreate,
    ShoppingEntryCheck,
    ShoppingEntryCreate,
    TagsUpdate,
    UnitSettingsUpdate,
)
from .service_config import (
    AIConnectionTestError,
    get_mqtt_config,
    public_ai_config,
    public_mqtt_config,
    save_ai_config,
    save_mqtt_config,
    test_ai_connection,
)
from .system_info import application_system_info
from .updater import request_software_update, software_update_status

logger = logging.getLogger(__name__)
MAX_REQUEST_BODY_BYTES = 12 * 1024 * 1024
MAX_BACKUP_RESTORE_BYTES = 20 * 1024 * 1024 * 1024


async def run_automatic_backups(settings: Any) -> None:
    while True:
        await asyncio.sleep(settings.backup_check_interval_seconds)
        await create_automatic_backup(settings)


async def create_automatic_backup(settings: Any) -> None:
    try:
        created = await asyncio.to_thread(
            backup_if_due,
            settings.backup_dir,
            keep=settings.backup_keep,
        )
        if created is not None:
            logger.info("Created automatic backup at %s", created)
    except Exception:
        logger.exception("Automatic backup failed")


@asynccontextmanager
async def lifespan(_: FastAPI):
    restore_result = apply_pending_restore()
    if restore_result is not None:
        logger.info("Pending backup restore result: %s", restore_result["status"])
    migrate()
    settings = get_settings()
    mqtt_task = asyncio.create_task(run_home_assistant_mqtt())
    if settings.auto_backup_enabled:
        await create_automatic_backup(settings)
    backup_task = (
        asyncio.create_task(run_automatic_backups(settings))
        if settings.auto_backup_enabled
        else None
    )
    try:
        yield
    finally:
        if backup_task:
            backup_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await backup_task
        mqtt_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await mqtt_task


app = FastAPI(
    title="Findstuff API",
    version=__version__,
    description="Lightweight home, lab, and grocery inventory API",
    lifespan=lifespan,
)
app.add_middleware(GZipMiddleware, minimum_size=1024)

Database = Annotated[Any, Depends(database_dependency)]


@app.middleware("http")
async def protect_api(request: Request, call_next):
    try:
        content_length = int(request.headers.get("content-length", "0"))
    except ValueError:
        content_length = 0
    request_limit = (
        MAX_BACKUP_RESTORE_BYTES
        if request.url.path == "/api/v1/admin/restore"
        else MAX_REQUEST_BODY_BYTES
    )
    if content_length > request_limit:
        return JSONResponse(
            status_code=413,
            content={
                "detail": (
                    "Backup exceeds the 20 GB restore limit"
                    if request_limit == MAX_BACKUP_RESTORE_BYTES
                    else "Request body exceeds the 12 MB limit"
                )
            },
        )
    path = request.url.path
    is_api = path.startswith("/api/v1/")
    if not is_api or path in {"/api/v1/health", "/api/v1/auth/login"}:
        return await call_next(request)
    settings = get_settings()
    admin_password = get_admin_password()
    if settings.require_auth and not admin_password:
        return JSONResponse(
            status_code=503,
            content={
                "detail": (
                    "Authentication is required but FINDSTUFF_ADMIN_PASSWORD "
                    "or FINDSTUFF_ADMIN_PASSWORD_FILE is not configured."
                )
            },
        )
    if is_api:
        request.state.user = {
            "id": 0,
            "is_admin": True,
            "public_id": "local",
            "username": settings.admin_username,
        }
        request.state.session = None
    if admin_password:
        authorization = request.headers.get("Authorization", "")
        authenticated = False
        used_basic_auth = authorization.startswith("Basic ")
        if authorization and used_basic_auth:
            try:
                decoded = base64.b64decode(
                    authorization.removeprefix("Basic ").strip(), validate=True
                ).decode("utf-8")
                username, password = decoded.split(":", 1)
                authenticated = credentials_are_valid(username, password)
            except (binascii.Error, UnicodeDecodeError, ValueError):
                authenticated = False
        elif not authorization:
            authenticated = session_token_is_valid(
                request.cookies.get(SESSION_COOKIE_NAME, "")
            )
        if not authenticated:
            return JSONResponse(
                status_code=401,
                content={"detail": "Authentication required"},
            )
        response = await call_next(request)
        if used_basic_auth:
            response.set_cookie(
                SESSION_COOKIE_NAME,
                create_session_token(),
                max_age=SESSION_MAX_AGE_SECONDS,
                httponly=True,
                secure=(
                    settings.secure_cookies
                    or request.url.scheme == "https"
                    or request.headers.get("x-forwarded-proto", "")
                    .split(",", 1)[0]
                    .strip()
                    == "https"
                ),
                samesite="strict",
                path="/api/v1",
            )
        return response
    return await call_next(request)


@app.exception_handler(InventoryError)
async def inventory_error_handler(request: Request, exc: InventoryError):
    return await http_exception_handler(
        request, HTTPException(status_code=exc.status_code, detail=str(exc))
    )


@app.get("/api/v1/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


def local_user() -> dict[str, Any]:
    return {
        "created_at": None,
        "id": 0,
        "is_admin": True,
        "public_id": "local",
        "username": "local",
    }


@app.get("/api/v1/auth/status", tags=["authentication"])
async def auth_status() -> dict[str, Any]:
    return {
        "authenticated": True,
        "user": local_user(),
    }


@app.post("/api/v1/auth/login", tags=["authentication"])
async def login(payload: AdminLogin, request: Request, response: Response) -> dict[str, Any]:
    settings = get_settings()
    if not credentials_are_valid(payload.username, payload.password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    response.set_cookie(
        SESSION_COOKIE_NAME,
        create_session_token(),
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=(
            settings.secure_cookies
            or request.url.scheme == "https"
            or request.headers.get("x-forwarded-proto", "").split(",", 1)[0].strip()
            == "https"
        ),
        samesite="strict",
        path="/api/v1",
    )
    return {
        "authenticated": True,
        "user": local_user(),
    }


@app.post("/api/v1/auth/logout", status_code=204, tags=["authentication"])
async def logout(response: Response) -> Response:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/api/v1")
    response.status_code = 204
    return response


@app.get("/api/v1/auth/me", tags=["authentication"])
async def get_me() -> dict[str, Any]:
    return local_user()


@app.post("/api/v1/admin/password", tags=["administration"])
async def change_admin_password(payload: AdminPasswordUpdate) -> dict[str, str]:
    try:
        save_admin_password(payload.current_password, payload.new_password)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "changed"}


@app.get("/api/v1/bootstrap", tags=["system"])
async def bootstrap(
    database: Database,
    q: str = "",
    include_zero: bool = False,
    limit: int = Query(default=100, ge=1, le=2000),
) -> dict[str, Any]:
    return {
        "auth": {"authenticated": True, "user": local_user()},
        "categories": list_categories(database),
        "dashboard": dashboard(database),
        "items": list_items(database, query=q, include_zero=include_zero, limit=limit),
        "location_types": list_location_types(database),
        "locations": list_location_tree(database),
        "units": inventory_units(database),
    }


@app.get("/api/v1/dashboard", tags=["dashboard"])
async def get_dashboard(database: Database) -> dict[str, Any]:
    return dashboard(database)


@app.get("/api/v1/dashboard/low-stock", tags=["dashboard"])
async def get_low_stock(database: Database) -> list[dict[str, Any]]:
    return list_items(database, low_stock=True, limit=250)


@app.get("/api/v1/dashboard/expiring", tags=["dashboard"])
async def get_expiring(
    database: Database, days: int = Query(default=14, ge=0, le=3650)
) -> list[dict[str, Any]]:
    return expiring_items(database, days)


@app.get("/api/v1/categories", tags=["metadata"])
async def get_categories(database: Database) -> list[dict[str, Any]]:
    return list_categories(database)


@app.post("/api/v1/categories", status_code=201, tags=["metadata"])
async def post_category(payload: CategoryCreate, database: Database) -> dict[str, Any]:
    return create_category(database, payload.name, payload.parent_id)


@app.patch("/api/v1/categories/{category_id}", tags=["metadata"])
async def patch_category(
    category_id: int, payload: CategoryPatch, database: Database
) -> dict[str, Any]:
    return update_category(database, category_id, payload.model_dump(exclude_unset=True))


@app.delete("/api/v1/categories/{category_id}", status_code=204, tags=["metadata"])
async def remove_category(category_id: int, database: Database) -> Response:
    delete_category(database, category_id)
    return Response(status_code=204)


@app.get("/api/v1/categories/{category_id}/contents", tags=["metadata"])
async def get_category_contents(
    category_id: int, database: Database, recursive: bool = True
) -> dict[str, Any]:
    return category_contents(database, category_id, recursive=recursive)


@app.put("/api/v1/categories/{category_id}/default-location", tags=["metadata"])
async def put_category_default_location(
    category_id: int, payload: CategoryDefaultLocationUpdate, database: Database
) -> dict[str, Any]:
    return set_category_default_location(database, category_id, payload.location_public_id)


@app.delete("/api/v1/categories/{category_id}/tree", status_code=204, tags=["metadata"])
async def remove_category_tree(category_id: int, database: Database) -> Response:
    delete_category_tree(database, category_id)
    return Response(status_code=204)


@app.get("/api/v1/location-types", tags=["metadata"])
async def get_location_types(database: Database) -> list[dict[str, Any]]:
    return list_location_types(database)


@app.post("/api/v1/location-types", status_code=201, tags=["metadata"])
async def post_location_type(payload: LocationTypeCreate, database: Database) -> dict[str, Any]:
    return ensure_location_type(database, payload.name, payload.icon)


@app.get("/api/v1/location-rules", tags=["metadata"])
async def get_location_rules(database: Database) -> list[dict[str, Any]]:
    return list_location_rules(database)


@app.post("/api/v1/location-rules", status_code=201, tags=["metadata"])
async def post_location_rule(payload: LocationRuleCreate, database: Database) -> dict[str, Any]:
    return create_location_rule(database, payload.model_dump())


@app.patch("/api/v1/location-rules/{public_id}", tags=["metadata"])
async def patch_location_rule(
    public_id: str, payload: LocationRulePatch, database: Database
) -> dict[str, Any]:
    return update_location_rule(database, public_id, payload.model_dump(exclude_unset=True))


@app.delete("/api/v1/location-rules/{public_id}", status_code=204, tags=["metadata"])
async def remove_location_rule(public_id: str, database: Database) -> Response:
    delete_location_rule(database, public_id)
    return Response(status_code=204)


@app.get("/api/v1/location-rules/suggest", tags=["metadata"])
async def suggest_location_rule(
    database: Database, name: str = "", barcode: str = "", category: str = ""
) -> dict[str, Any]:
    suggestion = suggest_default_location(database, name=name, barcode=barcode, category=category)
    return {"suggestion": suggestion}


@app.get("/api/v1/locations/tree", tags=["locations"])
async def get_location_tree(database: Database) -> list[dict[str, Any]]:
    return list_location_tree(database)


@app.post("/api/v1/locations", status_code=201, tags=["locations"])
async def post_location(payload: LocationCreate, database: Database) -> dict[str, Any]:
    return create_location(database, payload.model_dump())


@app.get("/api/v1/locations/{public_id}", tags=["locations"])
async def get_location(public_id: str, database: Database) -> dict[str, Any]:
    return serialize_location(database, get_location_row(database, public_id))


@app.get("/api/v1/locations/{public_id}/contents", tags=["locations"])
async def get_location_contents(
    public_id: str, database: Database, recursive: bool = True
) -> dict[str, Any]:
    return location_contents(database, public_id, recursive=recursive)


@app.patch("/api/v1/locations/{public_id}", tags=["locations"])
async def patch_location(
    public_id: str, payload: LocationPatch, database: Database
) -> dict[str, Any]:
    return update_location(database, public_id, payload.model_dump(exclude_unset=True))


@app.delete("/api/v1/locations/{public_id}", status_code=204, tags=["locations"])
async def remove_location(public_id: str, database: Database) -> Response:
    delete_location(database, public_id)
    return Response(status_code=204)


@app.delete("/api/v1/locations/{public_id}/tree", status_code=204, tags=["locations"])
async def remove_location_tree(public_id: str, database: Database) -> Response:
    delete_location_tree(database, public_id)
    return Response(status_code=204)


@app.get("/api/v1/items", tags=["items"])
async def get_items(
    database: Database,
    q: str = "",
    location: str | None = None,
    category_id: int | None = None,
    low_stock: bool = False,
    needs_details: bool = False,
    include_archived: bool = False,
    archived_only: bool = False,
    include_zero: bool = False,
    limit: int = Query(default=100, ge=1, le=2000),
) -> list[dict[str, Any]]:
    return list_items(
        database,
        query=q,
        location_public_id=location,
        category_id=category_id,
        low_stock=low_stock,
        needs_details=needs_details,
        include_archived=include_archived,
        archived_only=archived_only,
        include_zero=include_zero,
        limit=limit,
    )


@app.get("/api/v1/search", tags=["search"])
async def search_items(
    database: Database,
    q: str = Query(min_length=1, max_length=300),
    include_zero: bool = False,
    limit: int = Query(default=100, ge=1, le=250),
) -> dict[str, Any]:
    results = list_items(database, query=q, include_zero=include_zero, limit=limit)
    return {"query": q, "count": len(results), "items": results}


@app.post("/api/v1/items", status_code=201, tags=["items"])
async def post_item(payload: ItemCreate, database: Database) -> dict[str, Any]:
    return create_item(database, payload.model_dump())


@app.get("/api/v1/items/{public_id}", tags=["items"])
async def get_one_item(public_id: str, database: Database) -> dict[str, Any]:
    return get_item(database, public_id)


@app.get("/api/v1/items/{public_id}/detail", tags=["items"])
async def get_item_detail(public_id: str, database: Database) -> dict[str, Any]:
    return {
        "item": get_item(database, public_id),
        "history": item_history(database, public_id),
        "photos": list_photos(database, public_id),
        "enrichment": list_enrichment(database, public_id),
        "lots": list_item_lots(database, public_id),
        "maintenance": list_maintenance_tasks(database, public_id),
        "reservations": list_item_reservations(database, public_id),
        "related": list_item_relationships(database, public_id),
    }


@app.post("/api/v1/items/{public_id}/relationships", status_code=201, tags=["items"])
async def post_item_relationship(
    public_id: str, payload: ItemRelationshipCreate, database: Database
) -> dict[str, Any]:
    return add_item_relationship(
        database,
        public_id,
        payload.related_item_public_id,
        payload.relation_type,
        payload.note,
    )


@app.delete(
    "/api/v1/items/{public_id}/relationships/{relationship_public_id}",
    status_code=204,
    tags=["items"],
)
async def remove_item_relationship(
    public_id: str, relationship_public_id: str, database: Database
) -> Response:
    delete_item_relationship(database, public_id, relationship_public_id)
    return Response(status_code=204)


@app.patch("/api/v1/items/{public_id}", tags=["items"])
async def patch_item(public_id: str, payload: ItemPatch, database: Database) -> dict[str, Any]:
    return update_item(database, public_id, payload.model_dump(exclude_unset=True))


@app.delete("/api/v1/items/{public_id}", status_code=204, tags=["items"])
async def remove_item(public_id: str, database: Database) -> Response:
    archive_item(database, public_id)
    return Response(status_code=204)


@app.delete("/api/v1/items/{public_id}/permanent", status_code=204, tags=["items"])
async def permanently_remove_item(public_id: str, database: Database) -> Response:
    hard_delete_item(database, public_id)
    return Response(status_code=204)


@app.post("/api/v1/items/{public_id}/restore", tags=["items"])
async def unarchive_item(public_id: str, database: Database) -> dict[str, Any]:
    return restore_item(database, public_id)


@app.post("/api/v1/items/{public_id}/adjust-quantity", tags=["items"])
async def post_quantity_adjustment(
    public_id: str, payload: QuantityAdjustment, database: Database
) -> dict[str, Any]:
    return adjust_quantity(database, public_id, payload.delta, payload.expected_version)


@app.post("/api/v1/items/{public_id}/move", tags=["items"])
async def post_item_move(public_id: str, payload: ItemMove, database: Database) -> dict[str, Any]:
    return move_item(database, public_id, payload.destination_public_id, payload.expected_version)


@app.get("/api/v1/items/{public_id}/history", tags=["items"])
async def get_item_history(public_id: str, database: Database) -> list[dict[str, Any]]:
    return item_history(database, public_id)


@app.get("/api/v1/items/{public_id}/lots", tags=["items"])
async def get_item_lots(public_id: str, database: Database) -> list[dict[str, Any]]:
    return list_item_lots(database, public_id)


@app.post("/api/v1/items/{public_id}/lots", status_code=201, tags=["items"])
async def post_item_lot(
    public_id: str, payload: ItemLotCreate, database: Database
) -> dict[str, Any]:
    return create_item_lot(database, public_id, payload.model_dump())


@app.patch("/api/v1/items/{public_id}/lots/{lot_public_id}", tags=["items"])
async def patch_item_lot(
    public_id: str, lot_public_id: str, payload: ItemLotPatch, database: Database
) -> dict[str, Any]:
    return update_item_lot(
        database, public_id, lot_public_id, payload.model_dump(exclude_unset=True)
    )


@app.delete("/api/v1/items/{public_id}/lots/{lot_public_id}", status_code=204, tags=["items"])
async def remove_item_lot(public_id: str, lot_public_id: str, database: Database) -> Response:
    delete_item_lot(database, public_id, lot_public_id)
    return Response(status_code=204)


@app.get("/api/v1/items/{public_id}/maintenance", tags=["items"])
async def get_item_maintenance(public_id: str, database: Database) -> list[dict[str, Any]]:
    return list_maintenance_tasks(database, public_id)


@app.post("/api/v1/items/{public_id}/maintenance", status_code=201, tags=["items"])
async def post_item_maintenance(
    public_id: str, payload: MaintenanceTaskCreate, database: Database
) -> dict[str, Any]:
    return create_maintenance_task(database, public_id, payload.model_dump())


@app.post("/api/v1/items/{public_id}/maintenance/{task_public_id}/complete", tags=["items"])
async def complete_item_maintenance(
    public_id: str, task_public_id: str, database: Database
) -> dict[str, Any]:
    return complete_maintenance_task(database, public_id, task_public_id)


@app.put("/api/v1/items/{public_id}/tags", tags=["items"])
async def put_item_tags(public_id: str, payload: TagsUpdate, database: Database) -> dict[str, Any]:
    return set_item_tags(database, public_id, payload.tags, payload.expected_version)


@app.put("/api/v1/items/{public_id}/default-location", tags=["items"])
async def put_item_default_location(
    public_id: str, payload: ItemDefaultLocationUpdate, database: Database
) -> dict[str, Any]:
    return set_item_default_location(database, public_id, payload.location_public_id)


@app.get("/api/v1/items/{public_id}/photos", tags=["photos"])
async def get_item_photos(public_id: str, database: Database) -> list[dict[str, Any]]:
    return list_photos(database, public_id)


@app.post("/api/v1/items/{public_id}/photos", status_code=201, tags=["photos"])
async def post_item_photo(
    public_id: str,
    database: Database,
    file: Annotated[UploadFile, File()],
    width: Annotated[int | None, Form(ge=1)] = None,
    height: Annotated[int | None, Form(ge=1)] = None,
) -> dict[str, Any]:
    data = await file.read(5 * 1024 * 1024 + 1)
    try:
        return store_photo(
            database,
            public_id,
            data,
            file.content_type or "application/octet-stream",
            width,
            height,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/v1/items/{public_id}/photos/from-url", status_code=201, tags=["photos"])
async def post_item_photo_from_url(
    public_id: str, payload: ExternalPhotoCreate, database: Database
) -> dict[str, Any]:
    try:
        return await import_photo_from_url(database, public_id, payload.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/v1/photos/{public_id}/content", tags=["photos"])
async def get_photo_content(public_id: str, database: Database) -> FileResponse:
    photo = get_photo(database, public_id)
    base = get_settings().data_dir.resolve()
    path = (base / photo["file_path"]).resolve()
    if base not in path.parents or not path.is_file():
        raise HTTPException(status_code=404, detail="Photo file not found")
    return FileResponse(path, media_type=photo["mime_type"])


@app.delete("/api/v1/photos/{public_id}", status_code=204, tags=["photos"])
async def remove_photo(public_id: str, database: Database) -> Response:
    delete_photo(database, public_id)
    return Response(status_code=204)


def make_qr_svg(value: str) -> bytes:
    output = BytesIO()
    segno.make(value, error="m").save(output, kind="svg", scale=6, border=2, xmldecl=False)
    return output.getvalue()


@app.get("/api/v1/qr/items/{public_id}.svg", tags=["qr"])
async def item_qr(public_id: str, request: Request, database: Database) -> Response:
    get_item(database, public_id)
    target = f"{str(request.base_url).rstrip('/')}?item={public_id}"
    return Response(make_qr_svg(target), media_type="image/svg+xml")


@app.get("/api/v1/qr/locations/{public_id}.svg", tags=["qr"])
async def location_qr(public_id: str, request: Request, database: Database) -> Response:
    get_location_row(database, public_id)
    target = f"{str(request.base_url).rstrip('/')}?location={public_id}&mode=view"
    return Response(make_qr_svg(target), media_type="image/svg+xml")


@app.get("/api/v1/labels/items/{public_id}", response_class=HTMLResponse, tags=["qr"])
async def print_item_label(public_id: str, database: Database) -> str:
    item = get_item(database, public_id)
    item_name = html.escape(str(item["name"]))
    location_path = html.escape(str(item["location_path"]))
    safe_public_id = html.escape(public_id, quote=True)
    return f"""<!doctype html><meta charset='utf-8'><title>{item_name}</title>
    <style>body{{font:16px sans-serif}}.label{{width:60mm;border:1px solid;padding:4mm;
    text-align:center}}img{{width:38mm}}@media print{{button{{display:none}}}}</style>
    <button onclick='print()'>Print</button><div class='label'><img
    src='/api/v1/qr/items/{safe_public_id}.svg'><strong>{item_name}</strong><br>
    <small>{location_path}</small></div>"""


@app.get("/api/v1/labels/locations/{public_id}", response_class=HTMLResponse, tags=["qr"])
async def print_location_label(public_id: str, database: Database) -> str:
    location = serialize_location(database, get_location_row(database, public_id))
    location_name = html.escape(str(location["name"]))
    location_path = html.escape(str(location["path"]))
    safe_public_id = html.escape(public_id, quote=True)
    return f"""<!doctype html><meta charset='utf-8'><title>{location_name}</title>
    <style>body{{font:16px sans-serif}}.label{{width:60mm;border:1px solid;padding:4mm;
    text-align:center}}img{{width:38mm}}@media print{{button{{display:none}}}}</style>
    <button onclick='print()'>Print</button><div class='label'><img
    src='/api/v1/qr/locations/{safe_public_id}.svg'><strong>{location_name}</strong><br>
    <small>{location_path}</small></div>"""


@app.post("/api/v1/voice/transcribe", tags=["voice"])
async def transcribe_voice(file: Annotated[UploadFile, File()]) -> dict[str, str]:
    settings = get_settings()
    if not settings.stt_endpoint or not settings.stt_model:
        raise HTTPException(status_code=503, detail="External speech-to-text is not configured")
    audio = await file.read(10 * 1024 * 1024 + 1)
    if len(audio) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Audio exceeds the 10 MB limit")
    headers = {"Authorization": f"Bearer {settings.stt_api_key}"} if settings.stt_api_key else {}
    try:
        async with httpx.AsyncClient(timeout=60, headers=headers) as client:
            response = await client.post(
                settings.stt_endpoint,
                data={"model": settings.stt_model},
                files={"file": (file.filename or "voice.webm", audio, file.content_type)},
            )
            response.raise_for_status()
            text = response.json().get("text")
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Speech-to-text request failed") from exc
    if not isinstance(text, str) or not text.strip():
        raise HTTPException(status_code=502, detail="Speech-to-text returned no transcript")
    return {"text": text.strip()}


@app.get("/api/v1/barcodes/{code}/lookup", tags=["barcodes"])
async def get_barcode(code: str, database: Database) -> dict[str, Any]:
    try:
        return await lookup_barcode(database, code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/v1/barcodes/decode-image", tags=["barcodes"])
async def post_barcode_image(file: Annotated[UploadFile, File()]) -> dict[str, str]:
    data = await file.read(IMAGE_DECODE_LIMIT_BYTES + 1)
    try:
        return {"code": decode_image_code(data, file.content_type)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/v1/barcodes/{code}/refresh", tags=["barcodes"])
async def refresh_barcode(code: str, database: Database) -> dict[str, Any]:
    try:
        return await lookup_barcode(database, code, refresh=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/v1/commands/parse", tags=["ai"])
async def post_command(payload: NaturalLanguageCommand, database: Database) -> dict[str, Any]:
    try:
        return await parse_command(database, payload.text)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="AI provider request failed") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/v1/commands/{public_id}", tags=["ai"])
async def read_command(public_id: str, database: Database) -> dict[str, Any]:
    row = get_command(database, public_id)
    return {
        "public_id": row["public_id"],
        "raw_text": row["raw_text"],
        "status": row["status"],
        "proposal": json.loads(row["resolved_json"]) if row["resolved_json"] else None,
        "error": row["error"],
        "created_at": row["created_at"],
    }


@app.post("/api/v1/commands/{public_id}/confirm", tags=["ai"])
async def apply_command(public_id: str, database: Database) -> dict[str, Any]:
    return confirm_command(database, public_id)


@app.post("/api/v1/commands/{public_id}/reject", status_code=204, tags=["ai"])
async def decline_command(public_id: str, database: Database) -> Response:
    reject_command(database, public_id)
    return Response(status_code=204)


@app.post("/api/v1/ai-scans", status_code=202, tags=["ai"])
async def post_ai_scan(
    background_tasks: BackgroundTasks,
    database: Database,
    location_public_id: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    width: Annotated[int | None, Form()] = None,
    height: Annotated[int | None, Form()] = None,
) -> dict[str, Any]:
    data = await file.read(5 * 1024 * 1024 + 1)
    try:
        scan = create_scan(
            database,
            location_public_id=location_public_id,
            data=data,
            declared_type=file.content_type or "",
            width=width,
            height=height,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    background_tasks.add_task(process_scan, scan["public_id"])
    return scan


@app.get("/api/v1/ai-scans", tags=["ai"])
async def get_ai_scans(
    database: Database,
    status: str = Query(default="processing,pending,failed", max_length=120),
) -> list[dict[str, Any]]:
    return list_scans(
        database,
        {entry.strip() for entry in status.split(",") if entry.strip()},
    )


@app.get("/api/v1/ai-scans/{public_id}", tags=["ai"])
async def get_ai_scan(public_id: str, database: Database) -> dict[str, Any]:
    return get_scan(database, public_id)


@app.get("/api/v1/ai-scans/{public_id}/photo", tags=["ai"])
async def get_ai_scan_photo(public_id: str, database: Database) -> FileResponse:
    path, mime_type = scan_photo_path(database, public_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="AI scan photo not found")
    return FileResponse(path, media_type=mime_type)


@app.patch("/api/v1/ai-scans/{public_id}", tags=["ai"])
async def patch_ai_scan(
    public_id: str, payload: AIScanProposalPatch, database: Database
) -> dict[str, Any]:
    return update_scan(
        database,
        public_id,
        payload.model_dump(mode="json", exclude_unset=True),
    )


@app.post("/api/v1/ai-scans/{public_id}/approve", tags=["ai"])
async def approve_ai_scan(public_id: str, database: Database) -> dict[str, Any]:
    return approve_scan(database, public_id)


@app.post("/api/v1/ai-scans/{public_id}/reject", status_code=204, tags=["ai"])
async def reject_ai_scan(public_id: str, database: Database) -> Response:
    reject_scan(database, public_id)
    return Response(status_code=204)


@app.post("/api/v1/ai-scans/{public_id}/retry", status_code=202, tags=["ai"])
async def retry_ai_scan(
    public_id: str,
    background_tasks: BackgroundTasks,
    database: Database,
) -> dict[str, Any]:
    scan = retry_scan(database, public_id)
    background_tasks.add_task(process_scan, public_id)
    return scan


@app.get("/api/v1/shopping-list", tags=["shopping"])
async def get_shopping_list(database: Database) -> list[dict[str, Any]]:
    return list_shopping(database)


@app.post("/api/v1/shopping-list", status_code=201, tags=["shopping"])
async def post_shopping_entry(payload: ShoppingEntryCreate, database: Database) -> dict[str, Any]:
    return add_shopping(
        database,
        payload.name,
        payload.quantity,
        payload.unit,
        payload.item_public_id,
    )


@app.post("/api/v1/shopping-list/generate-low-stock", tags=["shopping"])
async def generate_shopping(database: Database) -> dict[str, int]:
    return {"created": generate_low_stock_shopping(database)}


@app.patch("/api/v1/shopping-list/{public_id}", status_code=204, tags=["shopping"])
async def patch_shopping_entry(
    public_id: str, payload: ShoppingEntryCheck, database: Database
) -> Response:
    check_shopping(database, public_id, payload.checked)
    return Response(status_code=204)


@app.get("/api/v1/items/{public_id}/duplicates", tags=["items"])
async def get_duplicates(public_id: str, database: Database) -> list[dict[str, Any]]:
    return duplicate_candidates(database, public_id)


@app.get("/api/v1/owned", tags=["search"])
async def already_owned(
    database: Database, q: str = Query(min_length=1, max_length=300)
) -> dict[str, Any]:
    matches = list_items(database, query=q, limit=50)
    return {"query": q, "owned": bool(matches), "items": matches}


@app.post("/api/v1/projects", status_code=201, tags=["projects"])
async def post_project(payload: ProjectCreate, database: Database) -> dict[str, Any]:
    return create_project(database, payload.name, payload.description)


@app.get("/api/v1/projects", tags=["projects"])
async def get_projects(database: Database) -> list[dict[str, Any]]:
    return list_projects(database)


@app.patch("/api/v1/projects/{public_id}", tags=["projects"])
async def patch_project(
    public_id: str, payload: ProjectStatusUpdate, database: Database
) -> dict[str, Any]:
    return set_project_status(database, public_id, payload.status)


@app.delete("/api/v1/projects/{public_id}", status_code=204, tags=["projects"])
async def remove_project(public_id: str, database: Database) -> Response:
    delete_project(database, public_id)
    return Response(status_code=204)


@app.post("/api/v1/projects/{public_id}/reservations", status_code=204, tags=["projects"])
async def post_reservation(
    public_id: str, payload: ReservationCreate, database: Database
) -> Response:
    reserve_item(database, public_id, payload.item_public_id, payload.quantity)
    return Response(status_code=204)


@app.delete(
    "/api/v1/projects/{public_id}/reservations/{item_public_id}",
    status_code=204,
    tags=["projects"],
)
async def delete_reservation(public_id: str, item_public_id: str, database: Database) -> Response:
    remove_reservation(database, public_id, item_public_id)
    return Response(status_code=204)


@app.post("/api/v1/loans", status_code=201, tags=["loans"])
async def post_loan(payload: LoanCreate, database: Database) -> dict[str, Any]:
    return create_loan(
        database,
        payload.item_public_id,
        payload.direction,
        payload.person,
        payload.quantity,
        payload.due_date,
        payload.notes,
    )


@app.get("/api/v1/loans", tags=["loans"])
async def get_loans(database: Database, include_returned: bool = True) -> list[dict[str, Any]]:
    return list_loans(database, include_returned=include_returned)


@app.post("/api/v1/loans/{public_id}/return", status_code=204, tags=["loans"])
async def post_loan_return(public_id: str, database: Database) -> Response:
    return_loan(database, public_id)
    return Response(status_code=204)


@app.get("/api/v1/admin/export", tags=["administration"])
async def download_export(database: Database) -> JSONResponse:
    return JSONResponse(
        export_inventory(database),
        headers={"Content-Disposition": "attachment; filename=findstuff-export.json"},
    )


@app.get("/api/v1/admin/backup", tags=["administration"])
async def download_backup() -> FileResponse:
    settings = get_settings()
    downloads_dir = settings.data_dir / "backups" / ".downloads"
    downloads_dir.mkdir(parents=True, exist_ok=True)
    temporary_dir = Path(tempfile.mkdtemp(prefix="download-", dir=downloads_dir))
    archive_path = backup_archive(temporary_dir)
    return FileResponse(
        archive_path,
        media_type="application/zip",
        filename=archive_path.name,
        background=BackgroundTask(shutil.rmtree, temporary_dir, ignore_errors=True),
    )


def queue_process_restart() -> None:
    time.sleep(0.8)
    os._exit(0)


@app.get("/api/v1/admin/restore", tags=["administration"])
async def get_restore_status() -> dict[str, Any]:
    return restore_status()


@app.post("/api/v1/admin/restore", status_code=202, tags=["administration"])
async def upload_backup_restore(
    request: Request,
    background_tasks: BackgroundTasks,
    filename: str = Query(default="findstuff-backup.zip", max_length=240),
) -> dict[str, Any]:
    settings = get_settings()
    uploads_dir = settings.data_dir / ".restore" / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    temporary_path = uploads_dir / f"{secrets.token_hex(16)}.zip"
    size = 0
    try:
        with temporary_path.open("wb") as destination:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_BACKUP_RESTORE_BYTES:
                    raise ValueError("Backup exceeds the 20 GB restore limit")
                destination.write(chunk)
        if size == 0:
            raise ValueError("Backup file is empty")
        result = stage_backup_restore(temporary_path, filename)
    except (ValueError, zipfile.BadZipFile) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        temporary_path.unlink(missing_ok=True)
    background_tasks.add_task(queue_process_restart)
    return {
        **result,
        "message": (
            "Backup validated. Findstuff is restarting to apply it. "
            "A pre-restore safety backup will be kept automatically."
        ),
    }


@app.post("/api/v1/admin/import-preview", tags=["administration"])
async def preview_import(payload: dict[str, Any], database: Database) -> dict[str, Any]:
    try:
        return import_preview(payload, database)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/v1/admin/import", tags=["administration"])
async def apply_import(request: ImportMergeRequest, database: Database) -> dict[str, Any]:
    try:
        return apply_import_merge(database, request.payload)
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/v1/admin/imports", tags=["administration"])
async def get_import_batches(database: Database) -> list[dict[str, Any]]:
    return list_import_batches(database)


@app.post("/api/v1/admin/imports/{public_id}/undo", tags=["administration"])
async def post_import_undo(public_id: str, database: Database) -> dict[str, Any]:
    try:
        return undo_import_batch(database, public_id)
    except (ConflictError, InventoryError, NotFoundError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


DEFAULT_UNITS = [
    "pcs",
    "box",
    "pack",
    "bag",
    "tin",
    "spool",
    "g",
    "kg",
    "ml",
    "l",
    "m",
    "cm",
    "mm",
    "roll",
    "pair",
    "set",
]


def inventory_units(database: Database) -> list[str]:
    row = database.execute(
        "SELECT value_json FROM app_settings WHERE key = 'inventory_units'"
    ).fetchone()
    if row is None:
        return DEFAULT_UNITS
    try:
        stored = json.loads(row["value_json"])
    except json.JSONDecodeError:
        return DEFAULT_UNITS
    if not isinstance(stored, list):
        return DEFAULT_UNITS
    cleaned = [str(unit).strip() for unit in stored if isinstance(unit, str) and str(unit).strip()]
    return list(dict.fromkeys([*DEFAULT_UNITS, *cleaned]))[:80]


def save_inventory_units(database: Database, units: list[str]) -> list[str]:
    cleaned = [unit.strip() for unit in units if unit.strip() and len(unit.strip()) <= 24]
    merged = list(dict.fromkeys([*DEFAULT_UNITS, *cleaned]))[:80]
    with transaction(database):
        database.execute(
            """
            INSERT INTO app_settings(key, value_json)
            VALUES ('inventory_units', ?)
            ON CONFLICT(key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (json.dumps(merged, separators=(",", ":")),),
        )
    return merged


@app.get("/api/v1/settings", tags=["settings"])
async def get_application_settings(database: Database) -> dict[str, Any]:
    runtime = get_settings()
    return {
        "notifications": public_notification_config(database),
        "units": inventory_units(database),
        "category_data": category_data_settings(database),
        "system": application_system_info(database, runtime),
        "setup": {
            "authentication": {
                "required": runtime.require_auth,
                "configured": bool(get_admin_password()),
            },
            "backup": backup_status(runtime.backup_dir),
        },
        "integrations": {
            "ai": public_ai_config(database),
            "stt_configured": bool(runtime.stt_endpoint and runtime.stt_model),
            "open_food_facts": True,
            "mqtt": public_mqtt_config(database),
        },
    }


@app.get("/api/v1/admin/software-update", tags=["administration"])
async def get_software_update_status() -> dict[str, Any]:
    status = software_update_status()
    status["enabled"] = get_settings().software_update_enabled
    return status


@app.post("/api/v1/admin/software-update", tags=["administration"])
async def post_software_update() -> dict[str, Any]:
    if not get_settings().software_update_enabled:
        raise HTTPException(
            status_code=409,
            detail=(
                "In-app updates are disabled for this installation. "
                "Run ./update-docker.sh on the Docker host."
            ),
        )
    return request_software_update()


@app.get("/api/v1/settings/units", tags=["settings"])
async def get_units(database: Database) -> dict[str, list[str]]:
    return {"units": inventory_units(database)}


@app.put("/api/v1/settings/units", tags=["settings"])
async def put_units(payload: UnitSettingsUpdate, database: Database) -> dict[str, list[str]]:
    return {"units": save_inventory_units(database, payload.units)}


@app.put("/api/v1/settings/category-data", tags=["settings"])
async def put_category_data_settings(
    payload: CategoryDataSettingsUpdate, database: Database
) -> dict[str, Any]:
    return save_category_data_settings(database, payload.overrides)


@app.get("/api/v1/settings/open-food-facts/category-mappings", tags=["settings"])
async def get_off_category_mappings(database: Database) -> dict[str, Any]:
    return list_mappings(database)


@app.put("/api/v1/settings/open-food-facts/category-mappings/{off_tag}", tags=["settings"])
async def put_off_category_mapping(
    off_tag: str, payload: OffCategoryMappingUpdate, database: Database
) -> dict[str, Any]:
    return set_mapping(database, off_tag, payload.category_id)


@app.get("/api/v1/settings/open-food-facts/category-mappings/{off_tag}/items", tags=["settings"])
async def get_off_category_mapping_items(off_tag: str, database: Database) -> list[dict[str, Any]]:
    return items_for_category(database, off_tag)


@app.get("/api/v1/settings/open-food-facts/category-mappings-export", tags=["settings"])
async def get_off_category_mappings_export(database: Database) -> dict[str, Any]:
    return export_mappings(database)


@app.post("/api/v1/settings/open-food-facts/category-mappings-import", tags=["settings"])
async def post_off_category_mappings_import(
    payload: dict[str, Any], database: Database, apply: bool = False
) -> dict[str, Any]:
    return import_mappings(database, payload, apply=apply)


@app.put("/api/v1/settings/ai", tags=["settings"])
async def put_ai_settings(
    payload: AISettingsUpdate, database: Database
) -> dict[str, Any]:
    try:
        return save_ai_config(database, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/v1/settings/ai/test", tags=["settings"])
async def test_ai_settings(database: Database) -> dict[str, Any]:
    try:
        return await test_ai_connection(database)
    except AIConnectionTestError as exc:
        return JSONResponse(
            status_code=502,
            content={"detail": str(exc), "diagnostic": exc.diagnostic},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not connect to the AI provider") from exc


@app.put("/api/v1/settings/mqtt", tags=["settings"])
async def put_mqtt_settings(
    payload: MQTTSettingsUpdate, database: Database
) -> dict[str, Any]:
    try:
        result = save_mqtt_config(database, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    request_mqtt_reconfigure()
    return result


@app.post("/api/v1/settings/mqtt/test", status_code=204, tags=["settings"])
async def test_mqtt_settings(database: Database) -> Response:
    try:
        await test_mqtt_connection(get_mqtt_config(database))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("MQTT connection test failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not connect to the MQTT broker") from exc
    return Response(status_code=204)


@app.put("/api/v1/settings/notifications", tags=["settings"])
async def put_notification_settings(
    payload: NotificationSettingsUpdate, database: Database
) -> dict[str, Any]:
    try:
        return save_notification_config(database, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/v1/notifications/test", status_code=204, tags=["notifications"])
async def test_notification(database: Database) -> Response:
    try:
        await send_test_notification(database)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Notification delivery failed") from exc
    return Response(status_code=204)


@app.post("/api/v1/notifications/run", tags=["notifications"])
async def run_notifications(database: Database) -> dict[str, int | str]:
    return await deliver_pending_notifications(database)


@app.post("/api/v1/items/{public_id}/enrichment-jobs", status_code=202, tags=["enrichment"])
async def post_enrichment_job(
    public_id: str, database: Database, refresh: bool = False
) -> dict[str, Any]:
    return queue_enrichment(database, public_id, refresh=refresh)


@app.get("/api/v1/items/{public_id}/enrichment", tags=["enrichment"])
async def get_enrichment(public_id: str, database: Database) -> dict[str, Any]:
    return list_enrichment(database, public_id)


@app.get("/api/v1/items/{public_id}/enrichment/full", tags=["enrichment"])
async def get_full_enrichment(public_id: str, database: Database) -> dict[str, Any]:
    return get_full_product_data(database, public_id)


@app.delete("/api/v1/items/{public_id}/enrichment", status_code=204, tags=["enrichment"])
async def delete_enrichment_history(public_id: str, database: Database) -> Response:
    clear_enrichment_history(database, public_id)
    return Response(status_code=204)


@app.post("/api/v1/enrichment/run", tags=["enrichment"])
async def run_enrichment(database: Database) -> dict[str, int]:
    return {"processed": await run_pending(database, limit=3)}


@app.post("/api/v1/enrichment/queue-missing", tags=["enrichment"])
async def queue_missing(
    database: Database,
    limit: int = Query(default=25, ge=1, le=250),
) -> dict[str, int]:
    return {"queued": queue_missing_enrichment(database, limit=limit)}


@app.post("/api/v1/enrichment/exports", tags=["enrichment"])
async def post_enrichment_export(
    payload: EnrichmentExportRequest, database: Database
) -> dict[str, Any]:
    return create_export_request(
        database,
        categories=payload.categories,
        limit=payload.limit,
        include_photos=payload.include_photos,
    )


@app.post("/api/v1/enrichment/imports", tags=["enrichment"])
async def post_enrichment_import(payload: dict[str, Any], database: Database) -> dict[str, Any]:
    try:
        return import_response(database, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/v1/enrichment/suggestions", tags=["enrichment"])
async def get_enrichment_suggestions(
    database: Database,
    status: str = Query(
        default="pending",
        pattern="^(pending|unsafe|auto_accepted|accepted|rejected|edited|all)$",
    ),
) -> list[dict[str, Any]]:
    return list_suggestions(database, status=status)


@app.post("/api/v1/enrichment/suggestions/{public_id}/accept", tags=["enrichment"])
async def post_accept_suggestion(
    public_id: str, payload: EnrichmentSuggestionAccept, database: Database
) -> dict[str, Any]:
    return accept_suggestion(
        database,
        public_id,
        edited_value=payload.value if payload.edited else None,
    )


@app.post("/api/v1/enrichment/suggestions/{public_id}/reject", status_code=204, tags=["enrichment"])
async def post_reject_suggestion(public_id: str, database: Database) -> Response:
    reject_suggestion(database, public_id)
    return Response(status_code=204)


@app.post("/api/v1/enrichment-candidates/{public_id}/apply", tags=["enrichment"])
async def post_enrichment_candidate(public_id: str, database: Database) -> dict[str, Any]:
    return apply_candidate(database, public_id)


settings = get_settings()
if (settings.frontend_dist / "assets").is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=settings.frontend_dist / "assets"),
        name="assets",
    )


@app.get("/{path:path}", include_in_schema=False, response_model=None)
async def frontend(path: str) -> Any:
    if path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    frontend_root = settings.frontend_dist.resolve()
    requested_file = (frontend_root / path).resolve()
    if requested_file.is_file() and frontend_root in requested_file.parents:
        headers = {}
        if requested_file.name in {"index.html", "sw.js", "manifest.webmanifest"}:
            headers["Cache-Control"] = "no-cache"
        return FileResponse(requested_file, headers=headers)
    index = settings.frontend_dist / "index.html"
    if index.is_file():
        return HTMLResponse(
            index.read_text(encoding="utf-8"),
            headers={"Cache-Control": "no-cache"},
        )
    return {
        "message": "Findstuff API is running. Start the Vite dev server or build the frontend.",
        "docs": "/docs",
    }
