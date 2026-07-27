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
