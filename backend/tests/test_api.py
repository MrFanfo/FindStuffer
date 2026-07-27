from __future__ import annotations

import asyncio
import importlib
from pathlib import Path

import httpx


def test_api_inventory_flow(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FINDSTUFF_DATABASE_PATH", str(tmp_path / "api.sqlite3"))
    monkeypatch.setenv("FINDSTUFF_AUTO_BACKUP_ENABLED", "false")

    import findstuff.app as app_module

    app_module = importlib.reload(app_module)

    async def scenario() -> None:
        transport = httpx.ASGITransport(app=app_module.app)
        async with app_module.app.router.lifespan_context(app_module.app):
            async with httpx.AsyncClient(
                transport=transport, base_url="http://testserver"
            ) as client:
                assert (await client.get("/api/v1/health")).json()["status"] == "ok"
                status = (await client.get("/api/v1/auth/status")).json()
                assert status["authenticated"] is True

                location_response = await client.post(
                    "/api/v1/locations",
                    json={"name": "Workshop", "kind": "room", "parent_public_id": None},
                )
                assert location_response.status_code == 201
                location = location_response.json()

                item_response = await client.post(
                    "/api/v1/items",
                    json={
                        "name": "Soldering iron",
                        "description": "Temperature controlled",
                        "quantity": "1",
                        "unit": "pcs",
                        "location_public_id": location["public_id"],
                    },
                )
                assert item_response.status_code == 201
                item = item_response.json()
                assert item["location_path"] == "Workshop"
                related_response = await client.post(
                    "/api/v1/items",
                    json={
                        "name": "Dremel bit set",
                        "quantity": "1",
                        "unit": "pcs",
                        "location_public_id": location["public_id"],
                    },
                )
                assert related_response.status_code == 201
                related_item = related_response.json()
                relationship = await client.post(
                    f"/api/v1/items/{item['public_id']}/relationships",
                    json={"related_item_public_id": related_item["public_id"]},
                )
                assert relationship.status_code == 201
                assert relationship.json()["public_id"] == related_item["public_id"]

                search = (await client.get("/api/v1/search", params={"q": "temperature"})).json()
                assert search["count"] == 1
                assert search["items"][0]["public_id"] == item["public_id"]

                adjustment = await client.post(
                    f"/api/v1/items/{item['public_id']}/adjust-quantity",
                    json={"delta": "2", "expected_version": item["version"]},
                )
                assert adjustment.status_code == 200
                assert adjustment.json()["quantity"] == "3"

                photo = await client.post(
                    f"/api/v1/items/{item['public_id']}/photos",
                    files={"file": ("item.jpg", b"\xff\xd8\xfftiny", "image/jpeg")},
                )
                assert photo.status_code == 201
                detail = (await client.get(f"/api/v1/items/{item['public_id']}/detail")).json()
                assert detail["item"]["public_id"] == item["public_id"]
                assert len(detail["photos"]) == 1
                assert detail["related"][0]["public_id"] == related_item["public_id"]
                reverse_detail = (
                    await client.get(f"/api/v1/items/{related_item['public_id']}/detail")
                ).json()
                assert reverse_detail["related"][0]["public_id"] == item["public_id"]
                assert detail["history"][0]["action"] == "adjust_quantity"
                assert detail["lots"]
                bootstrap = (await client.get("/api/v1/bootstrap")).json()
                assert {"auth", "dashboard", "items", "locations", "units"} <= set(bootstrap)
                assert item["public_id"] in {entry["public_id"] for entry in bootstrap["items"]}
                qr = await client.get(f"/api/v1/qr/items/{item['public_id']}.svg")
                assert qr.status_code == 200
                assert b"<svg" in qr.content

                project = await client.post(
                    "/api/v1/projects",
                    json={"name": "Bench supply", "description": "Build a PSU"},
                )
                assert project.status_code == 201
                projects = (await client.get("/api/v1/projects")).json()
                assert projects[0]["name"] == "Bench supply"

                loan = await client.post(
                    "/api/v1/loans",
                    json={
                        "item_public_id": item["public_id"],
                        "direction": "lent",
                        "person": "Grace",
                        "quantity": "1",
                        "notes": "",
                    },
                )
                assert loan.status_code == 201
                returned = await client.post(
                    f"/api/v1/loans/{loan.json()['public_id']}/return",
                )
                assert returned.status_code == 204

                settings = (await client.get("/api/v1/settings")).json()
                assert settings["notifications"]["enabled"] is False
                assert "shopping_list" in settings["category_data"]["fields"]
                assert settings["system"]["storage"]["database_bytes"] > 0
                assert settings["system"]["storage"]["photos_bytes"] > 0
                assert settings["system"]["resources"]["memory_rss_bytes"] > 0
                assert settings["system"]["inventory"]["items"] == 2
                assert settings["system"]["inventory"]["photos"] == 1
                categories = (await client.get("/api/v1/categories")).json()
                groceries = next(
                    category for category in categories if category["slug"] == "groceries"
                )
                mapping = await client.put(
                    "/api/v1/settings/open-food-facts/category-mappings/en%3Apecan-nuts",
                    json={"category_id": groceries["id"]},
                )
                assert mapping.status_code == 200
                assert mapping.json()["explicit_category"]["id"] == groceries["id"]
                mapping_export = (
                    await client.get("/api/v1/settings/open-food-facts/category-mappings-export")
                ).json()
                assert mapping_export["format"] == "findstuff.off-category-mappings.v1"
                mapping_preview = await client.post(
                    "/api/v1/settings/open-food-facts/category-mappings-import",
                    json=mapping_export,
                )
                assert mapping_preview.status_code == 200
                assert mapping_preview.json()["errors"] == 0
                notices = await client.post("/api/v1/notifications/run")
                assert notices.json()["status"] == "disabled"

                dashboard = (await client.get("/api/v1/dashboard")).json()
                assert dashboard["item_count"] == 2
                assert dashboard["location_count"] == 2

    asyncio.run(scenario())

def test_required_basic_auth(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FINDSTUFF_DATABASE_PATH", str(tmp_path / "auth.sqlite3"))
    monkeypatch.setenv("FINDSTUFF_AUTO_BACKUP_ENABLED", "false")
    monkeypatch.setenv("FINDSTUFF_REQUIRE_AUTH", "true")
    monkeypatch.setenv("FINDSTUFF_ADMIN_USERNAME", "owner")
    monkeypatch.setenv("FINDSTUFF_ADMIN_PASSWORD", "correct horse battery staple")

    import findstuff.app as app_module

    app_module = importlib.reload(app_module)

    async def scenario() -> None:
        transport = httpx.ASGITransport(app=app_module.app)
        async with app_module.app.router.lifespan_context(app_module.app):
            async with httpx.AsyncClient(
                transport=transport, base_url="http://testserver"
            ) as client:
                assert (await client.get("/api/v1/health")).status_code == 200
                denied = await client.get("/api/v1/dashboard")
                assert denied.status_code == 401
                assert denied.headers["www-authenticate"].startswith("Basic ")
                assert (await client.get("/")).status_code == 401
                allowed = await client.get(
                    "/api/v1/dashboard", auth=("owner", "correct horse battery staple")
                )
                assert allowed.status_code == 200
                assert (
                    await client.get("/", auth=("owner", "correct horse battery staple"))
                ).status_code == 200
                assert (
                    await client.get(
                        "/api/v1/dashboard",
                        headers={"Authorization": "Bearer obsolete-rest-token"},
                    )
                ).status_code == 401

    asyncio.run(scenario())


def test_request_body_limit_rejects_large_json(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FINDSTUFF_DATABASE_PATH", str(tmp_path / "body-limit.sqlite3"))
    monkeypatch.setenv("FINDSTUFF_AUTO_BACKUP_ENABLED", "false")

    import findstuff.app as app_module

    app_module = importlib.reload(app_module)

    async def scenario() -> None:
        transport = httpx.ASGITransport(app=app_module.app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            response = await client.post(
                "/api/v1/import/preview",
                content=b"x" * (app_module.MAX_REQUEST_BODY_BYTES + 1),
                headers={"content-type": "application/json"},
            )
            assert response.status_code == 413
            assert "12 MB" in response.json()["detail"]

    asyncio.run(scenario())
