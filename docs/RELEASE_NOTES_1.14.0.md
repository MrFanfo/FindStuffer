# Findstuff 1.14.0

The inventory list is now one row per item, with the entry points you use most at
the top of the screen. No database changes: upgrading from 1.13.3 needs no
migration.

## A shorter row

Every item used to carry a permanent row of buttons, whether or not you were
going to use them. That row is gone, and an item is now a single line: photo,
name, place and the quantity stepper. About twice as many items fit on a phone
screen.

- Move, Archive, Delete and the restock action wait behind the chevron at the end
  of the row, and open for that row only.
- The place reads most specific part first — **Parts box 3** · Workshop › Shelf B
  — so a narrow row trims the broad end of the path instead of the drawer the
  item is actually in.
- Two markers appear only when they apply: how much of the stock is **held for a
  project**, and how many items are **stored inside** a container. Both prevent a
  wrong decision that the old row could not warn you about.

## Density

A **Display** control sits beside Filters, with three choices:

- **Compact** — the most rows on screen; the default on phones.
- **Comfortable** — photo and place; the default on wider screens.
- **Photo grid** — tiles, for recognising something by sight.

The row fields that used to live in Settings (photo, place, category, quantity,
brand, model) moved into the same control. Density is remembered per device; the
row fields stay shared between your devices, as before.

## One tap to your usual list

Saved views and pinned places now appear as chips under the status filters.
Saved views were behind two taps inside the filter panel; pinned places only
existed on Home. Tapping a chip applies it, and tapping it again clears it. When
you filter by a place that is not pinned, a **Pin this place** chip offers to keep
it there.

## Counting, not stepping

Tapping the quantity opens a sheet where you type the counted amount, with
**Use all up** for an empty shelf. The change is saved as one adjustment with the
same undo as the ± buttons, which matters for items you keep 240 of.

## Filtering by what you see

- Tapping an item's **place** shows everything in that place.
- Tapping its **category** filters to that category.
- Tapping a **Low** or **Expired** badge switches to that status filter.

## Deep in a long list

Scrolling back up brings a small bar to the top of the screen with **Search**,
**Filters** and a jump to the top, so neither the search box nor your filters are
40 rows away. It replaces the earlier Top button.
