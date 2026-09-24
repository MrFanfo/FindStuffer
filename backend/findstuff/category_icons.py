"""Category marks: which icon stands for a category, and how a set moves between
installations.

Every category can carry an icon name from the app's own set. Categories without
one inherit the nearest ancestor's mark, so a handful of choices high in the tree
already dresses a deep tree. ``suggest`` reads a category's own words to pick a
first mark, which the owner is free to overrule.
"""

from __future__ import annotations

import re
import sqlite3
from typing import Any

ICON_SET_VERSION = 1

# One mark per kind of thing. Matching prefers the category's own name over its
# ancestors', and the longest matching keyword within each, so the order of this
# table is for reading rather than for precedence.
KEYWORD_ICONS: tuple[tuple[str, tuple[str, ...]], ...] = (
    # Electronics
    # Electronics: parts before the boards and kits that hold them.
    ("resistor", ("resistor", "resistenz", "potentiometer", "trimmer", "rheostat")),
    ("capacitor", ("capacitor", "condensator", "electrolytic", "ceramic cap", "tantalum")),
    ("inductor", ("inductor", "induttor", "choke", "ferrite", "coil")),
    ("crystal", ("crystal", "quarzo", "resonator")),
    ("oscillator", ("oscillator", "oscillatore", "clock gen")),
    ("diode", ("diode", "diodi", "diodo", "rectifier", "schottky", "zener", "tvs")),
    ("led", ("led", "neopixel", "ws2812", "addressable")),
    ("transistor", ("transistor", "bjt", "darlington")),
    ("mosfet", ("mosfet", "igbt", "fet")),
    ("relay", ("relay", "relè", "rele", "contactor")),
    ("switch", ("switch", "interruttor", "toggle", "rocker", "microswitch", "limit")),
    ("button", ("button", "pulsant", "tactile", "keypad")),
    ("fuse", ("fuse", "fusibil", "ptc", "breaker")),
    ("motor", ("motor", "motori", "brushless", "dc motor")),
    ("servo", ("servo",)),
    ("stepper", ("stepper", "nema")),
    ("heatsink", ("heatsink", "dissipator", "thermal pad", "cooling")),
    ("sensor", ("sensor", "sensori", "detector", "thermistor", "encoder", "imu", "accelerom")),
    ("display", ("display", "screen", "lcd", "tft", "monitor", "schermo")),
    ("oled", ("oled", "e-ink", "eink", "epaper")),
    ("buzzer", ("buzzer", "cicalino", "piezo")),
    ("microphone", ("microphone", "microfon", "mic ")),
    ("antenna", ("antenna", "antenne", "aerial")),
    ("usb", ("usb",)),
    ("dupont", ("dupont", "jumper", "header", "pin strip")),
    ("banana", ("banana", "alligator", "probe")),
    ("terminalblock", ("terminal", "morsett", "screw block", "wago")),
    ("breadboard", ("breadboard", "protoboard", "perfboard", "stripboard")),
    ("multimeter", ("multimeter", "multimetro", "tester", "meter", "clamp meter")),
    ("oscilloscope", ("oscilloscope", "oscilloscopio", "logic analyser", "logic analyzer")),
    ("powersupply", ("power supply", "alimentator", "bench supply", "psu")),
    ("converter", ("converter", "convertitor", "buck", "boost", "regulator", "inverter")),
    ("charger", ("charger", "caricabatt", "charging")),
    ("sdcard", ("sd card", "microsd", "memory card", "eeprom", "flash memory")),
    ("rfid", ("rfid", "nfc", "tag reader")),
    ("gps", ("gps", "gnss", "glonass")),
    ("bluetooth", ("bluetooth", "ble ")),
    ("ethernet", ("ethernet", "rj45", "lan ", "poe")),
    ("pcb", ("pcb", "circuit board", "board", "schede", "shield board", "hat ")),
    ("connector", ("connector", "terminal", "header", "jst", "dupont", "connettor")),
    ("cable", ("cable", "wire", "cavo", "cavi", "cord", "usb", "hdmi", "ethernet")),
    ("battery", ("battery", "batteries", "batteria", "batterie", "cell", "18650", "lipo")),
    ("flashlight", ("flashlight", "torch", "torcia", "headlamp", "lantern")),
    ("gamepad", ("gaming", "game console", "consoles", "controller", "gamepad", "console")),
    ("phone", ("phone", "smartphone", "telefon", "tablet")),
    ("wifi", ("network", "networking", "router", "wifi", "wi-fi", "modem", "antenna")),
    ("drive", ("storage", "drive", "ssd", "hard disk", "memory card", "sd card", "usb stick")),
    ("fan", ("fan", "ventola", "cooling", "duster", "blower", "air")),
    ("laser", ("laser", "pointer")),
    ("target", ("tracker", "airsoft", "softair", "shooting", "target")),
    ("case", ("enclosure", "case", "housing", "box for", "project box")),
    ("monitor", ("monitor", "display", "screen", "computer", "laptop", "pc ")),
    ("speaker", ("speaker", "audio", "sound", "amplifier", "altoparlant")),
    ("headphones", ("headphone", "headset", "earphone", "cuffi")),
    ("solder", ("solder", "saldat", "flux", "workbench", "rework")),
    ("chip", (
        "electronics", "elettronica", "component", "componenti", "board", "circuit", "module",
        "sensor", "microcontroll", "esp32", "arduino", "raspberry"
    )),
    ("plug", ("power", "charger", "adapter", "alimentazione", "psu", "supply", "outlet", "presa")),
    # Hobbies and making
    ("printer3d", ("3d print", "3d-print", "filament", "resin print", "stampa 3d")),
    ("drone", ("drone", "quadcopter", "rc and", "rc ", "radio control")),
    ("plane", ("model making", "modell", "aeroplane", "airplane", "scale model")),
    ("cube3", ("rubik", "cube", "speedcube", "puzzle")),
    ("spinner", ("fidget", "spinner", "toy", "giocatt")),
    ("knife", ("balisong", "knife", "knives", "coltell", "blade", "edc")),
    ("palette", ("art supplies", "art ", "paint", "pittur", "colour", "color", "acrylic", "draw")),
    ("scissors", ("cricut", "cutting mach", "vinyl", "craft cut", "plotter")),
    ("layers", (
        "leather", "pelle", "cuoio", "raw material", "material", "sheet", "foglio", "fabric",
        "tessut", "textile"
    )),
    ("camera", ("photograph", "fotograf", "camera", "lens", "obiettiv")),
    ("pencil", (
        "stationery", "cancelleria", "pen ", "pencil", "notebook", "quadern", "office", "ufficio"
    )),
    ("book", ("book", "libri", "bookbinding", "legatoria", "binding", "manual")),
    ("spool", ("thread", "filo", "yarn", "sewing", "cucito", "wool", "lana", "ribbon")),
    ("spark", ("maker project", "hobby", "hobbies", "project")),
    # Tools
    ("clamp", ("clamp", "vise", "vice", "morsett")),
    ("broom", ("cleaning tool", "broom", "brush tool", "scopa", "dust")),
    ("ruler", ("measur", "misur", "caliper", "calibro", "ruler", "righello", "gauge", "level")),
    ("hammer", ("hammer", "martell", "mallet", "hand tool", "utensil")),
    ("screwdriver", (
        "screwdriver", "cacciavit", "nut driver", "driver", "bit ", "hex key", "allen"
    )),
    ("magnifier", ("optical", "inspection", "microscope", "magnif", "lente")),
    ("roller", ("painting tool", "roller", "rullo", "spray gun")),
    ("drill", ("power tool", "drill", "trapano", "driver drill", "rotary")),
    ("punch", ("punch", "awl", "fustell", "rivet")),
    ("sandblock", ("sanding", "sandpaper", "abrasive", "carta vetr", "file", "lima", "rasp")),
    ("scissors", ("cutting tool", "shear", "snips", "forbic", "cutter")),
    ("toolbox", ("tool storage", "toolbox", "tool chest", "organiser", "organizer")),
    ("tape", ("consumable", "tape", "nastro", "adhesive", "glue", "colla")),
    ("wrench", ("tool", "attrezz", "workshop", "officina", "garage", "repair", "riparazion")),
    # Home
    ("shower", ("bathroom", "bagno", "shower", "doccia", "toilet")),
    ("spray", ("cleaning", "puliz", "detergent", "disinfect", "sanitis", "sanitiz")),
    ("washer", ("laundry", "bucato", "washing", "lavatric", "detersiv")),
    ("chair", ("furniture", "mobil", "chair", "table", "shelf unit")),
    ("shield", ("safety", "sicurezza", "protection", "protezion", "ppe", "first aid")),
    ("boxes", ("home storage", "storage", "container", "contenitor", "bin ", "bins")),
    ("package", ("packaging", "shipping", "imballagg", "spedizion", "parcel", "envelope")),
    ("shirt", ("textile", "clothing", "abbigliament", "fabric home", "linen", "towel", "bedding")),
    ("bolt", (
        "fastener", "screw", "vite", "viti", "bolt", "nut", "dado", "washer hardware", "hardware",
        "ferramenta", "nail", "chiodi"
    )),
    ("home", ("home", "casa", "appliance", "elettrodomest", "household")),
    # Food
    ("wheat", ("baking", "flour", "farina", "bread", "pane", "pasta", "cereal")),
    ("can", ("canned", "tin ", "scatolett", "conserve", "preserved")),
    ("cup", (
        "drink", "bevand", "coffee", "caffè", "caffe", "tea", "tè", "juice", "water", "acqua"
    )),
    ("bottle", (
        "bottle", "bottigli", "oil", "olio", "vinegar", "aceto", "wine", "vino", "beer", "birra",
        "sauce", "liquid"
    )),
    ("snowflake", ("freezer", "frozen", "congelat", "surgelat", "ice")),
    ("fridge", ("fridge", "frigo", "refrigerat", "chilled", "dairy", "latticin")),
    ("jar", ("pantry", "dispensa", "jar ", "preserve", "barattol")),
    ("paw", ("pet ", "pets", "animal", "cane", "gatto", "dog", "cat ")),
    ("cookie", (
        "snack", "biscuit", "biscott", "sweet", "dolci", "candy", "caramell", "chocolate",
        "cioccolat"
    )),
    ("shaker", ("spice", "spezie", "seasoning", "condiment", "salt", "sale", "pepper", "pepe")),
    ("cutlery", (
        "food", "cibo", "aliment", "grocer", "spesa", "kitchen", "cucina", "meal", "cooking"
    )),
    # Garden
    ("seeds", ("seed", "semi", "sement", "bulb plant", "germin")),
    ("soil", (
        "soil", "terra", "substrate", "substrat", "compost", "fertilis", "fertiliz", "concim"
    )),
    ("wateringcan", ("watering", "irrigat", "annaffi", "hose", "sprinkler")),
    ("pot", ("plant pot", "vaso", "vasi", "planter", "pot ", "pots")),
    ("bug", ("pest", "insett", "parassit", "repellent", "trap")),
    ("bulb", ("grow light", "lamp", "lampad", "lighting", "luce", "led strip", "light")),
    ("shovel", ("gardening tool", "spade", "shovel", "pala", "rake", "trowel")),
    ("tag", ("label", "etichett", "marker", "tagging")),
    ("leaf", ("garden", "giardin", "plant", "piant", "flower", "fiori", "outdoor", "herb")),
    # Anything else keeps the neutral mark.
)

_ICON_PATTERN = re.compile(r"^[a-z][a-z0-9]{0,31}$")
_KEYWORD_PATTERNS: dict[str, re.Pattern[str]] = {}


def _keyword_pattern(keyword: str) -> re.Pattern[str]:
    """Keywords match at the start of a word, so "cord" does not find "Ricordi".

    A keyword written with a trailing space must match a whole word, which keeps
    "pot " off "potato".
    """
    pattern = _KEYWORD_PATTERNS.get(keyword)
    if pattern is None:
        body = re.escape(keyword.strip())
        tail = r"(?![a-z])" if keyword.endswith(" ") else ""
        pattern = re.compile(rf"(?<![a-z0-9]){body}{tail}", re.IGNORECASE)
        _KEYWORD_PATTERNS[keyword] = pattern
    return pattern


def is_icon_name(value: str) -> bool:
    """Icon names are short identifiers; the interface owns the drawings."""
    return bool(_ICON_PATTERN.match(value))


def suggest(path: str) -> str:
    """The mark a category's own words point to, or the neutral tag.

    The whole path is read, with the category's own name counting for more than
    the branch it hangs under: "Electronics > Electronic Connectors" reaches the
    connector rather than the chip, while "Electronics > Portable Power" reaches
    the plug. Within each, the most specific keyword wins, so "Power Tools" reaches
    the drill rather than the plug it also matches.
    """
    parts = [part.strip().lower() for part in path.split(">") if part.strip()]
    if not parts:
        return "tag"
    leaf, ancestors = parts[-1], " ".join(parts[:-1])
    best_icon = "tag"
    best_score = 0
    for icon, keywords in KEYWORD_ICONS:
        for keyword in keywords:
            pattern = _keyword_pattern(keyword)
            length = len(keyword.strip())
            # The leaf names the thing; its ancestors only say where it sits.
            if pattern.search(leaf):
                score = length * 2
            elif pattern.search(ancestors):
                score = length
            else:
                score = 0
            if score > best_score:
                best_icon, best_score = icon, score
    return best_icon


def _category_paths(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = [
        dict(row)
        for row in connection.execute("SELECT id, parent_id, name, slug, icon FROM categories")
    ]
    by_id = {row["id"]: row for row in rows}
    for row in rows:
        parts: list[str] = []
        current: dict[str, Any] | None = row
        seen: set[int] = set()
        while current is not None and current["id"] not in seen:
            seen.add(current["id"])
            parts.append(current["name"])
            parent_id = current["parent_id"]
            current = by_id.get(parent_id) if parent_id is not None else None
        row["path"] = " > ".join(reversed(parts))
    rows.sort(key=lambda row: row["path"].lower())
    return rows


def suggest_all(connection: sqlite3.Connection, *, overwrite: bool = False) -> dict[str, Any]:
    """Give every category a mark read from its own words.

    Without ``overwrite`` the marks already chosen are left exactly as they are,
    so running this again after hand-picking a few never undoes that work.
    """
    changed = 0
    kept = 0
    for row in _category_paths(connection):
        if row["icon"] and not overwrite:
            kept += 1
            continue
        icon = suggest(row["path"])
        if icon == row["icon"]:
            kept += 1
            continue
        connection.execute("UPDATE categories SET icon = ? WHERE id = ?", (icon, row["id"]))
        changed += 1
    connection.commit()
    return {"updated": changed, "unchanged": kept}


def export_set(connection: sqlite3.Connection) -> dict[str, Any]:
    """The chosen marks, as a file that can be kept or moved to another install."""
    icons = [
        {"slug": row["slug"], "path": row["path"], "icon": row["icon"]}
        for row in _category_paths(connection)
        if row["icon"]
    ]
    return {"format": "findstuff-category-icons", "version": ICON_SET_VERSION, "icons": icons}


def import_set(
    connection: sqlite3.Connection, payload: dict[str, Any], *, apply: bool = False
) -> dict[str, Any]:
    """Match an exported set against this installation's categories.

    Entries are matched on slug first and on the full path second, so a set moves
    between installations that grew their trees separately. Nothing is written
    unless ``apply`` is set, which makes the preview and the change the same call.
    """
    if payload.get("format") != "findstuff-category-icons":
        raise ValueError("That file is not a Findstuff category icon set.")
    entries = payload.get("icons")
    if not isinstance(entries, list):
        raise ValueError("The icon set has no icons.")
    rows = _category_paths(connection)
    by_slug = {row["slug"]: row for row in rows}
    by_path = {row["path"].lower(): row for row in rows}
    matched: list[dict[str, str]] = []
    unmatched: list[str] = []
    invalid: list[str] = []
    for entry in entries:
        if not isinstance(entry, dict):
            invalid.append(str(entry)[:80])
            continue
        icon = str(entry.get("icon") or "")
        name = str(entry.get("path") or entry.get("slug") or "")
        if not is_icon_name(icon):
            invalid.append(name or icon)
            continue
        row = by_slug.get(str(entry.get("slug") or "")) or by_path.get(
            str(entry.get("path") or "").lower()
        )
        if row is None:
            unmatched.append(name)
            continue
        matched.append({"slug": row["slug"], "path": row["path"], "icon": icon})
        if apply and row["icon"] != icon:
            connection.execute("UPDATE categories SET icon = ? WHERE id = ?", (icon, row["id"]))
    if apply:
        connection.commit()
    return {
        "applied": apply,
        "matched": len(matched),
        "unmatched": unmatched[:50],
        "unmatched_count": len(unmatched),
        "invalid": invalid[:50],
        "invalid_count": len(invalid),
    }
