# Findstuff 1.13.2

The inventory list now loads more items by itself as you scroll, and item cards are
more compact on phones. No database changes: upgrading from 1.13.1 needs no
migration.

## Fixes

- **Loading more no longer jumps to the top.** Pressing "Load more" briefly
  swapped the whole list for a loading placeholder, so the page shrank and the
  browser scrolled back up. The list now stays in place and new items appear
  below where you are.
- **No more "replaceState more than 100 times per 10 seconds" error.** The page
  saved the scroll position into browser history on every scroll event, which
  Safari and Firefox throttle. It now saves at most every 0.4 seconds.
- **The ••• menu on item cards opens fully on desktop.** It was clipped by the card.

## Inventory list

- The next page loads automatically before you reach the end of the list. The
  "Load more" button remains as a fallback, and the list ends with
  "That's everything · N items".
- A **Top** button appears while you scroll back up through a long list.
- Places show the most specific spot first, for example
  **Parts box 3** · Workshop › Shelf B, so truncation trims the broad end.

## On phones

- The quantity now sits between the − and + buttons, so the name and place use
  the full card width. More items fit on screen.
- Low stock and expiry badges sit beside the item name instead of on their own line.
- Archive moved into the ••• menu next to "Delete permanently", leaving one
  action row: −, quantity, +, Move, •••.
- Filters, Bulk mode and the result count share one row, and the heading that
  repeated the active filter is hidden.
