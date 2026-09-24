from __future__ import annotations

from pathlib import Path

import pytest

from findstuff.category_marks import (
    delete_mark,
    export_marks,
    import_marks,
    list_marks,
    read_mark,
    sanitize,
    save_mark,
    seed_marks,
)


@pytest.fixture(autouse=True)
def data_dir(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setenv("FINDSTUFF_DATA_DIR", str(tmp_path))
    return tmp_path


def test_the_shipped_set_installs_itself_once(data_dir: Path) -> None:
    written = seed_marks()
    assert written > 90, "the app ships a full set of marks"
    assert (data_dir / "category-marks" / "resistor.svg").exists()

    (data_dir / "category-marks" / "resistor.svg").write_text("<svg viewBox='0 0 24 24'/>")
    assert seed_marks() == 0, "a second run leaves a replaced mark alone"
    assert read_mark("resistor") == "<svg viewBox='0 0 24 24'/>"

    assert seed_marks(overwrite=True) > 90
    assert "path" in (read_mark("resistor") or "")


def test_marks_are_listed_and_read_by_name() -> None:
    seed_marks()
    names = list_marks()
    assert "resistor" in names and "pliers" in names
    assert (read_mark("resistor") or "").startswith("<svg")
    assert read_mark("../../etc/passwd") is None
    assert read_mark("nothing-here") is None


def test_a_drawing_keeps_only_shapes() -> None:
    cleaned = sanitize(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="steal()">'
        '<script>steal()</script>'
        '<path d="M4 4h16" stroke="currentColor" onclick="steal()"/>'
        '<image href="http://elsewhere/pixel.png"/>'
        "</svg>"
    )
    assert "script" not in cleaned
    assert "onload" not in cleaned and "onclick" not in cleaned
    assert "elsewhere" not in cleaned
    assert 'd="M4 4h16"' in cleaned


def test_a_drawing_that_is_not_a_drawing_is_refused() -> None:
    with pytest.raises(ValueError):
        sanitize("just text")
    with pytest.raises(ValueError):
        sanitize('<svg><!DOCTYPE foo><path d="M0 0"/></svg>')
    with pytest.raises(ValueError):
        sanitize("<svg></svg>")
    with pytest.raises(ValueError):
        sanitize('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>' + "x" * 20000)


def test_a_mark_is_saved_listed_and_removed() -> None:
    seed_marks()
    save_mark("balisong", '<svg viewBox="0 0 24 24"><path d="M4 20 20 4"/></svg>')
    assert "balisong" in list_marks()
    assert delete_mark("balisong") is True
    assert delete_mark("balisong") is False
    with pytest.raises(ValueError):
        save_mark("Bad Name", '<svg viewBox="0 0 24 24"><path d="M4 4"/></svg>')


def test_a_set_travels_as_one_file() -> None:
    seed_marks()
    exported = export_marks()
    assert exported["format"] == "findstuff-category-marks"
    assert len(exported["marks"]) > 90

    preview = import_marks(
        {"format": "findstuff-category-marks", "version": 1, "marks": {
            "resistor": '<svg viewBox="0 0 24 24"><path d="M4 4h4"/></svg>',
            "brandnew": '<svg viewBox="0 0 24 24"><path d="M4 4h4"/></svg>',
            "Bad Name": '<svg viewBox="0 0 24 24"><path d="M4 4h4"/></svg>',
        }}
    )
    assert preview["replaced"] == ["resistor"] and preview["added"] == ["brandnew"]
    assert preview["rejected_count"] == 1
    assert "brandnew" not in list_marks(), "a preview writes nothing"

    import_marks({"format": "findstuff-category-marks", "version": 1, "marks": {
        "brandnew": '<svg viewBox="0 0 24 24"><path d="M4 4h4"/></svg>',
    }}, apply=True)
    assert "brandnew" in list_marks()

    with pytest.raises(ValueError):
        import_marks({"format": "something-else", "marks": {}})
