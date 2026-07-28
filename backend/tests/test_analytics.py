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
        assert result["summary"]["missing_photo"] == 1
        assert result["values"] == [
            {"currency": "EUR", "purchase_minor": 750, "estimated_minor": 0}
        ]
        assert result["top_consumed"][0]["name"] == "Rice"
        assert result["top_consumed"][0]["quantity"] == "2"
        assert sum(entry["changes"] for entry in result["activity"]) >= 2
    finally:
        connection.close()
