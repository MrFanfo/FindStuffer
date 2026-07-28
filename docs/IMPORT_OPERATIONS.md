# Import operations

Findstuff operation files describe a list of inventory changes in JSON. They can
add items, adjust quantities, move or update items, build category and location
trees, or archive records. A single file can contain any mixture of these
changes. Entries run in order, from the top of the `operations` array to the
bottom.

You can write an operation file yourself, but the easiest workflow is to
download Findstuff's template and give it to ChatGPT or another chatbot. The
template is both a machine-readable reference and a prompt: it explains the
schema, lists every supported operation, includes examples, and contains the
current categories, locations, location kinds, and units from your inventory.

The operations workflow is for changing the current inventory. It is different
from **Download JSON export**, which copies the inventory data for backup or
migration.

## Complete chatbot workflow

### 1. Download a fresh template

1. Open **Manage > Backup & data**.
2. Expand **Import operations with a chatbot**.
3. Select **Download operations template**.
4. Findstuff downloads `findstuff-operations-template.json`.

There is one combined template for all operation types. You do not need a
different template for adding items, changing stock, moving items, or creating
categories and locations.

Download a new copy when your category, location, location-kind, or unit lists
have changed. The `_available_*` sections are a snapshot taken when the file is
downloaded. The template's root `operations` array is deliberately empty; the
examples live under `instructions.operation_examples`, so importing an
unchanged template cannot accidentally create example records.

The template can reveal the names and hierarchy of your categories and
locations. Treat it as inventory data when uploading it to an external chatbot.

### 2. Give the template and your request to the chatbot

Attach `findstuff-operations-template.json`, then explain the desired result in
ordinary language. Be precise about quantities and about the existing item,
category, or location to change.

For example:

> Follow the instructions in the attached Findstuff operations template.
> Add 3 USB-C cables to Electronics > Cables in Studio > Drawer 2. Add 2 to
> the quantity of the existing AA batteries, move the soldering iron to
> Workshop > Tool wall, and create Workshop > Components > Connectors as a
> category. Return only the completed JSON, with no Markdown or explanation.

The downloaded file also contains a reusable prompt under
`instructions.suggested_chatbot_prompt`. You can paste it into the conversation
and replace its last line with your requested changes.

For safer results:

- Refer to full category and location paths, especially when names repeat.
- Say whether a number is a new absolute quantity or an amount to add/remove.
- Include a barcode or public ID when two items have the same name.
- Ask the chatbot not to guess. Clarify ambiguous matches before generating the
  file.
- Request only JSON, without a Markdown code fence. If the chatbot displays a
  code block, copy only the JSON inside it into a `.json` file.

The chatbot should return a root object with `format` set to
`findstuff-ops-v1` and an `operations` array. The instructional and
`_available_*` fields may remain in the response; Findstuff ignores them during
the import.

### 3. Preview the chatbot's JSON

1. Save or download the chatbot response with a `.json` extension.
2. Return to **Manage > Backup & data**.
3. Under **Import data**, choose the response file.
4. Wait for the preview.

Preview does not change the live inventory. Findstuff makes a temporary copy of
the current database, validates each operation, and simulates the complete file
in order. This means a later operation can safely refer to a category or
location created by an earlier operation in the same file.

The preview shows:

- counts for all operations, adds, modifications, deletions, categories,
  locations, and items;
- one dry-run result for each operation;
- records that will be skipped because they already exist; and
- errors such as an unknown path, ambiguous name, duplicate item, invalid
  field, or unsafe deletion.

**Merge into this inventory** stays disabled while preview errors exist. Copy
the errors back to the chatbot, ask it to correct the JSON, save the corrected
response, and preview it again. Always review the individual dry-run details,
not only the totals.

### 4. Merge the reviewed operations

When the preview is clean and matches your request, select **Merge into this
inventory**. Findstuff applies the operations in their listed order and refreshes
the inventory.

Adding a category or location that already exists under the same parent is
skipped, so structure-seeding files can be run again. Adding an item with the
same name and category is treated as a duplicate error; use `modify` with
`add_quantity` or `remove_quantity` when the item already exists.

If the live inventory changes between preview and merge, an operation can still
fail. Findstuff reports every failed operation with its number, type, useful
record label, and database reason, and continues with later operations where it
can. Review any reported issues before assuming the entire request was applied.

### 5. Undo or roll back an import

Successful, tracked imports appear under **Recent imports**. Findstuff retains
the latest five import records; when a sixth is created, the oldest undo record
is removed automatically.

Select **Undo** beside an import to reverse its tracked changes. Undo runs the
recorded inverse operations in reverse order: imported additions are removed,
updates are restored to their previous values, and archived records are
restored. An import can be undone once.

Undo is not a replacement for a full backup. Later manual edits or later imports
can depend on the earlier changes and may prevent a clean undo—for example, a
new item may now use a category that the older import created. When several
imports depend on one another, undo the newest dependent import first. Use
**Download full Backup** before a large or high-risk reorganization.

## File shape

```json
{
  "format": "findstuff-ops-v1",
  "operations": [
    {
      "op": "add",
      "type": "location",
      "data": {
        "name": "Studio",
        "kind": "room"
      }
    }
  ]
}
```

Supported `op` values:

- `add`: create a record.
- `modify`: update an existing record.
- `delete`: remove/archive a record.
- Aliases: `create`, `update`, `remove`, `archive`, and `deleted`.

Supported `type` values:

- `location`
- `category`
- `item`

For nested records, prefer full paths such as `Studio > Armadio > Anta sinistra`
or `Electronics > Components > Resistors`. Names are accepted only when they
match exactly one record.

## Matching

`modify` and `delete` operations need a `match` object.

Locations can be matched by:

- `public_id`
- `location_public_id`
- `path`
- `name`
- `location`

Categories can be matched by:

- `id`
- `category_id`
- `path`
- `name`
- `category`

Items can be matched by:

- `public_id`
- `barcode`
- `name`

If a name or barcode matches more than one item/location, the import fails
instead of guessing.

## Locations

Location operations can create, rename, move in the hierarchy, change type,
change description, and delete empty locations.

Accepted location fields in `data`:

- `name`
- `kind`
- `description`
- `parent_public_id`
- `parent`
- `parent_path`
- `parent_name`

Examples:

```json
{
  "format": "findstuff-ops-v1",
  "operations": [
    {
      "op": "add",
      "type": "location",
      "data": { "name": "Studio", "kind": "room" }
    },
    {
      "op": "add",
      "type": "location",
      "data": { "name": "Armadio", "kind": "cabinet", "parent": "Studio" }
    },
    {
      "op": "modify",
      "type": "location",
      "match": { "path": "Studio > Armadio" },
      "data": {
        "name": "Armadio bianco",
        "kind": "cabinet",
        "description": "Main storage cabinet"
      }
    },
    {
      "op": "modify",
      "type": "location",
      "match": { "path": "Studio > Armadio bianco" },
      "data": { "parent": "Soggiorno" }
    },
    {
      "op": "delete",
      "type": "location",
      "match": { "path": "Soggiorno > Armadio bianco" }
    }
  ]
}
```

Delete rules:

- `unassigned` cannot be deleted or moved.
- A location cannot be deleted while it contains child locations or active
  items.
- Move contained items/locations first, then delete.

## Categories

Category operations can create, rename, move in the hierarchy, delete empty
categories, and assign or clear a default location.

Accepted category fields in `data`:

- `name`
- `parent_id`
- `parent`
- `parent_path`
- `parent_name`
- `default_location`
- `default_location_path`
- `default_location_public_id`
- `metadata_enabled`

`metadata_enabled` is an optional object of `true`/`false` switches for
`expiration`, `batches`, `maintenance`, `reservation`, `enrichment`, `photos`,
`identity`, `specs`, `price`, `links`, and `shopping_list`. Use `{}` or `null`
to clear a category-specific override and return to inherited/default behavior.

Category default locations are stored as category default-location rules. When a
category is renamed or moved by an operation, an existing default-location rule
that matched the old category path/name is carried to the new path. When a
category is deleted by an operation, matching category default-location rules
are removed.

Examples:

```json
{
  "format": "findstuff-ops-v1",
  "operations": [
    {
      "op": "add",
      "type": "category",
      "data": { "name": "Electronics" }
    },
    {
      "op": "add",
      "type": "category",
      "data": {
        "name": "Cables",
        "parent": "Electronics",
        "default_location": "Studio > Armadio"
      }
    },
    {
      "op": "modify",
      "type": "category",
      "match": { "path": "Electronics > Cables" },
      "data": {
        "name": "USB cables",
        "parent": "Electronics",
        "default_location": "Studio > Armadio > Anta sinistra"
      }
    },
    {
      "op": "modify",
      "type": "category",
      "match": { "path": "Electronics > USB cables" },
      "data": { "default_location": null }
    },
    {
      "op": "delete",
      "type": "category",
      "match": { "path": "Electronics > USB cables" }
    }
  ]
}
```

Delete rules:

- A category cannot be deleted while it contains child categories or active
  items.
- Move items and subcategories first, then delete.

## Items

Item operations can add, modify, archive, assign location, assign category,
change quantity/unit, update tags, and change normal item metadata.

Accepted item fields in `data`:

- `name`
- `description`
- `notes`
- `category_id`
- `category`
- `category_path`
- `category_name`
- `location_public_id`
- `location`
- `location_path`
- `location_name`
- `quantity`
- `quantity_delta`
- `add_quantity`
- `remove_quantity`
- `unit`
- `purchase_price_minor`
- `purchase_currency`
- `estimated_price_minor`
- `estimated_price_currency`
- `weight_g`
- `length_mm`
- `width_mm`
- `height_mm`
- `serial_number`
- `model`
- `brand`
- `expiration_date`
- `low_stock_threshold`
- `barcode`
- `tags`
- `links`

Notes:

- `quantity` and `low_stock_threshold` can be strings or numbers, with up to
  three decimal places.
- On `modify`, `quantity` replaces the current quantity. `add_quantity` adds a
  positive amount and `remove_quantity` subtracts a positive amount.
  `quantity_delta` is the signed equivalent. If a delta is supplied, it takes
  precedence over an absolute `quantity` in the same operation.
- Currency fields must be three-letter codes such as `EUR` or `USD`.
- Price fields are minor units: cents for EUR/USD.
- `expiration_date` uses `YYYY-MM-DD`.
- `tags` replaces the item tag list when supplied.
- `links` replaces the saved link list and must contain objects with `label` and
  `url`.
- `delete` archives an item. It does not permanently delete the item record.

Examples:

```json
{
  "format": "findstuff-ops-v1",
  "operations": [
    {
      "op": "add",
      "type": "item",
      "data": {
        "name": "ESP32-C3 board",
        "location": "Studio > Armadio > Anta sinistra > Scaffale 1",
        "category": "Electronics > Boards",
        "quantity": "3",
        "unit": "pcs",
        "brand": "Espressif",
        "model": "ESP32-C3",
        "purchase_price_minor": 650,
        "purchase_currency": "EUR",
        "low_stock_threshold": "1",
        "tags": ["electronics", "wifi", "microcontroller"]
      }
    },
    {
      "op": "modify",
      "type": "item",
      "match": { "name": "ESP32-C3 board" },
      "data": {
        "quantity": "5",
        "location": "Studio > Cassettiera sinistra > Cassetto 2",
        "category": "Electronics > Boards",
        "notes": "Moved after restock",
        "tags": ["electronics", "restocked"]
      }
    },
    {
      "op": "add",
      "type": "item",
      "data": {
        "name": "San Benedetto frizzante",
        "barcode": "8023263000534",
        "brand": "San Benedetto",
        "category": "Groceries",
        "location": "Cucina",
        "quantity": "6",
        "unit": "bottle",
        "expiration_date": "2026-12-31"
      }
    },
    {
      "op": "delete",
      "type": "item",
      "match": { "barcode": "8023263000534" }
    }
  ]
}
```

## Full mixed example

```json
{
  "format": "findstuff-ops-v1",
  "operations": [
    { "op": "add", "type": "location", "data": { "name": "Studio", "kind": "room" } },
    { "op": "add", "type": "location", "data": { "name": "Armadio", "kind": "cabinet", "parent": "Studio" } },
    { "op": "add", "type": "location", "data": { "name": "Scaffale 1", "kind": "shelf", "parent": "Studio > Armadio" } },

    { "op": "add", "type": "category", "data": { "name": "Electronics" } },
    {
      "op": "add",
      "type": "category",
      "data": {
        "name": "Boards",
        "parent": "Electronics",
        "default_location": "Studio > Armadio > Scaffale 1"
      }
    },

    {
      "op": "add",
      "type": "item",
      "data": {
        "name": "Arduino Nano clone",
        "category": "Electronics > Boards",
        "location": "Studio > Armadio > Scaffale 1",
        "quantity": "4",
        "unit": "pcs",
        "brand": "Generic",
        "tags": ["arduino", "board"]
      }
    },
    {
      "op": "modify",
      "type": "location",
      "match": { "path": "Studio > Armadio > Scaffale 1" },
      "data": { "name": "Scaffale schede" }
    },
    {
      "op": "modify",
      "type": "item",
      "match": { "name": "Arduino Nano clone" },
      "data": { "location": "Studio > Armadio > Scaffale schede" }
    }
  ]
}
```

## Ready-made location seed

`home-locations.findstuff.json` contains the Italian home/STUDIO location tree.
Import it from **Manage > Backup & data > Import JSON** and merge after preview.
