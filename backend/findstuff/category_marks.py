"""The drawings behind category marks, kept as files beside the photos.

Marks are small SVG line drawings stored in the data directory, not compiled into
the interface, so a set can be replaced or extended on a running installation the
way photos are added. The app ships a starting set that is copied in on first use
and can be overwritten afterwards.

Imported drawings are treated as untrusted: only a small vocabulary of shape
elements and geometry attributes survives, and the interface paints them as a
mask rather than putting them in the page, so nothing inside a file can run.
"""

from __future__ import annotations

import re
import shutil
import xml.etree.ElementTree as ElementTree
from pathlib import Path
from typing import Any

from .config import get_settings

MARK_FORMAT = "findstuff-category-marks"
MARK_VERSION = 1
MAXIMUM_MARK_BYTES = 16 * 1024
MARK_NAME = re.compile(r"^[a-z][a-z0-9]{0,31}$")

_SVG = "{http://www.w3.org/2000/svg}"
_ALLOWED_TAGS = {"svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon"}
_ALLOWED_ATTRIBUTES = {
    "viewBox", "xmlns", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
    "stroke-dasharray", "fill-rule", "clip-rule", "transform", "d", "points", "x", "y", "width",
    "height", "rx", "ry", "cx", "cy", "r", "x1", "y1", "x2", "y2", "opacity",
}


def marks_dir() -> Path:
    return get_settings().data_dir / "category-marks"


def _seed_dir() -> Path:
    return Path(__file__).resolve().parent / "seed_marks"


def seed_marks(*, overwrite: bool = False) -> int:
    """Copy the set the app ships with into the data directory.

    Existing files are left alone unless ``overwrite`` is set, so a replaced mark
    survives an upgrade.
    """
    target = marks_dir()
    target.mkdir(parents=True, exist_ok=True)
    written = 0
    for source in sorted(_seed_dir().glob("*.svg")):
        destination = target / source.name
        if destination.exists() and not overwrite:
            continue
        shutil.copyfile(source, destination)
        written += 1
    return written


def list_marks() -> list[str]:
    directory = marks_dir()
    if not directory.exists():
        seed_marks()
    return sorted(path.stem for path in marks_dir().glob("*.svg") if MARK_NAME.match(path.stem))


def read_mark(name: str) -> str | None:
    if not MARK_NAME.match(name):
        return None
    path = marks_dir() / f"{name}.svg"
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8")


def sanitize(svg: str) -> str:
    """Return the drawing with everything but plain shapes removed.

    Raises ``ValueError`` when the file is not a drawing this app can show.
    """
    if len(svg.encode("utf-8")) > MAXIMUM_MARK_BYTES:
        raise ValueError("That drawing is larger than 16 KB.")
    if "<!DOCTYPE" in svg or "<!ENTITY" in svg:
        raise ValueError("A drawing may not declare a document type or entities.")
    try:
        root = ElementTree.fromstring(svg)
    except ElementTree.ParseError as error:
        raise ValueError("That drawing is not valid SVG.") from error
    if root.tag not in {"svg", f"{_SVG}svg"}:
        raise ValueError("A drawing must be an <svg> element.")

    def clean(element: ElementTree.Element) -> ElementTree.Element | None:
        tag = element.tag.replace(_SVG, "")
        if tag not in _ALLOWED_TAGS:
            return None
        keep = ElementTree.Element(tag)
        for key, value in element.attrib.items():
            plain = key.split("}")[-1]
            if plain in _ALLOWED_ATTRIBUTES and "javascript:" not in value.lower():
                keep.set(plain, value)
        for child in element:
            kept = clean(child)
            if kept is not None:
                keep.append(kept)
        return keep

    cleaned = clean(root)
    if cleaned is None or (len(cleaned) == 0 and not cleaned.attrib.get("d")):
        raise ValueError("That drawing has no shapes this app can show.")
    cleaned.set("xmlns", "http://www.w3.org/2000/svg")
    if not cleaned.get("viewBox"):
        cleaned.set("viewBox", "0 0 24 24")
    return ElementTree.tostring(cleaned, encoding="unicode")


def save_mark(name: str, svg: str) -> str:
    if not MARK_NAME.match(name):
        raise ValueError("A mark name is lowercase letters and digits, up to 32 characters.")
    cleaned = sanitize(svg)
    directory = marks_dir()
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{name}.svg").write_text(cleaned, encoding="utf-8")
    return cleaned


def delete_mark(name: str) -> bool:
    if not MARK_NAME.match(name):
        return False
    path = marks_dir() / f"{name}.svg"
    if not path.exists():
        return False
    path.unlink()
    return True


def export_marks() -> dict[str, Any]:
    """Every drawing this installation holds, as one file."""
    return {
        "format": MARK_FORMAT,
        "version": MARK_VERSION,
        "marks": {name: read_mark(name) or "" for name in list_marks()},
    }


def import_marks(payload: dict[str, Any], *, apply: bool = False) -> dict[str, Any]:
    """Read a drawing set, reporting what it holds before anything is written."""
    if payload.get("format") != MARK_FORMAT:
        raise ValueError("That file is not a Findstuff category mark set.")
    marks = payload.get("marks")
    if not isinstance(marks, dict) or not marks:
        raise ValueError("That set has no drawings.")
    existing = set(list_marks())
    added: list[str] = []
    replaced: list[str] = []
    rejected: list[dict[str, str]] = []
    for name, svg in marks.items():
        name = str(name)
        try:
            cleaned = sanitize(str(svg))
        except ValueError as error:
            rejected.append({"name": name, "reason": str(error)})
            continue
        if not MARK_NAME.match(name):
            rejected.append({"name": name, "reason": "The name is not a plain mark name."})
            continue
        (replaced if name in existing else added).append(name)
        if apply:
            (marks_dir() / f"{name}.svg").write_text(cleaned, encoding="utf-8")
    return {
        "applied": apply,
        "added": sorted(added),
        "replaced": sorted(replaced),
        "added_count": len(added),
        "replaced_count": len(replaced),
        "rejected": rejected[:50],
        "rejected_count": len(rejected),
    }
