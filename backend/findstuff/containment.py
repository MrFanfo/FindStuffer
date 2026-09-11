"""Physical containment is independent of category and compatibility relationships."""

from .inventory import ConflictError, NotFoundError, get_item_row, location_path


def resolve_container(connection, reference):
    if isinstance(reference, int) and not isinstance(reference, bool):
        row = connection.execute("SELECT public_id FROM items WHERE id=?", (reference,)).fetchone()
        if not row:
            raise NotFoundError("Container item ID not found")
        return get_item_row(connection, row[0])
    from .extended import _item_public_id_from_match

    if not isinstance(reference, str) or not reference.strip():
        raise ValueError("container_item_id requires an item public ID, numeric ID or exact name")
    found = connection.execute(
        "SELECT public_id FROM items WHERE public_id=?", (reference,)
    ).fetchone()
    return get_item_row(
        connection,
        found[0] if found else _item_public_id_from_match(connection, {"name": reference}),
    )


def validate_parent(connection, parent, item_id=None):
    if not parent["is_container"] or parent["archived_at"]:
        raise ValueError(f"{parent['name']} is not an active container")
    current, seen = parent, set()
    while current:
        if current["id"] == item_id or current["id"] in seen:
            raise ConflictError("An item cannot contain itself or one of its ancestors")
        seen.add(current["id"])
        if len(seen) > 32:
            raise ValueError("Containment is limited to 32 levels")
        current = connection.execute(
            "SELECT * FROM items WHERE id=?", (current["container_item_id"],)
        ).fetchone()
    if item_id is not None:
        depth = connection.execute(
            "WITH RECURSIVE children(id,depth) AS (SELECT ?,0 UNION ALL "
            "SELECT i.id,c.depth+1 FROM items i JOIN children c ON i.container_item_id=c.id "
            "WHERE c.depth<33) SELECT max(depth) FROM children", (item_id,)
        ).fetchone()[0]
        if len(seen) + depth > 32:
            raise ValueError("Moving this subtree would exceed 32 containment levels")


def placement(connection, values, current=None):
    """Pop containment fields and return placement to apply inside the item transaction."""
    marker = object()
    reference = values.pop("container_item_id", marker)
    flag = values.pop("is_container", marker)
    if flag is not marker and not isinstance(flag, bool):
        raise ValueError("is_container must be a boolean")
    parent = current["container_item_id"] if current else None
    if reference is not marker:
        if reference is None:
            parent = None
        else:
            if values.get("location_public_id") not in (None, "", "unassigned"):
                raise ValueError("Choose a direct location or a container, not both")
            container = resolve_container(connection, reference)
            validate_parent(connection, container, current["id"] if current else None)
            parent = container["id"]
            values["location_public_id"] = container["location_public_id"]
    elif current and "location_public_id" in values:
        parent = None  # An explicit location move takes the item out of its container.
    is_container = (
        bool(flag) if flag is not marker else bool(current["is_container"]) if current else False
    )
    if (
        current
        and not is_container
        and connection.execute(
            "SELECT 1 FROM items WHERE container_item_id=?", (current["id"],)
        ).fetchone()
    ):
        raise ConflictError("Move contents out before disabling containment")
    return parent, is_container


def apply_placement(connection, item_id, parent_id, is_container):
    connection.execute(
        "UPDATE items SET is_container=?,container_item_id=? WHERE id=? "
        "AND (is_container!=? OR container_item_id IS NOT ?)",
        (is_container, parent_id, item_id, is_container, parent_id),
    )
    from .inventory import reindex_item

    for row in connection.execute(
        (
            "WITH RECURSIVE contents(id) AS (SELECT ? UNION SELECT i.id FROM "
            "items i JOIN contents c ON i.container_item_id=c.id) SELECT id FROM "
            "contents"
        ),
        (item_id,),
    ):
        reindex_item(connection, row[0])


def item_containment(connection, row):
    chain = []
    current = row["container_item_id"]
    seen = set()
    while current is not None:
        if current in seen:
            raise ConflictError("Item containment cycle")
        seen.add(current)
        parent = connection.execute(
            "SELECT id,public_id,name,container_item_id FROM items WHERE id=?", (current,)
        ).fetchone()
        if not parent:
            raise NotFoundError("Container item missing")
        chain.append({"public_id": parent["public_id"], "name": parent["name"]})
        current = parent["container_item_id"]
    direct = connection.execute(
        "SELECT public_id FROM locations WHERE id=?", (row["direct_location_id"],)
    ).fetchone()
    return {
        "container_item_id": chain[0]["public_id"] if chain else None,
        "is_container": bool(row["is_container"]),
        "direct_location_public_id": direct[0] if direct else None,
        "container_chain": chain,
        "containment_path": "Inside "
        + " > ".join(
            [entry["name"] for entry in chain] + [location_path(connection, row["location_id"])]
        )
        if chain
        else "",
        "contents_count": connection.execute(
            "SELECT count(*) FROM items WHERE container_item_id=? AND archived_at IS NULL",
            (row["id"],),
        ).fetchone()[0],
    }


def batch_containment(connection, rows, paths):
    import json

    identifiers = json.dumps([row["id"] for row in rows])
    parents = {
        row["id"]: row
        for row in connection.execute(
            "WITH RECURSIVE ancestors(id) AS ("
            "SELECT container_item_id FROM items WHERE id IN (SELECT value FROM json_each(?)) "
            "UNION SELECT i.container_item_id FROM items i JOIN ancestors a ON i.id=a.id "
            "WHERE i.container_item_id IS NOT NULL) "
            "SELECT id,public_id,name,container_item_id FROM items WHERE id IN "
            "(SELECT id FROM ancestors)",
            (identifiers,),
        )
    }
    counts = dict(
        connection.execute(
            "SELECT container_item_id,count(*) FROM items WHERE archived_at IS NULL "
            "AND container_item_id IN (SELECT value FROM json_each(?)) GROUP BY "
            "container_item_id",
            (identifiers,),
        )
    )
    result = {}
    for row in rows:
        chain, seen, current = [], set(), row["container_item_id"]
        while current is not None:
            if current in seen or current not in parents:
                raise ConflictError("Invalid containment chain")
            seen.add(current)
            parent = parents[current]
            chain.append({"public_id": parent["public_id"], "name": parent["name"]})
            current = parent["container_item_id"]
        result[row["id"]] = {
            "container_item_id": chain[0]["public_id"] if chain else None,
            "is_container": bool(row["is_container"]),
            "direct_location_public_id": None if chain else row["location_public_id"],
            "container_chain": chain,
            "containment_path": "Inside "
            + " > ".join([value["name"] for value in chain] + [paths[row["location_id"]]])
            if chain
            else "",
            "contents_count": counts.get(row["id"], 0),
        }
    return result
