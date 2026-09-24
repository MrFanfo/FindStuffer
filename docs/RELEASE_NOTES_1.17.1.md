# Findstuff 1.17.1

A container's contents become a compact, searchable list, moving something out
of a box uses the place picker, and closing an item on iPhone no longer leaves
the page zoomed in. No database changes: upgrading from 1.17.0 needs no
migration.

## Inside a container

- **One row per item**: photo, name, the last level of its category and its
  quantity (or, for a box inside the box, how many it holds). Items low on
  stock are marked on their row.
- **Add** and **Move in** are two small buttons beside the summary at the top.
  Adding opens a short card (name, quantity and unit, category); moving in is a
  search whose results show where each item is now.
- **A filter** appears when a box holds more than eight kinds of item.
- **Move out** is a small button on each row and opens the **place picker**
  with the tree of places, starting where the box is, instead of a long
  dropdown. Choosing a place takes the item out of the box and puts it there.

## Browsing

- Inside a category or place, group headings leave out the part you are
  already in: inside Electronics a group reads "Computer Electronics >
  Keyboards". Items filed directly in the open category or place come first
  under its name.

## iPhone

- Closing an item no longer zooms the page in. Closing returns to the row you
  opened it from, and form fields use text large enough that Safari does not
  zoom when one is tapped.
- Place and category pickers are no longer covered by the item's action bar
  at the bottom of the screen.
