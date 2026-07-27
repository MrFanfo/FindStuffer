# Bulk JSON operations

Findstuff can import normal exports and operation files. Operation files use
`findstuff-ops-v1` and run entries in order, top to bottom.

Use this flow from the app:

1. Open **Manage > Backup & data > Import JSON**.
2. Choose a `.json` file.
3. Review the preview counts and errors.
4. Click merge only when the preview is valid.

Operation imports are useful when you want to seed or maintain inventory from a
human-written JSON file instead of clicking through the UI.

Imports are designed to be repeatable. Adding a category or location that
already exists in the same parent is skipped and counted as `skipped`, so a seed
file can be run again without blocking on duplicates. Other operation failures
are reported in the import error log with the operation number, operation type,
record name/path/barcode when available, and the database reason; the importer
continues with later operations where possible and shows every failed row in the
log.

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

Notes:

- `quantity` and `low_stock_threshold` can be strings or numbers, with up to
  three decimal places.
- Currency fields must be three-letter codes such as `EUR` or `USD`.
- Price fields are minor units: cents for EUR/USD.
- `expiration_date` uses `YYYY-MM-DD`.
- `tags` replaces the item tag list when supplied.
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
