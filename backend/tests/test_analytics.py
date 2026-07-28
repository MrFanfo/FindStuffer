from __future__ import annotations

from decimal import Decimal
from pathlib import Path

from findstuff.db import connect, migrate
from findstuff.inventory import adjust_quantity, analytics, create_item, create_location


def test_analytics_reports_health_value_activity_and_consumption(tmp_path: Path) -> None:
    path = tmp_path / "analytics.sqlite3"
    migrate(path)
    connection = connect(path)
    try:
        location = create_location(connection, {"name": "Pantry"})
        item = create_item(
            connection,
            {
                "name": "Rice",
                "location_public_id": location["public_id"],
                "quantity": Decimal("5"),
                "unit": "kg",
                "low_stock_threshold": Decimal("4"),
                "purchase_price_minor": 250,
                "purchase_currency": "EUR",
            },
        )
        adjust_quantity(
            connection,
            item["public_id"],
            Decimal("-2"),
            item["version"],
            source="test",
        )

        result = analytics(connection, 30)

        assert result["summary"]["active_items"] == 1
        assert result["summary"]["low_stock"] == 1
        assert result["summary"]["zero_stock"] == 0
        assert result["summary"]["missing_photo"] == 1
        assert result["summary"]["missing_category"] == 1
        assert result["summary"]["missing_details"] == 1
        assert result["summary"]["priced_items"] == 1
        assert result["summary"]["health_score"] == 25
        assert result["values"] == [
            {"currency": "EUR", "purchase_minor": 750, "estimated_minor": 0}
        ]
        assert result["activity_summary"]["current_events"] >= 2
        assert result["activity_summary"]["active_days"] == 1
        assert {entry["key"] for entry in result["action_mix"]} == {
            "consumed",
            "created",
        }
        assert result["completeness"][0]["percent"] == 100
        assert result["completeness"][1]["percent"] == 0
        assert result["stock"] == [
            {"label": "In stock", "count": 0},
            {"label": "Low", "count": 1},
            {"label": "Empty", "count": 0},
        ]
        assert sum(entry["count"] for entry in result["inventory_age"]) == 1
        assert result["categories"][0]["category_id"] is None
        assert result["locations"][0]["location_public_id"] == location["public_id"]
        assert result["source_activity"][0]["source"] in {"manual", "test"}
        assert result["top_consumed"][0]["name"] == "Rice"
        assert result["top_consumed"][0]["quantity"] == "2"
        assert result["top_changed"][0]["name"] == "Rice"
        assert sum(entry["changes"] for entry in result["activity"]) >= 2
    finally:
        connection.close()
