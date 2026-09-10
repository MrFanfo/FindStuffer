"""Compile the inventory formula AST to parameterized SQL, never executable input."""

from __future__ import annotations

import math
from datetime import date
from typing import Any

FIELDS = {
    "name": "i.name",
    "brand": "i.brand",
    "model": "i.model",
    "serial": "i.serial_number",
    "description": "i.description",
    "notes": "i.notes",
    "category": "i.category_path",
    "location": "i.location_path",
    "tag": "tag.value",
    "quantity": "i.quantity_milli / 1000.0",
    "unit": "i.unit",
    "value": "COALESCE(i.estimated_price_minor, i.purchase_price_minor) / 100.0",
    "weight": "i.weight_g",
    "length": "i.length_mm",
    "width": "i.width_mm",
    "height": "i.height_mm",
    "expiration": "i.expiration_date",
    "barcode": "i.barcode",
    "updated": "date(i.updated_at)",
    "low_stock": "i.low_stock_text",
    "has_photo": "i.has_photo_text",
    "missing_location": "i.missing_location_text",
}
NUMERIC = {"quantity", "value", "weight", "length", "width", "height"}
DATES = {"expiration", "updated"}
BOOLEANS = {"low_stock", "has_photo", "missing_location"}


def compile_formula(node: Any) -> tuple[str, list[Any]]:
    parameters: list[Any] = []
    visited = 0

    def walk(current: Any, depth: int = 0) -> str:
        nonlocal visited
        visited += 1
        if visited > 128 or depth > 16 or not isinstance(current, dict):
            raise ValueError("Formula is too complex or invalid")
        kind = current.get("type")
        if not isinstance(kind, str):
            raise ValueError("Invalid formula type")
        if kind in {"and", "or"}:
            left = walk(current.get("left"), depth + 1)
            right = walk(current.get("right"), depth + 1)
            return f"({left} {kind.upper()} {right})"
        if kind == "not":
            return f"NOT ({walk(current.get('node'), depth + 1)})"
        if kind != "condition" or not isinstance(current.get("rule"), dict):
            raise ValueError("Invalid formula condition")
        rule = current["rule"]
        field, operator = rule.get("field"), rule.get("operator")
        if not isinstance(field, str) or field not in FIELDS:
            raise ValueError("Unknown formula field")
        if not isinstance(operator, str):
            raise ValueError("Invalid formula operator")
        expression = FIELDS[field]
        value = rule.get("value", "")
        if not isinstance(value, str) or len(value) > 2000:
            raise ValueError("Invalid formula value")
        value = value.strip()
        text = f"lower(trim(COALESCE({expression}, '')))"
        if operator in {"empty", "not-empty"}:
            comparison = f"{text} != ''"
            if field == "tag":
                comparison = f"EXISTS (SELECT 1 FROM json_each(i.tags_json) tag WHERE {comparison})"
            return comparison if operator == "not-empty" else f"NOT ({comparison})"
        negative = operator in {"not-contains", "not-equals", "not-one-of"}
        if operator in {"one-of", "not-one-of"}:
            choices = current.get("choices", value.split(","))
            if not isinstance(choices, list) or not choices or len(choices) > 100:
                raise ValueError("Formula needs 1–100 choices")
            clauses = []
            for choice in choices:
                if not isinstance(choice, str) or len(choice) > 2000:
                    raise ValueError("Invalid formula choice")
                choice = choice.strip().lower()
                clauses.append(f"({text} = ? OR substr({text}, -length(?)) = ?)")
                parameters.extend((choice, f" > {choice}", f" > {choice}"))
            comparison = "(" + " OR ".join(clauses) + ")"
        elif operator in {"contains", "not-contains"}:
            if field in NUMERIC | DATES | BOOLEANS:
                raise ValueError("CONTAINS requires a text field")
            comparison = f"instr({text}, ?) > 0"
            parameters.append(value.lower())
        else:
            operators = {
                "equals": "=",
                "not-equals": "=",
                "gt": ">",
                "gte": ">=",
                "lt": "<",
                "lte": "<=",
                "before": "<",
                "after": ">",
            }
            if operator not in operators:
                raise ValueError("Unknown formula operator")
            if operator in {"gt", "gte", "lt", "lte"} and field not in NUMERIC:
                raise ValueError("Comparison requires a numeric field")
            if operator in {"before", "after"} and field not in DATES:
                raise ValueError("BEFORE/AFTER requires a date field")
            expected: Any = value.lower()
            if field in NUMERIC:
                try:
                    expected = float(value.replace(",", "."))
                except ValueError as exc:
                    raise ValueError("Expected a number in formula") from exc
                if not math.isfinite(expected):
                    raise ValueError("Expected a finite number in formula")
                comparison = f"COALESCE({expression} {operators[operator]} ?, 0)"
            else:
                if field in DATES:
                    try:
                        date.fromisoformat(value)
                    except ValueError as exc:
                        raise ValueError("Expected a YYYY-MM-DD date in formula") from exc
                if field in BOOLEANS and expected not in {"true", "false"}:
                    raise ValueError("Expected true or false in formula")
                comparison = f"{text} {operators[operator]} ?"
            parameters.append(expected)
        if field == "tag":
            comparison = f"EXISTS (SELECT 1 FROM json_each(i.tags_json) tag WHERE {comparison})"
        return f"NOT ({comparison})" if negative else comparison

    return (walk(node), parameters) if node is not None else ("1", [])
