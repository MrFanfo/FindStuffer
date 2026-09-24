# Findstuff 1.16.0

A category or a place can now be handed to an AI to be filled in, and the item
screen reads more easily on a phone. No database changes: upgrading from 1.15.2
needs no migration.

## Export for AI

**Export for AI**, in the ⋯ menu of any category or place, saves one file with
everything an assistant needs to look the products up and fill in what is
missing:

- **Every item in it, with its complete detail**, apart from its history: name,
  brand, model, barcode, description, notes, size, weight, prices, links, tags,
  where it is and what it is inside, custom field values, compatibility,
  projects, photos, documents with their extracted text, lots, related items,
  maintenance, reservations and earlier barcode lookups. Child categories and
  child places come along, and so does stock inside a box kept in that place.
- **The categories and places involved.** Each category carries its path, its
  settings, its default place and the custom fields it records: type, unit,
  allowed values and limits.
- **The gaps to fill.** An item's custom fields are listed by name, with empty
  ones shown as empty, so it is plain what is missing.
- **The chatbot operations guide**, trimmed to what this file needs, with the
  item fields explained: weight in grams, sizes in millimetres, prices in cents.

Give the file to an assistant, ask it to enrich the items, and import its answer
through **Tools → Data → Import** as usual. The answer changes the items that
are already there, matched by their ID; the preview shows every change before
anything is written. The screen confirms how many items were exported, or says
why an export failed.

The same files are available from `GET /api/v1/categories/{id}/enrichment-export`
and `GET /api/v1/locations/{public_id}/enrichment-export`, with
`include_children=false` to leave child categories or places out.

## The item screen

- **Activity** is a feed: each event has a mark for what happened, the amount
  and unit it changed by, where it moved from and to, and how long ago it was.
  The exact time is shown on hover.
- **Facts** sit two to a row on phones, label above value, and the header takes
  less of the first screen.
- **Dates** are written out: "12 Mar 2027" rather than the stored form, for
  expiry, the date added and warranty ends.
- **Description and notes** are separate blocks, with notes labelled.
- **Links** show the site each one points to beside its label.
- **Photos** can only be deleted while editing, so a tap while browsing cannot
  remove one.
- **Documents** have a small bin icon beside their title in place of a
  full-width Delete button.
