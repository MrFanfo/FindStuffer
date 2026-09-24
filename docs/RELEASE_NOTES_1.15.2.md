# Findstuff 1.15.2

Every category mark now has a drawing behind it, and the item screen loses the
repetition it carried. No database changes: upgrading from 1.15.1 needs no
migration.

## Marks that were missing their drawing

Seventeen marks the suggestion rules point at — chip, wrench, cable, layers,
cutlery, leaf, home and others — were drawn by the interface but never shipped as
files, so a category holding one of them showed nothing at all. All seventeen are
now part of the installed set, which grows to 194 drawings, and "Markers" reaches
the pen rather than a label tag.

## The item screen

- **Properties** drop the "inherited" tag beside a value.
- **Tags** are smaller chips and close the overview, after the description and
  notes, instead of interrupting it.
- **The quantity** appears once. It was written under the place and again in the
  action bar at the bottom; only the action bar keeps it.
- **More** is a set of grouped rows rather than a field of small buttons: where it
  lives (move, category, default place), stock (shopping list, low-stock warning),
  finding it (mark lost), the QR label, and removing it (archive, delete). Each row
  says what it will do.

## Tools

**Inventory on this device** — the offline copy and its refresh — moves from the
Tools landing page into **Tools → Data**, beside backups, exports and restore.
