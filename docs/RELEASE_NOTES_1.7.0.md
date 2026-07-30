# Findstuff 1.7.0

Findstuff 1.7.0 adds owned documents and warranties, human-friendly search,
cursor pagination, modular frontend boundaries, and automated browser coverage.

## Highlights

- Attach receipts, invoices, manuals, certificates, warranties, and other PDF
  or image documents to an Item.
- Extract text locally with Poppler/Tesseract and review suggested serial
  numbers, purchase dates, and warranty-expiry dates before applying them.
- Include documents in complete backups and restore validation.
- Receive existing ntfy-style reminders for warranties nearing expiration.
- Find Items through synonyms, plural handling, typo tolerance, and configurable
  term, Item, or Place aliases.
- Act immediately on unsuccessful searches by adding the missing Item or
  locating an existing Item to mark lost.
- Load large inventories through stable opaque cursors instead of relying on a
  hidden 2,000-record ceiling.
- Keep new document, search-feedback, alias, icon, empty-state, and picker UI in
  dedicated frontend modules.
- Verify core flows with Vitest, Testing Library, Playwright desktop/mobile, and
  axe accessibility checks.

## Upgrade notes

Migration `0015_documents_search_pagination.sql` is applied automatically.
The official image now includes `poppler-utils` and `tesseract-ocr`; deployments
using a custom runtime can omit them, but extraction will report
`unavailable` while document storage continues to work.
