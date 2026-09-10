"""Expose planning and metadata contracts directly from their validated models."""

from __future__ import annotations

from .compatibility import STATES, item_compatibility, targets
from .custom_fields import category_fields, item_values, serialize_field
from .extension_schemas import ENTITY_MODELS
from .extensions import MATCH_KEYS
from .projects import project_detail


def extend_template(connection, template):
    template["_capabilities"] = {
        "projects": True,
        "category_custom_fields": True,
        "compatibility": True,
        "manage_custom_field_definitions": True,
        "manage_compatibility_targets": True,
        "category_field_overrides": True,
    }
    for entity, model in ENTITY_MODELS.items():
        schema = model.model_json_schema()
        properties = schema["properties"]
        template["$defs"].update(schema.get("$defs", {}))
        template["_field_definitions"][entity] = properties
        template["_schemas"][entity] = {
            "add": {
                "required": schema.get("required", []),
                "optional": [key for key in properties if key not in schema.get("required", [])],
            },
            "modify": {
                "required": ["match", "data"],
                "allowed_fields": list(properties),
                "match_by": list(MATCH_KEYS[entity]),
                "omitted": "unchanged",
            },
            "delete": {
                "required": ["match"],
                "match_by": list(MATCH_KEYS[entity]),
                "effect": (
                    "Archive/deactivate/cancel, preserving related data. No hard delete"
                    " through operations."
                ),
            },
        }
        for name, field in properties.items():
            field["description"] = FIELD_HELP.get(
                name, field.get("description", name.replace("_", " "))
            )
            nullable = (
                any(choice.get("type") == "null" for choice in field.get("anyOf", []))
                or name == "default"
            )
            field["null_semantics"] = (
                "Explicitly clear this optional value"
                if nullable
                else "Rejected; use the documented empty value where applicable"
            )
            field["omitted_on_modify"] = "Leave unchanged"
            if "default" not in field and not model.model_fields[name].is_required():
                field["default"] = model.model_fields[name].get_default(call_default_factory=True)
                if hasattr(field["default"], "model_dump"):
                    field["default"] = field["default"].model_dump(mode="json")
            field["identity"] = name in {"name", "key", "category", "project", "aliases"}
            field["matching"] = FIELD_HELP.get(name, "Not used for reference resolution")
    for category in template["_available_categories"]:
        category["custom_fields"] = category_fields(
            connection, category["id"], include_inactive=True
        )
    from .inventory import category_path, location_path

    for item in template["_available_items"]:
        location_id = connection.execute(
            "SELECT location_id FROM items WHERE id=?", (item["id"],)
        ).fetchone()[0]
        item.update(
            category_path=category_path(connection, item["category_id"])
            if item["category_id"]
            else None,
            location_path=location_path(connection, location_id),
            custom_fields=item_values(connection, item["id"]),
            compatibility=item_compatibility(connection, item["id"]),
        )
    template["_available_category_fields"] = [
        serialize_field(connection, row)
        for row in connection.execute("SELECT * FROM category_fields ORDER BY id")
    ]
    template["_available_compatibility_targets"] = targets(connection)
    template["_available_projects"] = [
        project_detail(connection, row[0])
        for row in connection.execute("SELECT public_id FROM projects ORDER BY name")
    ]
    template["_field_definitions"]["item"]["custom_fields"].update(
        {
            "description": (
                "Map of applicable field key or stable field ID to validated value."
                " Omitted keys remain unchanged on modify; {} is a no-op. Null is a"
                " value only for nullable definitions. Never silently create "
                "definitions. Stored values use value_field_id so child overrides "
                "and key renames preserve identity."
            ),
            "examples": [{"nozzle_diameter": 0.4, "material": "Hardened Steel"}],
        }
    )
    template["_field_definitions"]["item"]["compatibility"].update(
        {
            "description": (
                "Replacement array of explicit compatibility relationships; [] "
                "clears; omitted leaves unchanged. Each entry has target (stable "
                "ID, canonical name or alias), status, optional notes, source_url "
                "and adapter. No target is created implicitly."
            ),
            "items": {
                "type": "object",
                "required": ["target"],
                "additionalProperties": False,
                "properties": {
                    "target": {"type": "string"},
                    "status": {"enum": list(STATES), "default": "compatible"},
                    **{
                        key: {"type": "string", "maxLength": 2000, "default": ""}
                        for key in ("notes", "source_url", "adapter")
                    },
                },
            },
        }
    )
    template["_structured_metadata_rules"] = {
        "meaning": (
            "Category describes what an item is; custom fields describe its "
            "properties; compatibility describes what it works with; project "
            "describes intended work; requirement describes need; inventory "
            "describes physical stock and place."
        ),
        "custom_field_inheritance": (
            "Descendants inherit ancestor fields. Create an explicit "
            "category_field with overrides pointing to an ancestor field "
            "public_id (or its unambiguous key in the ancestor chain) to change"
            " the definition lower down. The nearest active category definition"
            " wins as a whole; overrides retain the root value_field_id. Keys "
            "must match the overridden field. Unrelated duplicate keys in an "
            "inheritance chain are rejected. Definitions expose "
            "source_category_path, inherited, overrides and value_field_id. "
            "Deactivating an override falls back to the next active ancestor."
        ),
        "definition_changes": (
            "Field source category and override source are immutable. Rename "
            "root keys without losing values; descendant override keys follow "
            "that rename. Changes validate existing affected values using the "
            "effective definition; failures identify item IDs and block commit."
            " No silent conversion of incompatible data. Existing items are not"
            " rewritten when a new required field is introduced; missing "
            "required values must be supplied when editing their "
            "fields/category or adding new items. Active defaults are applied "
            "on field/category edits and item creation."
        ),
        "deactivation": (
            "delete category_field means active=false. Values remain stored by "
            "stable root ID, even if the category moves or a field becomes "
            "inactive. Inactive and retained values remain visible on item "
            "details. No destructive field/value purge is supported. Category "
            "moves that would break explicit override ancestry or create "
            "unrelated duplicate keys are rejected; change the definitions "
            "first."
        ),
        "field_creation_policy": [
            "Reuse a semantically matching inherited field before creating one.",
            "Never duplicate built-in brand/model/dimensions/weight fields.",
            "Avoid diameter/nozzle_diameter/diameter_mm siblings for the same property.",
            (
                "Use stable snake_case keys, readable labels and clear "
                "descriptions; units belong in unit."
            ),
            (
                "Create reusable category properties, not one-off trivia; enum sets"
                " must be meaningfully bounded."
            ),
            "Do not invent technical values. Leave uncertain optional fields unset.",
            (
                "Custom field types are string, text, integer, decimal, boolean, "
                "enum, date and url. Constraints are min/max, min_length/max_length"
                " and decimal_places; see generated schema. No arbitrary regex or "
                "implicit unit conversions."
            ),
        ],
        "compatibility_inheritance": (
            "Explicit nearest target relationship wins over ancestor/family "
            "relationships, including incompatible and unknown overrides. "
            "Inheritance travels down a target family only and is visibly "
            "marked with source_target. Siblings do not imply one another. "
            "Category membership never proves compatibility. Deactivation "
            "retains links and names but stops active inheritance from that "
            "target."
        ),
        "compatibility_name_normalization": (
            "Canonical names and aliases are matched exactly ignoring case. "
            "Creation rejects cross-target spellings differing only in "
            "whitespace or hyphens. Add a deliberate alias to the existing "
            "target; display names are never silently rewritten."
        ),
        "compatibility_policy": [
            (
                "Reuse canonical targets and aliases; do not create Ender3, Ender 3"
                " and Creality Ender 3 variants."
            ),
            (
                "Create/modify targets explicitly using compatibility_target. "
                "Parent references must exist or have been created earlier in the "
                "batch; cycles are rejected."
            ),
            (
                "Use official manufacturer/documentation evidence when specific "
                "compatibility research is useful, and retain source_url. Do not "
                "infer or invent uncertain compatibility."
            ),
            (
                "requires_adapter/partial must include useful notes or adapter "
                "description. They are displayed distinctly and do not count as an "
                "unconditional compatible match."
            ),
        ],
        "project_quantities": (
            "required_quantity is need. inventory_quantity is an explicit "
            "allocation from the linked physical stock record; it defaults to 0"
            " and is never inferred merely from linking. "
            "inventory_quantity_available is calculated after other "
            "reservations/earlier allocations and can fall if stock changes. "
            "acquired_quantity is physically obtained stock kept OUTSIDE "
            "inventory. purchased_quantity is ordered but not received and does"
            " not count as owned. missing=max(required-available-acquired,0); "
            "to_buy=max(missing-purchased,0). Example required10 + available3 +"
            " acquired4 gives missing3. Quantity patches are absolute "
            "assignments, so repeated updates cannot increment accidentally."
        ),
        "project_stock": (
            "reserve=true optionally holds the explicit allocation; it never "
            "decrements global inventory. Unreserved allocations are planning "
            "estimates and may be shared across projects, with a warning. The "
            "same stock is not counted twice across requirements within a "
            "project. Mark acquired can reduce purchased and increase acquired "
            "in one modify. Add acquired stock to inventory transfers that "
            "quantity from acquired to inventory allocation atomically; it must"
            " not be counted in both. A planned requirement may have item=null "
            "and creates no inventory record by itself. Link by item public ID "
            "or unambiguous name; exact item composite matches are also "
            "supported."
        ),
        "project_identity": (
            "Project names are unique for new operations; legacy ambiguity "
            "requires public_id. Requirements are unique by project + "
            "normalized name + category. Match requirements by public_id or "
            "project + name; modify existing lines rather than adding "
            "duplicates. Compatibility requirements override project defaults "
            "when nonempty and only rank suggestions; they never automatically "
            "link an item."
        ),
        "completion": (
            "Progress averages per-line quantity coverage, capped at 100%, "
            "excluding cancelled lines; totals are grouped by unit to avoid "
            "adding incompatible units. Project completion is manual. A line "
            "status satisfied requires no missing quantity; planned/unlinked "
            "lines are valid and show a warning."
        ),
        "hierarchy_moves": (
            "modify location with data.parent/public parent ID moves the entire"
            " place subtree across any roots. Item location IDs and quantities "
            "stay stable; computed paths and search indexes update. modify "
            "category with data.parent/parent_id similarly moves its subtree "
            "and updates paths while items retain category IDs. Self/descendant"
            " moves and same-parent name collisions fail. Use null parent to "
            "move to the top level."
        ),
    }
    template["_examples"].update(
        {
            "category_field": {
                "op": "add",
                "type": "category_field",
                "data": {
                    "category": "Hobbies > 3D Printing",
                    "key": "nozzle_diameter",
                    "label": "Nozzle diameter",
                    "type": "decimal",
                    "unit": "mm",
                    "constraints": {"min": 0},
                },
            },
            "child_field_override": {
                "op": "add",
                "type": "category_field",
                "data": {
                    "category": "Hobbies > 3D Printing > Nozzles",
                    "overrides": "nozzle_diameter",
                    "key": "nozzle_diameter",
                    "label": "Nozzle diameter",
                    "type": "decimal",
                    "unit": "mm",
                    "constraints": {"max": 1},
                },
            },
            "project_requirement": {
                "op": "add",
                "type": "project_requirement",
                "data": {
                    "project": "Voron Toolhead Upgrade",
                    "name": "ADXL345 board",
                    "required_quantity": 1,
                    "compatibility": ["Voron StealthBurner"],
                },
            },
            "move_box": {
                "op": "modify",
                "type": "location",
                "match": {"public_id": "loc_BOX_ID"},
                "data": {"parent": "Workshop > Drawer 2"},
            },
            "move_category": {
                "op": "modify",
                "type": "category",
                "match": {"id": 123},
                "data": {"parent": "Hobbies > 3D Printing"},
            },
        }
    )
    return template


FIELD_HELP = {
    "name": (
        "Canonical human-readable name, trimmed at the edges; preserve "
        "spelling and reuse existing entities. Entity-specific uniqueness "
        "is described in the rules."
    ),
    "label": (
        "Human-readable field label; renaming never changes stable field identity or stored values."
    ),
    "description": (
        "Useful explanation of the category property or planned project; empty string clears."
    ),
    "notes": (
        "User-facing free text for constraints, purchase details or evidence; empty string clears."
    ),
    "status": (
        "Explicit lifecycle status from this entity's generated enum; "
        "quantity calculations remain authoritative for satisfaction."
    ),
    "type": (
        "For fields, the accepted stored value type; changing it validates "
        "affected values. For targets, an optional descriptive grouping "
        "such as printer or toolhead."
    ),
    "manufacturer": (
        "Optional canonical target manufacturer, not evidence of compatibility by itself."
    ),
    "model": (
        "Optional target model designation; keep variants in explicit child"
        " targets when materially distinct."
    ),
    "aliases": (
        "Replacement list of target search aliases, globally unique "
        "ignoring case; [] clears aliases. Never create a new target for a "
        "spelling variant."
    ),
    "parent": (
        "Existing compatibility family public ID, canonical name or alias; "
        "null makes a root target. Descendant/self cycles are rejected."
    ),
    "allowed_values": (
        "Exact case-sensitive string choices for enum fields; nonempty and "
        "unique for enum. Other types must use []."
    ),
    "sort_order": "Integer display order; smaller values appear first, within -10000..10000.",
    "overrides": (
        "Ancestor field public ID or closest matching ancestor semantic "
        "key; null for a root definition. Explicit child overrides keep "
        "root value identity and use nearest-category precedence."
    ),
    "category": "Category numeric ID, full path, or unambiguous name. No implicit creation.",
    "project": "Project public_id or unambiguous name; earlier same-batch creation is supported.",
    "item": (
        "Item public_id, unambiguous name, or exact match object with "
        "category/location qualifiers; null means planned/unlinked."
    ),
    "required_quantity": "Positive decimal need, at most 3 fractional digits.",
    "inventory_quantity": (
        "Explicit physical stock allocation, at most 3 fractional digits; "
        "linking alone allocates zero."
    ),
    "acquired_quantity": (
        "Nonnegative physically obtained stock outside inventory; no double"
        " counting with allocated inventory."
    ),
    "purchased_quantity": (
        "Nonnegative outstanding purchased/ordered stock; not yet physically acquired."
    ),
    "reserve": "Optional hold on allocated inventory, without reducing global stock.",
    "key": (
        "Stable reusable snake_case semantic key. Root key rename preserves"
        " IDs and propagates to its overrides."
    ),
    "default": (
        "Optional default validated by the chosen field type; applied when "
        "a value is absent on item creation/field edits."
    ),
    "nullable": "Whether explicit null is an allowed stored field value.",
    "required": (
        "Whether an applicable field must be present on item creation or field/category edits."
    ),
    "constraints": (
        "Typed numerical/length/precision validation bounds; generated "
        "FieldConstraints schema is authoritative."
    ),
    "unit": "Unit label only; no automatic numerical conversion.",
    "active": (
        "False deactivates the definition or target while retaining "
        "historical values/relationships."
    ),
    "compatibility": (
        "Existing target public IDs or unambiguous canonical names/aliases."
        " No implicit target creation."
    ),
}
