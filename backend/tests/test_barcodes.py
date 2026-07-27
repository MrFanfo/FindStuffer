import subprocess
from pathlib import Path

import pytest

from findstuff.barcodes import (
    BARCODE_PROVIDERS,
    cached_full_product,
    decode_image_code,
    existing_item_for_barcode,
    local_product,
    map_open_food_facts,
    normalize_barcode,
    save_full_product,
    save_result,
)
from findstuff.db import connect, migrate


def test_barcode_normalization_and_mapping() -> None:
    assert normalize_barcode("034000470693") == "0034000470693"
    mapped = map_open_food_facts(
        "3017620422003",
        {
            "product": {
                "code": "3017620422003",
                "product_name": "Hazelnut spread",
                "brands": "Example",
                "quantity": "400 g",
                "categories_tags": ["en:spreads"],
                "tags_sources": {
                    "packaging": {"categories": {"tags": ["en:hazelnut-spreads"]}}
                },
                "ingredients_text_it": "zucchero, nocciole",
                "nutrition_grade_fr": "d",
                "nova_group": 4,
                "nutriments": {
                    "fat_100g": 30.9,
                    "saturated-fat_100g": 10.6,
                    "sugars_100g": 56.3,
                },
                "image_front_url": "https://images.example/product.jpg",
            }
        },
    )
    assert mapped is not None
    assert mapped["name"] == "Hazelnut spread"
    assert mapped["categories"] == ["en:spreads"]
    assert mapped["direct_categories"] == ["en:hazelnut-spreads"]
    assert mapped["ingredients_text"] == "zucchero, nocciole"
    assert mapped["nutriscore_grade"] == "d"
    assert mapped["nova_group"] == "4"
    assert mapped["nutrition"] == {
        "fat_100g": 30.9,
        "saturated-fat_100g": 10.6,
        "sugars_100g": 56.3,
    }

    structured = map_open_food_facts(
        "8000000000000",
        {
            "product": {
                "product_name": "Pecan nuts",
                "ingredients": [{"id": "en:pecan-nuts"}, {"text": "salt"}],
            }
        },
    )
    assert structured is not None
    assert structured["ingredients_text"] == "pecan nuts, salt"

    translated = map_open_food_facts(
        "8000000000001",
        {"product": {"product_name": "Noix", "ingredients_text_fr": "noix de pécan"}},
    )
    assert translated is not None
    assert translated["ingredients_text"] == "noix de pécan"


def test_local_product_keeps_cached_open_food_facts_details(tmp_path: Path) -> None:
    path = tmp_path / "test.sqlite3"
    migrate(path)
    connection = connect(path)
    try:
        save_result(
            connection,
            "3017620422003",
            {
                "barcode": "3017620422003",
                "name": "Hazelnut spread",
                "brand": "Example",
                "package_quantity": "400 g",
                "categories": ["en:spreads"],
                "ingredients_text": "zucchero, nocciole",
                "nutriscore_grade": "d",
                "nova_group": "4",
                "ecoscore_grade": "c",
                "nutrition": {"fat_100g": 30.9, "sugars_100g": 56.3},
                "image_url": "https://images.example/product.jpg",
                "source": "Open Food Facts",
                "source_url": "https://world.openfoodfacts.org/product/3017620422003",
            },
        )

        product = local_product(connection, "3017620422003")
    finally:
        connection.close()

    assert product is not None
    assert product["ingredients_text"] == "zucchero, nocciole"
    assert product["nutriscore_grade"] == "d"
    assert product["nutrition"]["sugars_100g"] == 56.3


def test_existing_item_for_barcode_returns_inventory_item(tmp_path: Path) -> None:
    path = tmp_path / "existing.sqlite3"
    migrate(path)
    connection = connect(path)
    try:
        from findstuff.inventory import create_item

        created = create_item(connection, {"name": "Pecan nuts", "barcode": "034000470693"})
        existing = existing_item_for_barcode(connection, "0034000470693")
    finally:
        connection.close()
    assert existing is not None
    assert existing["public_id"] == created["public_id"]


def test_full_product_payload_is_cached_without_dropping_fields(tmp_path: Path) -> None:
    path = tmp_path / "full.sqlite3"
    migrate(path)
    connection = connect(path)
    try:
        raw = {
            "code": "8000000000000",
            "product_name": "Pecan nuts",
            "ingredients_text_fr": "noix de pécan",
            "ingredients": [{"id": "en:pecan-nuts", "percent_estimate": 100}],
            "custom_future_field": {"nested": [1, 2, 3]},
        }
        save_full_product(connection, "8000000000000", raw, BARCODE_PROVIDERS[0])
        cached = cached_full_product(connection, "8000000000000")
    finally:
        connection.close()
    assert cached is not None
    assert cached["product"] == raw


def test_decode_image_code_uses_zbarimg(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        calls.append(command)
        return subprocess.CompletedProcess(command, 0, stdout="12345678\n", stderr="")

    monkeypatch.setattr("findstuff.barcodes.shutil.which", lambda name: "/usr/bin/zbarimg")
    monkeypatch.setattr("findstuff.barcodes.subprocess.run", fake_run)

    assert decode_image_code(b"image-data", "image/png") == "12345678"
    assert calls[0][:3] == ["/usr/bin/zbarimg", "--raw", "--quiet"]


def test_decode_image_code_reports_missing_tool(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("findstuff.barcodes.shutil.which", lambda name: None)

    with pytest.raises(RuntimeError, match="zbar-tools"):
        decode_image_code(b"image-data", "image/jpeg")
