from __future__ import annotations

import pytest

from findstuff.db import connect, migrate
from findstuff.inventory import ConflictError
from findstuff.saved_views import SaveViewRequest, delete_view, list_saved_views, save_view


def test_saved_views_preserve_other_views_and_reject_stale_changes(tmp_path):
    path = tmp_path / "views.sqlite3"
    migrate(path)
    connection = connect(path)
    try:

        def request(public_id, name="View", revision=None):
            return SaveViewRequest(
                view={"id": public_id, "name": name, "compatibilityFilter": "Camera"},
                expected_revision=revision,
            )

        first = save_view(connection, "first", request("first"))
        save_view(connection, "second", request("second", "Other"))
        assert first["revision"] == 1
        assert first["compatibilityFilter"] == "Camera"
        with pytest.raises(ConflictError):
            save_view(connection, "first", request("first"))
        updated = save_view(connection, "first", request("first", "Renamed", 1))
        assert updated["revision"] == 2
        with pytest.raises(ConflictError):
            delete_view(connection, "first", 1)
        delete_view(connection, "first", 2)
        assert [view["id"] for view in list_saved_views(connection)] == ["second"]
        with pytest.raises(ConflictError):
            save_view(connection, "first", request("first"))
        with pytest.raises(ConflictError):
            save_view(connection, "first", request("first", revision=3))
        connection.execute(
            "INSERT INTO app_settings(key,value_json) VALUES('inventoryXview:x','{}')"
        )
        assert len(list_saved_views(connection)) == 1
    finally:
        connection.close()
