# Findstuff 1.17.0

Places and categories become quicker to browse: a box stands in for what is
inside it, empty branches can be hidden, rows are one line with an icon, and
places get icons of their own. Low stock can be switched off per category, and
leaving an item while editing saves it. One database change: places gain an
`icon` column, applied automatically on first start.

## Browsing places and categories

- **A box instead of its contents.** A category lists the items that are not
  inside anything, plus the box holding the rest, marked with how many of them
  it holds ("12 inside"), whatever category the box itself is in. Boxes inside
  boxes count toward the outermost one. The place view already worked this way;
  its boxes now say how many items they hold too, and both headings still give
  the full total. Inventory and search still list every item on its own.
- **Hide empty** replaces the print-queue button in Places. It hides places and
  categories with nothing in them or below them, both in the lists and inside a
  place or category.
- **One-line rows.** Places and categories show their top level as one line
  each: icon, name, what they hold and the menu, with no expand arrow. Opening a
  row lists what is inside it, as compact rows with the name on the left.
- **Item lists** inside a place or category are compact, give names two lines
  so similar items can be told apart, and show the right thing under each name:
  where the item is in a category, its category in a place.
- **Containers are tinted a faint purple** wherever they are listed: inventory,
  places and categories, a box's contents and search.

## Icons for places

Places get an icon like categories: tap it in the place's row to choose one.
A place without one shows a guess from its name or kind, in English and Italian
(cucina, bagno, frigorifero, armadio, scaffale, cassetto, garage and more),
then its parent's icon, then a box.

Icons now travel with the general import and export, so the separate category
icon tools are gone from Tools → Data:

- the operations template has an `icon` field for categories and places and
  lists the icons available;
- a full export imports categories and places with their icons, keeping any
  icon already chosen on this installation.

Six suggested category icons (vehicles, keys, medicine, sport, paper, art) had
no drawing and showed blank; they now point to installed drawings.

## Low stock per category

"Low stock warning" joins the fields a category can switch on or off, beside
expiration, fullness and the rest, and follows the same inheritance. For items
where it is off, the field and the "Set low stock warning" action disappear,
and the item is never counted or listed as low stock: the Low stock filter,
Home, analytics, notifications, Home Assistant, the AI tools and the low-stock
shopping list all leave it out. A threshold already set is kept.
"Set low stock warning" now opens the editor on that field, ready to type.

## Editing an item

- **Leaving saves.** Closing an item while editing (the X, Escape, tapping
  outside) or the app going to the background saves what was typed and ends
  editing, so the item no longer reopens in edit mode. If the save fails —
  offline, or an invalid value — the item stays open with the reason, the
  draft is kept on the device and saved the next time the item opens.
- **Storage** is two plain rows: "Holds other items" with a switch, and "Put
  inside another item", which says where it is now.
- On iPhone, date fields no longer run past the edge of the card.

## Item screen

- Long property values read under their label instead of squeezing it to one
  letter per line.
- In the More tab the QR label is centred and the Remove group lays out like
  the others.

## Tools

- **QR labels** is a new card that opens the print queue and says how many
  labels are waiting.
