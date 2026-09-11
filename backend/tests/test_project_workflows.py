import pytest
from test_structured_features import database as database  # noqa: F401

from findstuff.inventory import ConflictError, create_item, get_item
from findstuff.project_workflows import project_action
from findstuff.projects import project_detail, save_project, save_requirement


def test_optional_multiplier_budget_reservations_clone_snapshot_outputs(database):
    item = create_item(database, {"name": "Fan", "quantity": 10})
    project = save_project(
        database,
        {
            "name": "Filter",
            "multiplier": 2,
            "notes": "Build guide",
            "links": [{"label": "Guide", "url": "https://example.com/guide"}],
        },
    )
    save_requirement(
        database,
        {
            "project": project["public_id"],
            "name": "Fan",
            "item": item["public_id"],
            "required_quantity": 2,
            "inventory_quantity": 4,
            "reserve": True,
            "estimated_unit_cost_minor": 500,
            "actual_spent_minor": 1800,
        },
    )
    save_requirement(
        database,
        {
            "project": project["public_id"],
            "name": "Decorative LED",
            "optional": True,
            "estimated_unit_cost_minor": 100,
            "purchased_quantity": 1,
        },
    )
    detail = project_detail(database, project["public_id"])
    assert detail["ready"]
    assert detail["progress"]["percent"] == 100
    assert detail["requirements"][0]["scaled_required_quantity"] == "4"
    assert detail["budget"] == {
        "estimated_total_minor": 2200,
        "actual_spent_minor": 1800,
        "ordered_value_minor": 100,
        "remaining_estimated_minor": 100,
        "unpriced_lines": 0,
    }
    assert get_item(database, item["public_id"])["project_holds"][0]["quantity"] == "4"
    clone = project_action(
        database,
        project["public_id"],
        {"request_id": "clone-filter-1", "action": "clone", "name": "Filter copy"},
    )
    assert clone["multiplier"] == 2
    assert clone["requirements"][0]["inventory_quantity"] == "0"
    assert clone["budget"]["actual_spent_minor"] == 0
    assert not clone["ready"]
    payload = {
        "request_id": "finish-filter-1",
        "action": "finish",
        "outputs": [{"name": "Finished Filter", "quantity": 2}],
    }
    completed = project_action(database, project["public_id"], payload)
    assert completed["status"] == "completed"
    assert completed["completions"][0]["snapshot"]["requirements"][0]["inventory_quantity"] == "4"
    assert get_item(database, item["public_id"])["quantity"] == "10"
    assert not get_item(database, item["public_id"])["project_holds"]
    assert project_action(database, project["public_id"], payload)["replayed"]
    assert database.execute("SELECT count(*) FROM project_outputs").fetchone()[0] == 1
    assert len(completed["completions"][0]["snapshot"]["outputs"]) == 1
    with pytest.raises(ConflictError, match="missing"):
        project_action(
            database, clone["public_id"], {"request_id": "finish-clone-1", "action": "finish"}
        )


def test_project_files_are_validated_and_confined(database, tmp_path, monkeypatch):
    import asyncio
    from tempfile import SpooledTemporaryFile
    from types import SimpleNamespace

    from starlette.datastructures import Headers, UploadFile

    from findstuff import config
    from findstuff.extension_routes import project_file_content, upload_project_file
    from findstuff.inventory import NotFoundError

    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(data_dir=tmp_path))
    project = save_project(database, {"name": "Build guide"})
    contents = SpooledTemporaryFile(max_size=1024)
    contents.write(b"%PDF-1.4\n%%EOF")
    contents.seek(0)
    file = UploadFile(
        contents,
        filename="guide.pdf",
        headers=Headers({"content-type": "application/pdf"}),
    )
    result = asyncio.run(upload_project_file(project["public_id"], database, file))
    attachment = result["files"][0]
    response = asyncio.run(project_file_content(attachment["public_id"], database))
    assert response.filename == "guide.pdf"
    invalid_contents = SpooledTemporaryFile(max_size=1024)
    invalid_contents.write(b"not a PDF")
    invalid_contents.seek(0)
    invalid = UploadFile(
        invalid_contents,
        filename="bad.pdf",
        headers=Headers({"content-type": "application/pdf"}),
    )
    with pytest.raises(ValueError):
        asyncio.run(upload_project_file(project["public_id"], database, invalid))
    secret = tmp_path / "configuration.txt"
    secret.write_text("not an attachment")
    database.execute(
        "UPDATE project_files SET file_path=? WHERE public_id=?",
        ("configuration.txt", attachment["public_id"]),
    )
    with pytest.raises(NotFoundError):
        asyncio.run(project_file_content(attachment["public_id"], database))


def test_project_completed_export_preserves_snapshot_costs_and_outputs(database, tmp_path):
    from findstuff.db import connect, migrate
    from findstuff.extended import apply_import_merge, export_inventory

    project = save_project(database, {"name": "Assembly", "multiplier": 3, "currency": "USD"})
    save_requirement(
        database,
        {
            "project": project["public_id"],
            "name": "Bought kit",
            "acquired_quantity": 3,
            "required_quantity": 1,
            "estimated_unit_cost_minor": 1500,
            "actual_spent_minor": 4300,
        },
    )
    completed = project_action(
        database,
        project["public_id"],
        {
            "request_id": "assembly-finish-1",
            "action": "finish",
            "outputs": [{"name": "Assembly output", "quantity": 3}],
        },
    )
    path = tmp_path / "portable.sqlite3"
    migrate(path)
    target = connect(path)
    try:
        apply_import_merge(target, export_inventory(database))
        imported = project_detail(target, project["public_id"])
        assert imported["status"] == "completed"
        assert imported["multiplier"] == 3
        assert imported["budget"]["actual_spent_minor"] == 4300
        assert imported["completions"] == completed["completions"]
        assert imported["outputs"] == completed["outputs"]
    finally:
        target.close()
