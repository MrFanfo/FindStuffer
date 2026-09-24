# Findstuff 1.15.0

Every category now carries a mark of its own, the inventory row shows it, and the
item screen reads as facts rather than as a form. One database change: categories
gain an `icon` column, applied automatically on first start.

## A mark for every category

- Each category — all of them, at every depth — gets its own mark, chosen by
  reading the whole category path with the category's own name counting for more
  than the branch it hangs under. "Electronic Connectors" gets the connector, not
  the chip; "Power Tools" gets the drill, not the plug.
- Tapping a mark in the inventory list filters by that category, the same way
  tapping a place filters by that place.
- The mark beside each category in the category tree opens a searchable picker of
  every mark on the server, so any choice can be overruled by hand.
- **Suggest marks** fills in categories that have none and never touches one that
  was chosen by hand.

## Marks are files, not part of the app

The drawings live in the data directory beside the photos, not inside the
interface, so a set can be replaced on a running installation:

- The app ships 177 line drawings, installed into `data/category-marks/` on first
  start. A drawing replaced there survives upgrades.
- `GET /api/v1/category-marks` lists them, `…/<name>.svg` serves one, `PUT`
  saves one, `DELETE` removes one.
- **Export set** saves the drawings and the per-category assignments as one file;
  **Import set** reads it back, showing what it holds before anything is written.
- Imported drawings are cleaned: only plain shapes and geometry survive, scripts,
  event handlers and remote references are dropped, and the interface paints them
  as a mask, so a drawing can never run anything in the page.

## The item screen

- **Properties** now read as label and value rows with the unit beside the number
  and an "inherited" tag where a value comes from the category, instead of the
  browser's default indented list.
- **Overview** opens with the item's own facts — brand, model, what it cost, what
  it is worth, size, weight, the low-stock point and when it was added — and only
  lists the ones that are recorded. The barcode follows them rather than leading.
- **Activity** shows its events instead of a closed drawer.
- The header no longer runs a project reservation into the category beside it.
- Sections, headings and rows are tighter on phones.
