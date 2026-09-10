"""Category-owned, inherited field definitions with stable item value references."""

from __future__ import annotations

import json
import re
from datetime import date
from decimal import Decimal, InvalidOperation

from .extension_schemas import CategoryField
from .inventory import ConflictError, NotFoundError, category_path, get_category_row, new_public_id
from .network_security import validate_http_url


def category_chain(connection, category_id):
    chain, seen = [], set()
    while category_id is not None:
        if category_id in seen:
            raise ConflictError("Category hierarchy contains a cycle")
        seen.add(category_id)
        row = get_category_row(connection, category_id)
        chain.append(category_id)
        category_id = row["parent_id"]
    return chain


def root_field(connection, row):
    seen = set()
    while row["overrides_id"] is not None:
        if row["id"] in seen:
            raise ConflictError("Custom field override cycle")
        seen.add(row["id"])
        row = connection.execute(
            "SELECT * FROM category_fields WHERE id=?", (row["overrides_id"],)
        ).fetchone()
    return row


def serialize_field(connection, row, category_id=None):
    root = root_field(connection, row)
    parent = connection.execute(
        "SELECT public_id FROM category_fields WHERE id=?", (row["overrides_id"],)
    ).fetchone()
    return {
        "overrides": parent[0] if parent else None,
        "value_field_id": root["public_id"],
        "public_id": row["public_id"],
        "category": row["category_id"],
        "source_category_path": category_path(connection, row["category_id"]),
        "inherited": category_id is not None and category_id != row["category_id"],
        **{key: row[key] for key in ("key", "label", "description", "type", "unit", "sort_order")},
        **{key: bool(row[key]) for key in ("required", "nullable", "active")},
        "default": json.loads(row["default_json"]) if row["default_json"] is not None else None,
        "allowed_values": json.loads(row["allowed_values_json"]),
        "constraints": json.loads(row["constraints_json"]),
        "affected_items": connection.execute(
            "SELECT count(*) FROM item_field_values WHERE field_id=?", (root["id"],)
        ).fetchone()[0],
    }


def category_fields(connection, category_id, *, include_inactive=False):
    chain = category_chain(connection, category_id)
    if not chain:
        return []
    rows = connection.execute(
        f"SELECT * FROM category_fields WHERE category_id IN ({','.join('?' for _ in chain)}) "
        + ("" if include_inactive else "AND active=1 ")
        + "ORDER BY sort_order,id",
        chain,
    ).fetchall()
    selected = {}
    for row in sorted(rows, key=lambda field: chain.index(field["category_id"])):
        root_id = root_field(connection, row)["id"]
        if row["active"] and root_id not in selected:
            selected[root_id] = row
    result = [serialize_field(connection, row, category_id) for row in selected.values()]
    if include_inactive:
        result.extend(
            serialize_field(connection, row, category_id) for row in rows if not row["active"]
        )
    return sorted(result, key=lambda field: (field["sort_order"], field["key"]))


def validate_value(field, value):
    if value is None:
        if not field["nullable"]:
            raise ValueError(f"{field['key']} cannot be null")
        return None
    kind, constraints = field["type"], field["constraints"]
    if kind in ("string", "text", "enum", "date", "url"):
        if not isinstance(value, str):
            raise ValueError(f"{field['key']} requires {kind} text")
        if (
            not constraints.get("min_length", 0)
            <= len(value)
            <= constraints.get("max_length", 8000)
        ):
            raise ValueError(f"{field['key']} text length is outside its constraints")
        if kind == "enum" and value not in field["allowed_values"]:
            raise ValueError(f"{field['key']} must be one of {field['allowed_values']}")
        if kind == "date":
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                raise ValueError(f"{field['key']} requires YYYY-MM-DD")
            date.fromisoformat(value)
        if kind == "url":
            validate_http_url(value)
    elif kind == "boolean":
        if type(value) is not bool:
            raise ValueError(f"{field['key']} requires a JSON boolean")
    elif kind == "integer":
        if type(value) is not int:
            raise ValueError(f"{field['key']} requires a JSON integer; no coercion is performed")
    elif kind == "decimal":
        if isinstance(value, bool) or not isinstance(value, (int, float, str)):
            raise ValueError(f"{field['key']} requires a decimal number or numeric string")
        try:
            numeric = Decimal(str(value))
        except InvalidOperation as exc:
            raise ValueError(f"{field['key']} is not a decimal") from exc
        if not numeric.is_finite() or -numeric.as_tuple().exponent > constraints.get(
            "decimal_places", 6
        ):
            raise ValueError(f"{field['key']} has invalid precision")
        value = str(numeric)
    if kind in ("integer", "decimal"):
        numeric = Decimal(str(value))
        for bound, condition in (("min", lambda a, b: a < b), ("max", lambda a, b: a > b)):
            if constraints.get(bound) is not None and condition(
                numeric, Decimal(str(constraints[bound]))
            ):
                raise ValueError(f"{field['key']} violates {bound}={constraints[bound]}")
    return value


def save_field(connection, data, public_id=None):
    from .extended import _resolve_category_id

    field = CategoryField.model_validate(data).model_dump(mode="json")
    category_id = _resolve_category_id(connection, field["category"])
    if category_id is None:
        raise ValueError("A custom field requires a category")
    field["category"] = category_id
    constraints = field["constraints"]
    if (
        constraints["min"] is not None
        and constraints["max"] is not None
        and Decimal(constraints["min"]) > Decimal(constraints["max"])
    ):
        raise ValueError("Custom field minimum exceeds maximum")
    if constraints["min_length"] > constraints["max_length"]:
        raise ValueError("Custom field minimum length exceeds maximum")
    if field["type"] == "enum" and (
        not field["allowed_values"]
        or len(set(field["allowed_values"])) != len(field["allowed_values"])
    ):
        raise ValueError("Enum needs distinct allowed values")
    if field["type"] != "enum" and field["allowed_values"]:
        raise ValueError("Only enum custom fields accept allowed_values")
    if field["default"] is not None:
        field["default"] = validate_value(field, field["default"])
    chain = category_chain(connection, category_id)
    existing = (
        connection.execute(
            "SELECT * FROM category_fields WHERE public_id=?", (public_id,)
        ).fetchone()
        if public_id
        else None
    )
    base = None
    if field["overrides"]:
        candidates = connection.execute(
            "SELECT * FROM category_fields WHERE public_id=? OR key=? COLLATE NOCASE",
            (field["overrides"], field["overrides"]),
        ).fetchall()
        candidates = [row for row in candidates if row["category_id"] in chain[1:]]
        candidates.sort(key=lambda row: chain.index(row["category_id"]))
        if not candidates:
            raise NotFoundError(
                "Ancestor field not found; overrides must reference an ancestor definition"
            )
        base = candidates[0]
        if field["key"] != base["key"]:
            raise ValueError("An override keeps the inherited semantic key")
    root = (
        root_field(connection, base or existing)
        if base is not None or existing is not None
        else None
    )
    for other in connection.execute(
        "SELECT * FROM category_fields WHERE key=? COLLATE NOCASE", (field["key"],)
    ):
        if other["public_id"] == public_id:
            continue
        if other["category_id"] in chain or category_id in category_chain(
            connection, other["category_id"]
        ):
            shared_root = root is not None and root_field(connection, other)["id"] == root["id"]
            if not shared_root or other["category_id"] == category_id:
                raise ConflictError(
                    f"Field key {field['key']} already exists in this inheritance chain; "
                    "create an explicit override"
                )
    if existing and existing["category_id"] != category_id:
        raise ValueError("Field source category is immutable")
    if existing and existing["overrides_id"] != (base["id"] if base else None):
        raise ValueError("Override source is immutable")
    values = (
        base["id"] if base else None,
        field["key"],
        field["label"],
        field["description"],
        field["type"],
        field["required"],
        field["nullable"],
        json.dumps(field["default"]) if field["default"] is not None else None,
        json.dumps(field["allowed_values"]),
        json.dumps(constraints),
        field["unit"],
        field["sort_order"],
        field["active"],
    )
    if existing:
        connection.execute(
            (
                "UPDATE category_fields SET overrides_id=?,key=?,label=?,descriptio"
                "n=?,type=?,required=?,nullable=?,default_json=?,allowed_values_jso"
                "n=?,constraints_json=?,unit=?,sort_order=?,active=? WHERE id=?"
            ),
            (*values, existing["id"]),
        )
    else:
        public_id = new_public_id("cf")
        connection.execute(
            (
                "INSERT INTO category_fields(public_id,category_id,overrides_id,key"
                ",label,description,type,required,nullable,default_json,allowed_val"
                "ues_json,constraints_json,unit,sort_order,active) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
            ),
            (public_id, category_id, *values),
        )
    row = connection.execute(
        "SELECT * FROM category_fields WHERE public_id=?", (public_id,)
    ).fetchone()
    if existing and existing["overrides_id"] is None and existing["key"] != field["key"]:
        for descendant in connection.execute(
            "SELECT * FROM category_fields WHERE overrides_id IS NOT NULL"
        ).fetchall():
            if root_field(connection, descendant)["id"] == existing["id"]:
                connection.execute(
                    "UPDATE category_fields SET key=? WHERE id=?", (field["key"], descendant["id"])
                )
    validate_field_tree(connection)
    root = root_field(connection, row)
    failures = []
    for value in connection.execute(
        (
            "SELECT v.value_json,i.public_id,i.category_id FROM "
            "item_field_values v JOIN items i ON i.id=v.item_id WHERE "
            "v.field_id=?"
        ),
        (root["id"],),
    ):
        effective = next(
            (
                entry
                for entry in category_fields(connection, value["category_id"])
                if entry["value_field_id"] == root["public_id"]
            ),
            None,
        )
        if effective:
            try:
                validate_value(effective, json.loads(value["value_json"]))
            except ValueError as exc:
                failures.append({"item_public_id": value["public_id"], "message": str(exc)})
    if failures:
        from .import_protocol import ImportFailure

        raise ImportFailure(
            "Field change cannot migrate existing values",
            "field_migration_failed",
            "data.type/constraints",
            affected_items=len(failures),
            failures=failures,
        )
    return serialize_field(connection, row)


def item_values(connection, item_id):
    return {
        row["public_id"]: json.loads(row["value_json"])
        for row in connection.execute(
            (
                "SELECT f.public_id,v.value_json FROM item_field_values v JOIN "
                "category_fields f ON f.id=v.field_id WHERE v.item_id=?"
            ),
            (item_id,),
        )
    }


def set_item_values(connection, item_id, category_id, values, *, enforce_required=False):
    if not isinstance(values, dict):
        raise ValueError("custom_fields must be an object; omitted keys remain unchanged")
    definitions = category_fields(connection, category_id)
    existing = item_values(connection, item_id)
    by_reference = {
        reference: field
        for field in definitions
        for reference in (field["key"], field["public_id"], field["value_field_id"])
    }
    supplied = set()
    for reference, value in values.items():
        field = by_reference.get(reference)
        if field is None:
            raise ValueError(f"Unknown or inactive custom field for selected category: {reference}")
        if field["value_field_id"] in supplied:
            raise ValueError(f"Provide only one reference for field {field['key']}")
        supplied.add(field["value_field_id"])
        existing[field["value_field_id"]] = validate_value(field, value)
    for field in definitions:
        public_id = field["value_field_id"]
        if public_id not in existing and field["default"] is not None:
            existing[public_id] = field["default"]
            supplied.add(public_id)
        if (
            enforce_required
            and field["required"]
            and (public_id not in existing or existing[public_id] is None and not field["nullable"])
        ):
            raise ValueError(f"Required custom field is missing: {field['key']}")
    for public_id in supplied:
        field_id = connection.execute(
            "SELECT id FROM category_fields WHERE public_id=?", (public_id,)
        ).fetchone()[0]
        connection.execute(
            (
                "INSERT INTO item_field_values(item_id,field_id,value_json) "
                "VALUES(?,?,?) ON CONFLICT(item_id,field_id) DO UPDATE SET "
                "value_json=excluded.value_json"
            ),
            (item_id, field_id, json.dumps(existing[public_id])),
        )


def restore_item_values(connection, item_id, values):
    connection.execute("DELETE FROM item_field_values WHERE item_id=?", (item_id,))
    for public_id, value in values.items():
        field = connection.execute(
            "SELECT id FROM category_fields WHERE public_id=?", (public_id,)
        ).fetchone()
        if field:
            connection.execute(
                "INSERT INTO item_field_values VALUES(?,?,?)",
                (item_id, field[0], json.dumps(value)),
            )


def validate_field_tree(connection):
    fields = connection.execute("SELECT * FROM category_fields").fetchall()
    for row in fields:
        chain = category_chain(connection, row["category_id"])
        if row["overrides_id"] is not None:
            base = connection.execute(
                "SELECT * FROM category_fields WHERE id=?", (row["overrides_id"],)
            ).fetchone()
            if base["category_id"] not in chain[1:]:
                raise ConflictError(
                    f"Moving this category would detach field override {row['public_id']} "
                    "from its ancestor"
                )
        for other in fields:
            if (
                other["id"] != row["id"]
                and other["key"] == row["key"]
                and other["category_id"] in chain
            ):
                if root_field(connection, row)["id"] != root_field(connection, other)["id"]:
                    raise ConflictError(
                        f"Category move creates a field-key collision: {row['key']}"
                    )
