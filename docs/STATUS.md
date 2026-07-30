# Implementation status

Updated: 2026-07-30

## Working now

- FastAPI application with generated OpenAPI documentation.
- Versioned SQLite migration containing the planned MVP entities.
- WAL, foreign keys, busy timeout, and FTS5.
- Single-owner administrator authentication with signed browser sessions, CSRF
  protection, login throttling, and HTTP Basic support for API clients.
- Recursive location tree with cycle protection and protected Unassigned location.
- Item create, list, search, edit API, archive/restore, quantity adjustment, and move.
- Decimal-safe quantity storage in thousandths.
- Append-only inventory events and optimistic item versions.
- FTS search across descriptions, product fields, category, tags, and full
  location paths, with synonyms, plural handling, fuzzy fallback, and
  configurable term, Item, and Place aliases.
- Cursor-paginated inventory APIs and progressive frontend loading.
- PDF/image ownership documents for receipts, invoices, manuals, certificates,
  and warranties. Local OCR can suggest serial numbers, purchase dates, and
  warranty-expiry dates for explicit review and application.
- Warranty-expiry dashboard API and ntfy reminder support.
- Mobile-first React interface for setup/login, search, quick add, moving, quantity changes, locations, archive, and dashboard.
- Five-destination mobile navigation, responsive dashboard, attention strip, quick search chips, progressive forms, contextual actions, and accessible item sheets.
- Item editing, product metadata, tags, photos, history, and printable item/location QR labels.
- Unified phone scanner for application QR codes and retail barcodes, with manual fallback.
- Cached Open Food Facts lookup, source links, stale fallback, and preferred-location suggestions.
- Strict external AI JSON actions for add, decrement, move, update, and search, with ambiguity checks and confirmation.
- Browser voice dictation plus an optional external speech-to-text proxy.
- Low-stock shopping list generation and expiration dashboard APIs.
- Duplicate and already-owned search, project/BOM reservation management, and loan/return management.
- Persistent attributed enrichment jobs with an in-app review/apply flow.
- External metadata-enrichment export/import workflow with flexible non-food fields, Italian/EU price suggestions, source attribution, protected-field validation, and a bundled agent skill.
- JSON export, validated merge import, and source-ID remapping.
- Validated in-app full ZIP restore with restart-time replacement, safety
  backup, and rollback-on-failure.
- Daily deduplicated low-stock/expiration delivery through ntfy with retry handling.
- In-app, dynamically reloaded Home Assistant MQTT discovery configuration.
- Write-only AI and MQTT secrets excluded from API responses and exports.
- Installable PWA metadata and app-shell service worker.
- Online SQLite backup and search reindex commands.
- Banana Pi/Raspberry Pi systemd service and backup timer templates.
- Backend tests, API integration tests, frontend component tests, Playwright
  desktop/mobile end-to-end tests, automated accessibility checks, linting,
  and frontend production build.
- Laptop/local production-style smoke-test script for checking the app before installing on Banana Pi/Raspberry Pi.

## Remaining hardening and extensions

1. Measure memory, temperature, and latency on the user's exact Banana Pi/Raspberry Pi image.
2. Perform and document a physical restore drill to replacement storage.
3. Add provider adapters beyond Open Food Facts when concrete licensed sources are selected.
4. Add optional email notification delivery if ntfy is insufficient.
5. Add an explicitly destructive replace-import mode only if merge import proves insufficient.

## Current verification

```text
Backend tests: 73 passed
Python lint: clean
Frontend component tests: 3 passed
Playwright Chromium scenarios: 4 passed per desktop/mobile project (8 total)
Frontend TypeScript/Vite production build: clean
SQLite doctor: SQLite 3.45.1, FTS5 available
```

The application remains single-owner: there is no signup or multi-user account
system. The supported Docker deployment uses an administrator sign-in session
and HTTP Basic authentication for API clients. Authentication can be disabled
only for deliberately trusted local deployments.
