# Documents, warranties, and human search

## Owned documents

Each Item can own PDF, JPEG, PNG, or WebP files up to 20 MB. Supported document
types are receipt, invoice, manual, certificate, warranty, and other. Files live
under `data/documents/`; their metadata and integrity hashes live in SQLite.
Full backups and restore validation include both.

The official container includes Poppler and Tesseract. After upload, Findstuff
extracts available PDF text or runs image OCR in the background. It looks for
serial-number, purchase-date, and warranty-expiry patterns. Extracted values
remain suggestions until the user presses **Apply**. Findstuff never silently
overwrites an existing serial number or user-entered document date.

Warranty reminders use the existing notification delivery. The
`notify_warranty` notification setting defaults to enabled and queues one
deduplicated warning per Item and day when a warranty is within 30 days.

## Human search

`GET /api/v1/search` now uses several conservative layers:

1. FTS prefix search for the original phrase.
2. Singular/plural and built-in synonym variants.
3. User-configured aliases for terms, Items, and Places.
4. A bounded typo-tolerant fallback when the preceding layers have no result.

Search aliases are managed in **Settings → Search language**. A term alias
rewrites a phrase; an Item alias opens a specific record; a Place alias returns
Items in that Place. Search observations store normalized query counts locally
and never leave the Findstuff server. Repeated searches with no result appear
as optional “teach this” suggestions; Findstuff creates no alias until an
administrator explicitly chooses its target and saves it.

## Pagination

`GET /api/v1/items/page` returns:

```json
{
  "items": [],
  "next_cursor": "opaque-or-null",
  "has_more": false
}
```

Cursors are opaque and bind to the deterministic `updated_at, id` ordering.
Clients should pass `next_cursor` unchanged. The legacy list endpoint remains
available for existing integrations, while the web app and bootstrap path use
bounded pages.
