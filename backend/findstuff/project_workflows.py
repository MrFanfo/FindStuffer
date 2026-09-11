"""Atomic, retry-safe maker project actions. Completion never consumes physical stock."""

import json

from .db import transaction
from .extension_schemas import Project, ProjectRequirement
from .import_protocol import identity, receipt
from .inventory import ConflictError, create_item, get_item_row, new_public_id, to_milli
from .projects import project_detail, save_project, save_requirement


def project_action(connection, public_id, payload):
    request = {
        "import_id": payload["request_id"],
        "operations": [{"project": public_id, **payload}],
    }
    with transaction(connection):
        previous = receipt(connection, request)
        if previous:
            return previous
        source = project_detail(connection, public_id)
        action = payload["action"]
        if action == "clone":
            values = {key: source[key] for key in Project.model_fields}
            values.update(name=payload["name"], status="planned")
            result = save_project(connection, values)
            for row in source["requirements"]:
                if row["status"] == "cancelled":
                    continue
                values = {key: row[key] for key in ProjectRequirement.model_fields}
                values.update(
                    project=result["public_id"],
                    inventory_quantity=0,
                    purchased_quantity=0,
                    acquired_quantity=0,
                    actual_spent_minor=0,
                    reserve=False,
                    status="needed",
                )
                save_requirement(connection, values)
            for row in connection.execute(
                "SELECT * FROM project_files WHERE project_id=?", (source["id"],)
            ).fetchall():
                connection.execute(
                    (
                        "INSERT INTO "
                        "project_files(public_id,project_id,name,mime_type,file_path,size_byt"
                        "es) VALUES(?,?,?,?,?,?)"
                    ),
                    (
                        new_public_id("pfl"),
                        result["id"],
                        row["name"],
                        row["mime_type"],
                        row["file_path"],
                        row["size_bytes"],
                    ),
                )
            result = project_detail(connection, result["public_id"])
        else:
            if action == "finish" and source["status"] == "completed":
                raise ConflictError(
                    "Project is already completed; use Create output item to add another output"
                )
            if action == "finish" and not source["ready"]:
                raise ConflictError(

                        "Required stock is missing. Cover required lines before finishing; "
                        "optional lines do not block completion."

                )
            if action == "output" and source["status"] != "completed":
                raise ConflictError("Finish the project before creating additional outputs")
            for data in payload.get("outputs", []):
                item = create_item(connection, data, source="project_output")
                connection.execute(
                    (
                        "INSERT INTO "
                        "project_outputs(project_id,item_id,item_public_id,quantity_milli) "
                        "VALUES(?,?,?,?)"
                    ),
                    (
                        source["id"],
                        get_item_row(connection, item["public_id"])["id"],
                        item["public_id"],
                        to_milli(item["quantity"]),
                    ),
                )
            if action == "finish":
                values = {key: source[key] for key in Project.model_fields}
                values["status"] = "completed"
                save_project(connection, values, public_id)
            result = project_detail(connection, public_id)
        import_id, digest = identity(request)
        connection.execute(
            "INSERT INTO import_receipts(import_id,payload_hash,result_json) VALUES(?,?,?)",
            (import_id, digest, json.dumps(result, default=str)),
        )
        return result
