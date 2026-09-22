# Findstuff 1.14.1

Item photos are back in every list density, and the quantity buttons have left
the row. No database changes: upgrading from 1.14.0 needs no migration.

## Photos in every density

1.14.0 hid the photo in **Compact** density, which is the default on phones, so
the list showed placeholders even with "Photo" switched on. Photos now appear in
all three densities: 36px in Compact, 42px in Comfortable, and the full tile in
the photo grid.

## The row is for reading, not for adjusting

The row is now photo, name, place and the current amount. The quantity buttons
have moved into the strip behind the chevron, which also gained **Set amount**:

- `−1` and `+1` sit at the start of the strip, alongside Move, the restock
  action, Archive and Delete.
- Tapping the amount on the row still opens the counted-amount sheet.

The space this frees goes to the photo and to the item's own text, so names and
places survive much further before they are truncated.
