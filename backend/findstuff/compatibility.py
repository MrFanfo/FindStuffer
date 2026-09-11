"""Reusable targets with explicit relations and visible nearest-ancestor inheritance."""

from __future__ import annotations

from .extension_schemas import CompatibilityTarget
from .inventory import ConflictError, NotFoundError, new_public_id
from .network_security import validate_http_url

STATES = ("compatible", "incompatible", "requires_adapter", "partial", "unknown")


def normalized_target_name(value):
    """Ignore spacing and hyphens for collision checks, never change displayed names."""
    return "".join(
        character for character in value.casefold() if not character.isspace() and character != "-"
    )


def resolve_target(connection, reference):
    if not isinstance(reference, str) or not reference.strip():
        raise ValueError("Compatibility reference requires a public ID, canonical name or alias")
    row = connection.execute(
        (
            "SELECT t.* FROM compatibility_targets t WHERE t.public_id=? OR "
            "t.id IN (SELECT target_id FROM compatibility_names WHERE name=? "
            "COLLATE NOCASE)"
        ),
        (reference.strip(), reference.strip()),
    ).fetchall()
    if len(row) != 1:
        raise NotFoundError(f"Compatibility target not found or ambiguous: {reference}")
    return row[0]


def serialize_target(connection, row):
    parent = connection.execute(
        "SELECT public_id FROM compatibility_targets WHERE id=?", (row["parent_id"],)
    ).fetchone()
    return {
        **{
            key: row[key]
            for key in (
                "public_id",
                "name",
                "manufacturer",
                "model",
                "type",
                "created_at",
                "updated_at",
            )
        },
        "linked_item_ids": [
            entry[0]
            for entry in connection.execute(
                "SELECT i.public_id FROM target_inventory_items r JOIN items i ON i.id=r.item_id "
                "WHERE r.target_id=? ORDER BY i.name,i.id",
                (row["id"],),
            )
        ],
        "active": bool(row["active"]),
        "parent": parent[0] if parent else None,
        "category": row["category_id"],
        "aliases": [
            alias[0]
            for alias in connection.execute(
                (
                    "SELECT name FROM compatibility_names WHERE target_id=? AND "
                    "canonical=0 ORDER BY name"
                ),
                (row["id"],),
            )
        ],
    }


def targets(connection):
    return [
        serialize_target(connection, row)
        for row in connection.execute(
            "SELECT * FROM compatibility_targets ORDER BY name COLLATE NOCASE"
        )
    ]


def ancestor_ids(connection, target_id):
    seen, result = set(), []
    while target_id is not None:
        if target_id in seen:
            raise ConflictError("Compatibility family contains a cycle")
        seen.add(target_id)
        row = connection.execute(
            "SELECT * FROM compatibility_targets WHERE id=?", (target_id,)
        ).fetchone()
        if row is None:
            raise NotFoundError("Compatibility parent not found")
        result.append(target_id)
        target_id = row["parent_id"]
    return result


def save_target(connection, data, public_id=None):
    value = CompatibilityTarget.model_validate(data).model_dump()
    existing = resolve_target(connection, public_id) if public_id else None
    parent = resolve_target(connection, value["parent"]) if value["parent"] else None
    if parent and existing and existing["id"] in ancestor_ids(connection, parent["id"]):
        raise ConflictError("Compatibility family cannot contain a cycle")
    names = list(dict.fromkeys([value["name"], *value["aliases"]]))
    if len({name.casefold() for name in names}) != len(names):
        raise ConflictError("Canonical name and aliases must be distinct")
    for name in names:
        collision = connection.execute(
            "SELECT target_id FROM compatibility_names WHERE name=? COLLATE NOCASE", (name,)
        ).fetchone()
        if collision and (existing is None or collision[0] != existing["id"]):
            raise ConflictError(
                f"Compatibility name or alias already belongs to another target: {name}"
            )
    normalized = {normalized_target_name(name) for name in names}
    for known in connection.execute("SELECT name,target_id FROM compatibility_names"):
        if normalized_target_name(known["name"]) in normalized and (
            existing is None or known["target_id"] != existing["id"]
        ):
            raise ConflictError(
                f"Compatibility spelling duplicates existing target name/alias: {known['name']}. "
                "Reuse that target or explicitly add an alias to it."
            )
    from .extended import _resolve_category_id

    fields = (
        value["name"],
        value["manufacturer"],
        value["model"],
        value["type"],
        parent["id"] if parent else None,
        _resolve_category_id(connection, value["category"]),
        value["active"],
    )
    if existing:
        connection.execute(
            (
                "UPDATE compatibility_targets SET name=?,manufacturer=?,model=?,typ"
                "e=?,parent_id=?,category_id=?,active=?,updated_at=CURRENT_TIMESTAMP"
                " WHERE id=?"
            ),
            (*fields, existing["id"]),
        )
        target_id = existing["id"]
        connection.execute("DELETE FROM compatibility_names WHERE target_id=?", (target_id,))
    else:
        public_id = new_public_id("compat")
        cursor = connection.execute(
            (
                "INSERT INTO compatibility_targets(public_id,name,manufacturer,mode"
                "l,type,parent_id,category_id,active) VALUES(?,?,?,?,?,?,?,?)"
            ),
            (public_id, *fields),
        )
        target_id = cursor.lastrowid
    for index, name in enumerate(names):
        connection.execute(
            "INSERT INTO compatibility_names(name,target_id,canonical) VALUES(?,?,?)",
            (name, target_id, index == 0),
        )
    return serialize_target(connection, resolve_target(connection, public_id))


def item_compatibility(connection, item_id):
    return [
        {
            "public_id": row["public_id"],
            "target": row["target_public_id"],
            "target_name": row["target_name"],
            **{key: row[key] for key in ("status", "notes", "source_url", "adapter")},
            "active": bool(row["active"]),
        }
        for row in connection.execute(
            (
                "SELECT c.*,t.public_id AS target_public_id,t.name AS "
                "target_name,t.active FROM item_compatibility c JOIN "
                "compatibility_targets t ON t.id=c.target_id WHERE item_id=? ORDER "
                "BY t.name"
            ),
            (item_id,),
        )
    ]


def set_item_compatibility(connection, item_id, values, *, allow_inactive=False):
    if not isinstance(values, list) or len(values) > 100:
        raise ValueError("compatibility must be an array of at most 100 relationships")
    normalized, seen = [], set()
    for relation in values:
        if not isinstance(relation, dict) or set(relation) - {
            "target",
            "status",
            "notes",
            "source_url",
            "adapter",
        }:
            raise ValueError(
                "Compatibility relationship supports target, status, notes, source_url and adapter"
            )
        target = resolve_target(connection, relation.get("target"))
        if (
            not target["active"]
            and not allow_inactive
            and not connection.execute(
                "SELECT 1 FROM item_compatibility WHERE item_id=? AND target_id=?",
                (item_id, target["id"]),
            ).fetchone()
        ):
            raise ValueError(f"Compatibility target is inactive: {target['name']}")
        if target["id"] in seen:
            raise ValueError("A target may appear only once in compatibility")
        seen.add(target["id"])
        status = relation.get("status", "compatible")
        if status not in STATES:
            raise ValueError(f"Invalid compatibility status: {status}")
        for field in ("notes", "source_url", "adapter"):
            if not isinstance(relation.get(field, ""), str) or len(relation.get(field, "")) > 2000:
                raise ValueError(f"Compatibility {field} must be text of at most 2000 characters")
        if relation.get("source_url"):
            validate_http_url(relation["source_url"])
        normalized.append(
            (
                target["id"],
                status,
                relation.get("notes", ""),
                relation.get("source_url", ""),
                relation.get("adapter", ""),
            )
        )
    if seen:
        connection.execute(
            "DELETE FROM item_compatibility WHERE item_id=? AND target_id NOT IN "
            f"({','.join('?' for _ in seen)})",
            (item_id, *seen),
        )
    else:
        connection.execute("DELETE FROM item_compatibility WHERE item_id=?", (item_id,))
    for values in normalized:
        connection.execute(
            (
                "INSERT INTO item_compatibility(public_id,item_id,target_id,status,"
                "notes,source_url,adapter) VALUES(?,?,?,?,?,?,?) ON "
                "CONFLICT(item_id,target_id) DO UPDATE SET status=excluded.status,n"
                "otes=excluded.notes,source_url=excluded.source_url,adapter=exclude"
                "d.adapter"
            ),
            (new_public_id("rel"), item_id, *values),
        )


def effective_compatibility(connection, item_id, reference):
    target = resolve_target(connection, reference)
    for ancestor in ancestor_ids(connection, target["id"]):
        relation = connection.execute(
            (
                "SELECT c.*,t.public_id AS target_public_id,t.name AS "
                "target_name,t.active FROM item_compatibility c JOIN "
                "compatibility_targets t ON t.id=c.target_id WHERE c.item_id=? AND "
                "c.target_id=?"
            ),
            (item_id, ancestor),
        ).fetchone()
        if relation and relation["active"]:
            return {
                "status": relation["status"],
                "inherited": ancestor != target["id"],
                "source_target": relation["target_public_id"],
                "source_name": relation["target_name"],
                "notes": relation["notes"],
                "source_url": relation["source_url"],
                "adapter": relation["adapter"],
            }
    return {"status": "unknown", "inherited": False, "source_target": None}


def set_target_links(connection, table, owner_column, owner_id, references):
    # Callers provide only fixed relation-table names.
    if table not in ("project_compatibility", "requirement_compatibility"):
        raise ValueError("Unsupported compatibility owner")
    ids = []
    for reference in references:
        target = resolve_target(connection, reference)
        if not target["active"]:
            raise ValueError(f"Compatibility target is inactive: {target['name']}")
        ids.append(target["id"])
    connection.execute(f"DELETE FROM {table} WHERE {owner_column}=?", (owner_id,))
    for target_id in dict.fromkeys(ids):
        connection.execute(
            f"INSERT INTO {table}({owner_column},target_id) VALUES(?,?)", (owner_id, target_id)
        )


def target_links(connection, table, owner_column, owner_id):
    return [
        row[0]
        for row in connection.execute(
            f"SELECT t.public_id FROM {table} r JOIN compatibility_targets t "
            f"ON t.id=r.target_id WHERE r.{owner_column}=? ORDER BY t.name",
            (owner_id,),
        )
    ]


def compatible_item_ids(connection, reference):
    try:
        target_ids = [resolve_target(connection, reference)["id"]]
    except NotFoundError:
        target_ids = [
            row[0]
            for row in connection.execute(
                "SELECT DISTINCT target_id FROM compatibility_names WHERE name LIKE ?",
                (f"%{reference}%",),
            )
        ]
    if not target_ids:
        return []
    return [
        row[0]
        for row in connection.execute(
            "WITH RECURSIVE lineage(target_id,ancestor_id,depth) AS ("
            "SELECT id,id,0 FROM compatibility_targets WHERE active=1 AND id IN "
            f"({','.join('?' for _ in target_ids)}) "
            "UNION ALL SELECT l.target_id,t.parent_id,l.depth+1 FROM lineage l "
            "JOIN compatibility_targets t ON t.id=l.ancestor_id WHERE t.parent_id IS NOT NULL), "
            "ranked AS (SELECT c.item_id,c.status,row_number() OVER(PARTITION "
            "BY c.item_id,l.target_id ORDER BY l.depth) AS rank "
            "FROM item_compatibility c JOIN lineage l ON l.ancestor_id=c.target_id "
            "JOIN compatibility_targets t ON t.id=c.target_id WHERE t.active=1) "
            "SELECT DISTINCT item_id FROM ranked WHERE rank=1 AND status='compatible'",
            target_ids,
        )
    ]


def represented_targets(connection, item_id):
    return [
        serialize_target(connection, row)
        for row in connection.execute(
            "SELECT t.* FROM compatibility_targets t JOIN target_inventory_items r "
            "ON r.target_id=t.id WHERE r.item_id=? ORDER BY t.name",
            (item_id,),
        )
    ]


def set_represented_targets(connection, item_id, references, *, allow_inactive=False):
    if not isinstance(references, list) or len(references) > 50:
        raise ValueError("compatibility_targets must be an array of at most 50 target references")
    ids = set()
    for reference in references:
        target = resolve_target(connection, reference)
        existing = connection.execute(
            "SELECT 1 FROM target_inventory_items WHERE item_id=? AND target_id=?",
            (item_id, target["id"]),
        ).fetchone()
        if not target["active"] and not existing and not allow_inactive:
            raise ValueError(f"Compatibility target is inactive: {target['name']}")
        ids.add(target["id"])
    connection.execute("DELETE FROM target_inventory_items WHERE item_id=?", (item_id,))
    connection.executemany(
        "INSERT INTO target_inventory_items(item_id,target_id) VALUES(?,?)",
        [(item_id, target_id) for target_id in ids],
    )
