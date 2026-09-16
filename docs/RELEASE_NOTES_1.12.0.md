# Findstuff 1.12.0

Interface release. The inventory screen opens on stock instead of controls, wide
screens get a side rail and a content width, the command palette can be driven
from the keyboard, and the screen shown after a crash is no longer the least
finished screen in the app. No database changes: upgrading from 1.11.x needs no
migration.

## Inventory

- The toolbar collapses from twelve permanent controls to four: search, the four
  status chips, a **Filters** button, and the active-filter chips that report
  what is set. Sort, group, category, place, tag, zero-quantity, compatibility
  and the formula builder moved into the Filters panel, which opens at every
  width instead of only on phones.
- The Filters button carries a badge counting the refinements in effect, and the
  result count sits beside it rather than under the heading.
- Saved views moved into the Filters panel and gained a **Save this view** field.
  Saving a view previously required opening the formula builder first.
- **Clear all** moved into the active-filter row, next to the filters it clears.
- On a phone the first item now appears after about 620px of screen instead of
  960px — three items above the fold instead of one. Filter controls are also
  larger: the panel uses the standard 42–48px controls rather than the 38px
  compact toolbar, which has been removed.

## Wide screens

- Above 1100px the bottom tab bar becomes a 214px side rail with the Findstuff
  lockup, labelled destinations and the active marker at the right edge. Below
  1100px the phone tab bar is unchanged.
- Page content stops widening at 1440px and centres, so inventory rows no longer
  stretch the full width of a large monitor with the item name at one edge and
  its actions at the other.
- The toast and the bulk action dock clear the rail, and the 108px of bottom
  padding reserved for the tab bar drops to 48px.

## Home

- The three counts are now task rows: a count, what needs doing, what it would
  fix, and a chevron — `2 items expiring soon · Use them up or plan a
  replacement`. They were already buttons that opened a filtered inventory, but
  read as read-only statistics.
- A count of zero leaves the list entirely rather than showing a row with
  nothing to act on.
- Expiring items carry a red severity stripe, low stock and missing places a
  gold one.

## Command palette

- Arrow keys move through results, **Enter** opens the highlighted one, **Home**
  and **End** jump to the ends, and **Tab** steps forward. The palette previously
  handled only Escape, so reaching a result meant tabbing through every row or
  using the mouse.
- The highlighted row is marked with an accent stripe and exposed through
  `aria-activedescendant`, and a footer names the keys.
- Opened with an empty query, the palette now leads with **Recent** — the last
  items you opened — instead of listing the entire inventory. Recent items are
  stored on the device only.

## Naming

- The **More** tab is now **Tools**; three different things were called "More".
- **Related targets** → **Machines & models**, **Inventory management** →
  **Archive & loans**, **Advanced formula** → **Filter builder**, **Consume** →
  **Use up**, **Voice / AI** → **Ask Findstuff**, **Required metadata** →
  **Fields this category tracks**.
- Tree rows drop the leading `Level N`; the indentation already carries depth.

## Failure and review states

- A screen that throws now renders a proper failure block — icon, heading,
  explanation and two actions. It previously rendered into the inline
  "nothing here" strip, which crushed the heading, body, an unstyled button and a
  raw link onto a single 58px line.
- The import review shows a **Validating…** state while proposals are being
  checked, instead of continuing to present the previous verdict.

## Places and Categories

- The Categories tab now uses the same two-pane layout as Places: tree on the
  left, detail on the right, collapsing to a single pane on phones. The category
  detail page was rebuilt to match the place detail page — same heading, same
  overflow menu, same sections, same close button.
- The detail heading actions line up with the controls above the pane, and the
  overflow and close buttons share a baseline.
