from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from findstuff.category_icons import export_set, import_set, is_icon_name, suggest, suggest_all
from findstuff.db import connect, migrate
from findstuff.inventory import (
    ConflictError,
    create_category,
    list_categories,
    update_category,
)


@pytest.fixture
def connection(tmp_path: Path) -> sqlite3.Connection:
    path = tmp_path / "icons.sqlite3"
    migrate(path)
    connection = connect(path)
    yield connection
    connection.close()


def _named(connection, name: str, parent_id: int | None = None) -> int:
    return create_category(connection, name, parent_id)["id"]


def test_suggest_reads_the_category_before_its_ancestors() -> None:
    assert suggest("Electronics > Electronic Connectors") == "connector"
    assert suggest("Electronics > Flashlights") == "flashlight"
    assert suggest("Tools > Power Tools") == "drill"
    assert suggest("Hobbies > Rubiks Cubes") == "cube3"
    assert suggest("Garden > Seeds") == "seeds"


def test_a_grouping_word_gives_way_to_the_thing_itself() -> None:
    # "Components" only records that diodes were filed together.
    assert suggest("Electronics > Electronic Components > Diode Components") == "diode"
    assert suggest("Electronics > Passive Components > Resistor Components") == "resistor"
    assert suggest("Home > Raw Materials > Plywood Sheets") == "wood"


def test_the_categorys_own_name_outranks_its_branch() -> None:
    # "Electronics" sits above these, but each name says what it holds.
    assert suggest("Electronics > Flashlights") == "flashlight"
    assert suggest("Electronics > Portable Power") == "plug"
    assert suggest("Electronics > Electronic Boards") == "pcb"
    # A name that says nothing falls back to the branch.
    assert suggest("Tools > Bits and bobs") == "wrench"


def test_suggest_matches_whole_words_only() -> None:
    # "cord" must not be found inside "Ricordi", nor "pot" inside "potatoes".
    assert suggest("Ricordi di famiglia") == "tag"
    assert suggest("Food & Groceries > Potatoes") == "cutlery"


def test_icon_names_are_plain_identifiers() -> None:
    assert is_icon_name("printer3d")
    assert not is_icon_name("../etc/passwd")
    assert not is_icon_name("Chip")
    assert not is_icon_name("")


def test_suggest_all_fills_every_category_and_keeps_the_chosen(connection) -> None:
    bench = _named(connection, "Test Bench")
    drills = _named(connection, "Power Tools", bench)
    odd = _named(connection, "Ricordi di famiglia", bench)
    update_category(connection, odd, {"icon": "camera"})

    suggest_all(connection)

    icons = {category["id"]: category["icon"] for category in list_categories(connection)}
    assert icons[drills] == "drill"
    assert icons[odd] == "camera", "a chosen mark survives a later suggestion run"
    assert all(icons.values()), "every category ends up with its own mark"

    again = suggest_all(connection)
    assert again["updated"] == 0


def test_a_set_exports_and_comes_back_matched_by_slug(connection) -> None:
    tools = _named(connection, "Test Bench")
    update_category(connection, tools, {"icon": "toolbox"})
    exported = export_set(connection)
    assert exported["format"] == "findstuff-category-icons"
    assert exported["icons"] == [
        {"slug": "test-bench", "path": "Test Bench", "icon": "toolbox"}
    ]

    update_category(connection, tools, {"icon": "wrench"})
    preview = import_set(connection, exported)
    assert preview == {
        "applied": False,
        "matched": 1,
        "unmatched": [],
        "unmatched_count": 0,
        "invalid": [],
        "invalid_count": 0,
    }
    def icon_of(category_id: int) -> str:
        return next(row["icon"] for row in list_categories(connection) if row["id"] == category_id)

    assert icon_of(tools) == "wrench", "a preview changes nothing"

    result = import_set(connection, exported, apply=True)
    assert result["applied"] is True
    assert icon_of(tools) == "toolbox"


def test_an_import_reports_what_it_could_not_place(connection) -> None:
    bench = _named(connection, "Test Bench")
    result = import_set(
        connection,
        {
            "format": "findstuff-category-icons",
            "version": 1,
            "icons": [
                {"slug": "test-bench", "path": "Test Bench", "icon": "toolbox"},
                {"slug": "not-here", "path": "Nowhere", "icon": "leaf"},
                {"slug": "test-bench", "path": "Test Bench", "icon": "../evil"},
            ],
        },
        apply=True,
    )
    assert result["matched"] == 1
    assert result["unmatched"] == ["Nowhere"]
    assert result["invalid_count"] == 1
    icons = {row["id"]: row["icon"] for row in list_categories(connection)}
    assert icons[bench] == "toolbox"


def test_an_unknown_file_is_refused(connection) -> None:
    with pytest.raises(ValueError):
        import_set(connection, {"format": "something-else", "icons": []})


def test_a_category_refuses_an_icon_it_cannot_draw(connection) -> None:
    tools = _named(connection, "Test Bench")
    with pytest.raises(ConflictError):
        update_category(connection, tools, {"icon": "../etc/passwd"})
