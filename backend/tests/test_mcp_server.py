from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from findstuff.mcp_server import FindStuffMCPServer


def _tool(server: FindStuffMCPServer, name: str, arguments: dict[str, Any]) -> Any:
    response = server.handle_message(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }
    )
    assert response is not None
    result = response["result"]
    assert not result.get("isError"), result["content"][0]["text"]
    return json.loads(result["content"][0]["text"])


def test_mcp_server_exposes_inventory_tools(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    server = FindStuffMCPServer(tmp_path / "mcp.sqlite3")
    try:
        initialize = server.handle_message(
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}
        )
        assert initialize is not None
        assert initialize["result"]["serverInfo"]["name"] == "findstuff"

        tools = server.handle_message({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        assert tools is not None
        tool_names = {tool["name"] for tool in tools["result"]["tools"]}
        assert {
            "findstuff_search_items",
            "findstuff_create_item",
            "findstuff_create_relationship",
            "findstuff_set_item_metadata",
            "findstuff_enrich_items",
        } <= tool_names

        location = _tool(
            server,
            "findstuff_create_location",
            {"name": "MCP shelf", "kind": "shelf"},
        )
        item = _tool(
            server,
            "findstuff_create_item",
            {
                "values": {
                    "name": "MCP caliper",
                    "quantity": "1",
                    "unit": "pcs",
                    "location_public_id": location["public_id"],
                }
            },
        )
        accessory = _tool(
            server,
            "findstuff_create_item",
            {
                "values": {
                    "name": "Spare jaws",
                    "quantity": "1",
                    "unit": "pcs",
                    "location_public_id": location["public_id"],
                }
            },
        )
        relationship = _tool(
            server,
            "findstuff_create_relationship",
            {
                "public_id": item["public_id"],
                "related_item_public_id": accessory["public_id"],
                "relation_type": "accessory",
            },
        )
        assert relationship["relationship_type"] == "accessory"

        metadata = _tool(
            server,
            "findstuff_set_item_metadata",
            {
                "public_id": item["public_id"],
                "path": "/metadata/tools/material",
                "value": "stainless steel",
            },
        )
        assert metadata["value"] == "stainless steel"

        enrichment = _tool(
            server,
            "findstuff_enrich_items",
            {
                "items": [
                    {
                        "public_id": item["public_id"],
                        "metadata": [
                            {
                                "path": "/metadata/tools/manual_url",
                                "value": "https://example.com/caliper-manual.pdf",
                                "confidence": 0.92,
                                "sources": [
                                    {
                                        "source_type": "web",
                                        "label": "Example manual",
                                        "url": "https://example.com/caliper-manual.pdf",
                                    }
                                ],
                            }
                        ],
                        "links": [
                            {
                                "label": "User manual",
                                "url": "https://example.com/caliper-manual.pdf",
                            }
                        ],
                        "updates": {"brand": "Mitutoyo", "model": "500-196-30"},
                    }
                ]
            },
        )
        assert enrichment["updated_count"] == 1
        assert enrichment["results"][0]["metadata"][0]["value"] == (
            "https://example.com/caliper-manual.pdf"
        )
        assert enrichment["results"][0]["links_added"] == 1

        detail = _tool(server, "findstuff_get_item_detail", {"public_id": item["public_id"]})
        assert detail["item"]["name"] == "MCP caliper"
        assert detail["item"]["brand"] == "Mitutoyo"
        assert detail["item"]["model"] == "500-196-30"
        assert detail["item"]["links"] == [
            {"label": "User manual", "url": "https://example.com/caliper-manual.pdf"}
        ]
        assert detail["related"][0]["public_id"] == accessory["public_id"]

        search = _tool(server, "findstuff_search_items", {"query": "caliper"})
        assert [result["public_id"] for result in search] == [item["public_id"]]
    finally:
        server.close()


def test_mcp_photo_upload_and_core_actions(tmp_path: Path, monkeypatch) -> None:
    import base64

    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    server = FindStuffMCPServer(tmp_path / "mcp.sqlite3")
    try:
        location = _tool(server, "findstuff_create_location", {"name": "Shelf"})
        item = _tool(
            server,
            "findstuff_create_item",
            {"values": {"name": "Camera", "location_public_id": location["public_id"]}},
        )
        data = b"\xff\xd8\xffphoto-data"
        photo_args = {
            "public_id": item["public_id"],
            "data_base64": base64.b64encode(data).decode(),
            "mime_type": "image/jpeg",
            "width": 640,
            "height": 480,
        }
        photo = _tool(server, "findstuff_upload_photo", photo_args)
        assert photo["item_public_id"] == item["public_id"]
        assert photo["width"] == 640
        assert (tmp_path / photo["file_path"]).read_bytes() == data
        assert (
            _tool(server, "findstuff_upload_photo", photo_args)["public_id"] == photo["public_id"]
        )
        assert (
            len(
                _tool(server, "findstuff_get_item_detail", {"public_id": item["public_id"]})[
                    "photos"
                ]
            )
            == 1
        )

        invalid = server.handle_message(
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "findstuff_upload_photo",
                    "arguments": {**photo_args, "data_base64": "%%%"},
                },
            }
        )
        assert invalid is not None
        assert invalid["result"]["isError"]

        lot = _tool(
            server,
            "findstuff_create_item_lot",
            {"public_id": item["public_id"], "quantity": 2, "expiration_date": "2027-01-01"},
        )
        assert lot["quantity"] == "2"
        task = _tool(
            server,
            "findstuff_create_maintenance_task",
            {
                "public_id": item["public_id"],
                "title": "Check lens",
                "interval_days": 30,
                "next_due_at": "2027-01-01",
            },
        )
        assert task["title"] == "Check lens"
        assert (
            _tool(
                server,
                "findstuff_update_location",
                {"public_id": location["public_id"], "changes": {"name": "Top shelf"}},
            )["name"]
            == "Top shelf"
        )
        _tool(server, "findstuff_archive_item", {"public_id": item["public_id"]})
        assert (
            _tool(server, "findstuff_restore_item", {"public_id": item["public_id"]})["archived_at"]
            is None
        )
        _tool(
            server,
            "findstuff_delete_item_lot",
            {"public_id": item["public_id"], "lot_public_id": lot["public_id"]},
        )
        _tool(server, "findstuff_delete_photo", {"public_id": photo["public_id"]})
        assert not (tmp_path / photo["file_path"]).exists()
        assert (
            _tool(server, "findstuff_get_item_detail", {"public_id": item["public_id"]})["photos"]
            == []
        )
    finally:
        server.close()


def test_mcp_category_management(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    server = FindStuffMCPServer(tmp_path / "mcp.sqlite3")
    try:
        category = _tool(server, "findstuff_create_category", {"name": "Camera gear"})
        updated = _tool(
            server,
            "findstuff_update_category",
            {"category_id": category["id"], "changes": {"name": "Photo gear"}},
        )
        assert updated["name"] == "Photo gear"
        assert _tool(server, "findstuff_delete_category", {"category_id": category["id"]}) == {
            "deleted": True
        }
    finally:
        server.close()


def test_mcp_planning_compatibility_and_custom_fields(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    server = FindStuffMCPServer(tmp_path / "mcp.sqlite3")
    try:
        category = _tool(server, "findstuff_create_category", {"name": "Test electronics"})
        location = _tool(server, "findstuff_create_location", {"name": "Bench"})
        field = _tool(
            server,
            "findstuff_save_category_field",
            {
                "values": {
                    "category": category["id"],
                    "key": "voltage",
                    "label": "Voltage",
                    "type": "integer",
                }
            },
        )
        field = _tool(
            server,
            "findstuff_save_category_field",
            {"public_id": field["public_id"], "values": {"label": "Supply voltage"}},
        )
        assert field["label"] == "Supply voltage"
        target = _tool(
            server,
            "findstuff_save_compatibility_target",
            {"values": {"name": "Model Z", "manufacturer": "Example"}},
        )
        target = _tool(
            server,
            "findstuff_save_compatibility_target",
            {"public_id": target["public_id"], "values": {"aliases": ["Model Zee"]}},
        )
        assert target["aliases"] == ["Model Zee"]
        item = _tool(
            server,
            "findstuff_create_item",
            {
                "values": {
                    "name": "Power supply",
                    "category_id": category["id"],
                    "location_public_id": location["public_id"],
                    "quantity": 2,
                    "custom_fields": {field["public_id"]: 12},
                    "compatibility": [{"target": target["public_id"], "status": "compatible"}],
                }
            },
        )
        extensions = _tool(
            server, "findstuff_get_item_extensions", {"public_id": item["public_id"]}
        )
        assert extensions["custom_fields"][field["public_id"]] == 12
        assert extensions["compatibility"][0]["target"] == target["public_id"]
        assert _tool(server, "findstuff_list_category_fields", {"category_id": category["id"]})
        assert (
            _tool(server, "findstuff_get_compatibility_target", {"public_id": target["public_id"]})[
                "target"
            ]["public_id"]
            == target["public_id"]
        )

        project = _tool(server, "findstuff_save_project", {"values": {"name": "Radio build"}})
        project = _tool(
            server,
            "findstuff_save_project",
            {"public_id": project["public_id"], "values": {"notes": "Prototype"}},
        )
        assert project["notes"] == "Prototype"
        requirement = _tool(
            server,
            "findstuff_save_project_requirement",
            {
                "values": {
                    "project": project["public_id"],
                    "name": "Power supply",
                    "item": item["public_id"],
                    "required_quantity": 1,
                    "compatibility": [target["public_id"]],
                }
            },
        )
        requirement = _tool(
            server,
            "findstuff_save_project_requirement",
            {"public_id": requirement["public_id"], "values": {"notes": "Needed for testing"}},
        )
        assert requirement["notes"] == "Needed for testing"
        assert requirement["project"] == project["public_id"]
        assert (
            _tool(server, "findstuff_get_project", {"public_id": project["public_id"]})[
                "requirements"
            ][0]["public_id"]
            == requirement["public_id"]
        )
        assert _tool(server, "findstuff_list_projects", {})[0]["public_id"] == project["public_id"]
        assert (
            _tool(server, "findstuff_project_candidates", {"public_id": project["public_id"]})[
                "total"
            ]
            >= 1
        )
        loan = _tool(
            server,
            "findstuff_create_loan",
            {"values": {"item_public_id": item["public_id"], "direction": "lent", "person": "Ana"}},
        )
        assert _tool(server, "findstuff_list_loans", {})[0]["public_id"] == loan["public_id"]
        assert _tool(server, "findstuff_return_loan", {"public_id": loan["public_id"]})["returned"]
    finally:
        server.close()


def test_mcp_documents_and_project_files(tmp_path: Path, monkeypatch) -> None:
    import base64

    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    server = FindStuffMCPServer(tmp_path / "mcp.sqlite3")
    try:
        item = _tool(server, "findstuff_create_item", {"values": {"name": "Drill"}})
        data = b"%PDF-1.4\nsmall test document"
        encoded = base64.b64encode(data).decode()
        document = _tool(
            server,
            "findstuff_upload_document",
            {
                "item_public_id": item["public_id"],
                "data_base64": encoded,
                "mime_type": "application/pdf",
                "filename": "receipt.pdf",
                "document_type": "receipt",
            },
        )
        assert (
            _tool(server, "findstuff_list_documents", {"item_public_id": item["public_id"]})[0][
                "public_id"
            ]
            == document["public_id"]
        )
        content = _tool(
            server, "findstuff_get_document_content", {"public_id": document["public_id"]}
        )
        assert base64.b64decode(content["data_base64"]) == data
        updated = _tool(
            server,
            "findstuff_update_document",
            {"public_id": document["public_id"], "changes": {"title": "Shop receipt"}},
        )
        assert updated["title"] == "Shop receipt"

        project = _tool(server, "findstuff_save_project", {"values": {"name": "Shelf build"}})
        with_file = _tool(
            server,
            "findstuff_upload_project_file",
            {
                "project_public_id": project["public_id"],
                "data_base64": encoded,
                "mime_type": "application/pdf",
                "filename": "plan.pdf",
            },
        )
        file_id = with_file["files"][0]["public_id"]
        attachment = _tool(server, "findstuff_get_project_file_content", {"public_id": file_id})
        assert base64.b64decode(attachment["data_base64"]) == data
        _tool(server, "findstuff_delete_project_file", {"public_id": file_id})
        _tool(server, "findstuff_delete_document", {"public_id": document["public_id"]})
        assert (
            _tool(server, "findstuff_list_documents", {"item_public_id": item["public_id"]}) == []
        )
    finally:
        server.close()


def test_mcp_location_rules_and_category_contents(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    server = FindStuffMCPServer(tmp_path / "mcp.sqlite3")
    try:
        location = _tool(server, "findstuff_create_location", {"name": "Storage"})
        category = _tool(server, "findstuff_create_category", {"name": "Test adapters"})
        item = _tool(
            server,
            "findstuff_create_item",
            {
                "values": {
                    "name": "Adapter",
                    "category_id": category["id"],
                    "location_public_id": location["public_id"],
                }
            },
        )
        contents = _tool(server, "findstuff_category_contents", {"category_id": category["id"]})
        assert any(entry["public_id"] == item["public_id"] for entry in contents["items"])
        assert (
            _tool(server, "findstuff_get_location", {"public_id": location["public_id"]})["name"]
            == "Storage"
        )
        _tool(server, "findstuff_create_location_type", {"name": "Cabinet"})
        assert any(
            entry["name"] == "cabinet"
            for entry in _tool(server, "findstuff_list_location_types", {})
        )
        rule = _tool(
            server,
            "findstuff_create_location_rule",
            {
                "values": {
                    "rule_type": "name",
                    "match_value": "Adapter",
                    "location_public_id": location["public_id"],
                }
            },
        )
        assert rule["public_id"]
        assert (
            _tool(server, "findstuff_suggest_location", {"name": "Adapter"})["suggestion"]
            is not None
        )
        assert _tool(server, "findstuff_list_location_rules", {})
        _tool(server, "findstuff_delete_location_rule", {"public_id": rule["public_id"]})
    finally:
        server.close()


def test_mcp_search_and_saved_views(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    server = FindStuffMCPServer(tmp_path / "mcp.sqlite3")
    try:
        item = _tool(server, "findstuff_create_item", {"values": {"name": "Cordless drill"}})
        assert (
            _tool(server, "findstuff_inventory_page", {"query": "drill"})["items"][0]["public_id"]
            == item["public_id"]
        )
        assert (
            _tool(server, "findstuff_human_search", {"query": "drill"})["items"][0]["public_id"]
            == item["public_id"]
        )
        alias = _tool(
            server,
            "findstuff_create_search_alias",
            {"values": {"alias": "borer", "target_type": "term", "replacement": "drill"}},
        )
        assert alias["alias"] == "borer"
        assert _tool(server, "findstuff_list_search_aliases", {})
        _tool(server, "findstuff_delete_search_alias", {"public_id": alias["public_id"]})
        view = _tool(
            server,
            "findstuff_save_view",
            {"public_id": "test-view", "request": {"view": {"id": "test-view", "name": "Tools"}}},
        )
        assert view["revision"] == 1
        assert _tool(server, "findstuff_list_saved_views", {})[0]["name"] == "Tools"
        _tool(server, "findstuff_delete_view", {"public_id": "test-view", "revision": 1})
        assert _tool(server, "findstuff_list_saved_views", {}) == []
        assert _tool(server, "findstuff_dashboard", {})
    finally:
        server.close()


def test_mcp_public_settings_and_mappings(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    server = FindStuffMCPServer(tmp_path / "mcp.sqlite3")
    try:
        settings = _tool(server, "findstuff_get_settings", {})
        assert "integrations" in settings
        units = _tool(server, "findstuff_get_units", {})["units"]
        assert _tool(server, "findstuff_save_units", {"units": units})["units"] == units
        assert _tool(server, "findstuff_list_off_category_mappings", {})
        category = _tool(server, "findstuff_create_category", {"name": "Test mapped food"})
        mapping = _tool(
            server,
            "findstuff_set_off_category_mapping",
            {"off_tag": "en:test-food", "category_id": category["id"]},
        )
        assert mapping["category_id"] == category["id"]
        exported = _tool(server, "findstuff_export_off_category_mappings", {})
        preview = _tool(
            server,
            "findstuff_import_off_category_mappings",
            {"payload": exported, "apply": False},
        )
        assert preview["applied"] == 0
    finally:
        server.close()


def test_mcp_bootstrap_and_offline_replay(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    server = FindStuffMCPServer(tmp_path / "mcp.sqlite3")
    try:
        assert _tool(server, "findstuff_health", {})["status"] == "ok"
        assert "categories" in _tool(server, "findstuff_bootstrap", {})
        args = {
            "operation_id": "mcp-offline-001",
            "kind": "create_item",
            "payload": {"name": "Offline adapter"},
        }
        first = _tool(server, "findstuff_sync_offline_operation", args)
        second = _tool(server, "findstuff_sync_offline_operation", args)
        assert first["result"]["public_id"] == second["result"]["public_id"]
    finally:
        server.close()


def test_mcp_qr_and_category_marks(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    server = FindStuffMCPServer(tmp_path / "mcp.sqlite3")
    try:
        item = _tool(server, "findstuff_create_item", {"values": {"name": "Label me"}})
        qr = _tool(
            server,
            "findstuff_item_qr",
            {"public_id": item["public_id"], "base_url": "https://inventory.example"},
        )
        assert item["public_id"] in qr["target"]
        assert "<svg" in qr["svg"]
        assert (
            "Label me"
            in _tool(server, "findstuff_item_label", {"public_id": item["public_id"]})["html"]
        )
        mark = _tool(
            server,
            "findstuff_save_category_mark",
            {"name": "testmark", "svg": "<svg><circle cx='12' cy='12' r='6'/></svg>"},
        )
        assert "<circle" in mark["svg"]
        assert (
            _tool(server, "findstuff_get_category_mark", {"name": "testmark"})["svg"] == mark["svg"]
        )
        _tool(server, "findstuff_delete_category_mark", {"name": "testmark"})
    finally:
        server.close()
