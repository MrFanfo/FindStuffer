# Findstuff implementation plan

Status: approved on 2026-06-24. This document is the implementation baseline; changes should be recorded as architecture decisions rather than silently diverging from it.

## 1. Product vision

Find any household, lab, or grocery item in seconds from a phone.
Record what it is, how much exists, and exactly where it lives.
Use text, voice, barcodes, and QR labels to reduce manual entry.
Require a clear preview before AI changes inventory.
Remain reliable and maintainable on a 512 MB self-hosted device.

## 2. Recommended architecture

### Technology choices

- Backend: Python 3 and FastAPI.
- Database: SQLite with FTS5.
- Frontend: React, TypeScript, and Vite.
- Files: photos on disk, metadata in SQLite.
- Integrations: configurable external AI/STT provider and Open Food Facts.
- Background work: a persistent SQLite job queue; no Redis or Celery.
- Banana Pi deployment: systemd, with Docker Compose optional on larger hardware.
- Reverse proxy/TLS: optional Caddy, recommended for phone camera and microphone access.

FastAPI is preferred because Pydantic strongly validates AI-produced JSON, Python has good image and API tooling, and FastAPI produces OpenAPI documentation. Production uses one Uvicorn worker. React/Vite is justified by camera, microphone, barcode, QR, and PWA requirements. Its compiled assets are static and add no idle server process.

The target Banana Pi M2 Zero has a quad-core Cortex-A7 and 512 MB of RAM shared with its GPU. The architecture therefore excludes local language models, Redis, Celery, multiple web workers, and frontend compilation on the device.

```text
Phone / desktop PWA
        | HTTPS
        v
 Optional Caddy
        |
        v
FastAPI -- static React app and /api/v1
   |           |              |
   |           |              +-- AI / speech APIs
   |           |              +-- Open Food Facts
   |           +-- photos/
   +-- SQLite: inventory, events, FTS, jobs, cache

systemd timers -- backups, job recovery, scheduled maintenance
```

Runtime principles:

- One application process and one SQLite writer.
- Same-origin frontend and API.
- SQLite foreign keys, WAL mode, busy timeout, and bounded checkpoints.
- Short transactions; external requests never run inside a transaction.
- PWA app-shell caching first; offline writes only after the MVP.
- Production frontend assets are built on a development machine or CI.

Recommended services are `findstuff.service`, `findstuff-backup.timer`, and `findstuff-maintenance.timer`, plus optional Caddy. Docker Compose may be offered for development or larger hardware but is not the primary 512 MB deployment.

## 3. Data model

SQLite integer keys are internal. Random `public_id` values are used in URLs and QR codes. Currency uses integer minor units. Quantities enter the API as decimal strings and are normalized to integer thousandths.

An inventory item represents a homogeneous batch in one location. Groceries with different expiration dates are separate items but may reference the same canonical barcode product.

### Tables

- `categories`: name, slug, default location, default low-stock threshold.
- `locations`: public ID, parent, name, kind, description, order, archived timestamp.
- `products`: barcode, canonical name, brand, package quantity, image and source metadata.
- `items`: name, text, category/product/location, quantity/unit, price, physical attributes, product identifiers, expiration, threshold, version, timestamps.
- `tags` and `item_tags`: normalized many-to-many tagging.
- `photos`: item, storage paths, MIME type, dimensions, hash, order.
- `inventory_events`: append-only mutation history with deltas, locations, before/after JSON, actor, and source.
- `location_rules`: ordered product/category/name-to-location defaults.
- `ai_commands`: raw input, proposal, resolved proposal, status, model/provider, error, timestamps.
- `external_cache`: provider responses, cache keys, expiry, status.
- `enrichment_jobs`: persistent jobs, attempts, retry schedule, error.
- `enrichment_candidates`: reviewable proposed values with source and confidence.
- `item_fts`: name, description, notes, category, tags, location path, brand, model, serial, and barcode.
- `app_settings`: installation-level JSON settings.

Important item fields include `public_id`, `version`, `name`, `description`, `notes`, `category_id`, `product_id`, `location_id`, `quantity_milli`, `unit`, purchase and estimate price fields, weight and millimetre dimensions, serial/model/brand, expiration date, low-stock threshold, barcode override, and lifecycle timestamps.

Rules and relationships:

- Locations use an adjacency list. Cycles are rejected.
- Locations containing active children or items cannot be deleted.
- An always-present Unassigned root keeps item locations non-null.
- Multiple inventory batches may reference one product.
- Quantity cannot become negative.
- Creates, quantity changes, moves, updates, archives, and restores write an event in the same transaction.
- Item updates use a monotonically increasing version.
- Deletes are initially soft deletes.

Search uses an application-maintained FTS5 document so joined category, tag, and location text is searchable. Location changes reindex affected items, and a maintenance command can rebuild everything. Regular indexes cover location, category, product, expiration, archived state, and barcode.

## 4. API design

All endpoints use `/api/v1`. Concurrent mutations provide an expected item version.

Authentication:

- `GET /auth/status` and `GET /auth/me` for local single-user mode.
- No signup, signin, password, session, or CSRF prompt in the single-user MVP.

Inventory:

- `GET/POST /items`.
- `GET/PATCH/DELETE /items/{public_id}`.
- `POST /items/{public_id}/restore`.
- `POST /items/{public_id}/adjust-quantity`.
- `POST /items/{public_id}/move`.
- `GET /items/{public_id}/history`.

Photos:

- `POST /items/{public_id}/photos`.
- `PATCH/DELETE /items/{public_id}/photos/{photo_id}`.

Locations and metadata:

- `GET /locations/tree`, `POST /locations`.
- `GET/PATCH/DELETE /locations/{public_id}`.
- `POST /locations/{public_id}/move`.
- `GET /locations/{public_id}/items`.
- Category, tag, and location-rule CRUD endpoints.

Search/dashboard:

- `GET /search`.
- `GET /dashboard`, `/dashboard/low-stock`, `/dashboard/expiring`, and `/dashboard/recent-events`.

AI/voice:

- `POST /commands/parse`.
- `GET /commands/{id}`.
- `POST /commands/{id}/confirm` and `/reject`.
- `POST /voice/transcribe`.

Barcode/QR:

- `GET /barcodes/{code}/lookup`, `POST /barcodes/{code}/refresh`.
- `GET /qr/items/{public_id}.svg`, `GET /qr/locations/{public_id}.svg`.
- `GET /go/{public_id}`.

Enrichment/admin:

- `POST /items/{public_id}/enrichment-jobs`, `GET /items/{public_id}/enrichment`.
- `POST /enrichment-candidates/{id}/apply` and `/reject`.
- `POST /admin/backups`, `GET /admin/backups`, `POST /admin/export`.

## 5. AI parser design

The AI is a parser, not an inventory operator. The server receives text, loads compact allowed context, requests strict structured JSON, validates it independently, resolves natural-language references, identifies ambiguity, and shows exact before/after values. Only an explicit confirmation applies an immutable proposal. Application is atomic, version-checked, audited, and idempotent. Read-only searches may run without confirmation.

Supported discriminated actions are `add_item`, `adjust_quantity`, `move_item`, `update_item`, and `search_items`.

Example envelope:

```json
{
  "schema_version": "1",
  "intent": "mutate",
  "summary": "Add three ESP32-C3 boards",
  "actions": [],
  "ambiguities": [],
  "warnings": [],
  "requires_confirmation": true
}
```

Example action:

```json
{
  "type": "add_item",
  "item": {
    "name": "ESP32-C3 board",
    "quantity": {"value": "3", "unit": "pcs"},
    "purchase_price": {"amount_minor": 800, "currency": "EUR", "basis": "per_unit"}
  },
  "location_ref": {"text": "studio drawer, small electronics box"}
}
```

Safety controls include JSON Schema, server validation, allowlisted actions and fields, no model tool/database access, blocked unresolved references, proposal expiry, idempotency, optimistic versions, bulk warnings, limits/timeouts, and complete command auditing. Voice transcripts use the same pipeline.

## 6. Barcode and grocery workflow

The browser scans EAN/UPC locally, distinguishes application QR URLs, checks local products/cache, and performs an exact Open Food Facts lookup only on a miss. Documented fields are mapped into a review proposal. The user chooses to increment an existing batch or create a new one, reviews the suggested location, edits quantity/expiration as needed, and confirms.

Open Food Facts v3 is the initial provider. Requests use an identifiable User-Agent. Positive results are cached for about 30 days, negative results briefly, and remote search-as-you-type is prohibited. Missing products fall back to compact manual entry while retaining the barcode. Product-specific location rules override category and name rules.

Initial examples are pasta to Pantry, milk to Fridge, frozen food to Freezer, and cat food to Pet Shelf.

## 7. QR workflow

QR codes contain stable application URLs, never editable item data or credentials. A location scan offers Add here, Scan grocery here, Move selected item here, and View contents. An item scan opens its detail page with location, quantity, adjust, move, edit, and history. Renaming or moving entities does not invalidate labels. SVG labels support individual and A4 printing.

## 8. Background enrichment workflow

The API queues a persistent job. A single-concurrency provider adapter checks cache, fetches data, normalizes it, and creates attributed candidates. The UI compares current and proposed values. Only accepted fields are applied and audited. Provider adapters expose support checks, fetching, normalization, and cache policy. They never overwrite user-entered data automatically. An in-process worker handles interactive jobs while a systemd timer recovers abandoned/retryable work. Scraping is optional, bounded, cached, and source-attributed.

## 9. UI pages

Phone bottom navigation: Search, Add, Scan, Locations, Dashboard.

Screens include Login; Dashboard with Where is, recent, low stock, and expiry; Search results with location breadcrumbs; Quick Add by manual/AI/voice/barcode; AI review; Item detail/edit/move/history; Location tree/detail; Barcode review; unified scanner; enrichment review; QR printing; and Settings for account, rules, providers, and backup status.

Use at least 44 px touch targets, native mobile inputs, and minimal keyboard interaction.

## 10. MVP milestones

1. Foundation and performance: repository, config, migrations, ARM proof, static shell, health checks.
2. Inventory foundation: authentication, nested locations, items, categories/tags, quantity, moves, events, FTS.
3. Mobile UI and photos: navigation, forms, dashboard, image resizing/storage, installable PWA.
4. QR flows: stable IDs, label generation, unified scanning, add/move/detail routes.
5. Grocery/barcode: decoding, Open Food Facts, product batches, rules, expiry and thresholds.
6. AI text and voice: provider abstraction, strict schema, resolver, confirmation, idempotency, STT.
7. Operations/enrichment: jobs, candidates, backup/export, restore test, systemd deployment, board testing.

## 11. Later roadmap

1. Shopping lists from low stock.
2. Expiration notifications through email, ntfy, or Home Assistant.
3. Duplicate detection.
4. “Do I already own this?” purchase check.
5. Projects, BOMs, and reservations.
6. Borrowed/lent tracking.
7. Dry-run JSON/CSV import.
8. Home Assistant sensors and services.
9. Multi-user roles.
10. Offline mutation queue and conflicts.
11. Custom fields.
12. Price history.
13. NFC labels using the same stable URLs.

## 12. Risks and mitigations

- **512 MB RAM:** one web worker; no local AI, Redis, Celery, or development frontend server in production.
- **SD wear/corruption:** quality storage, WAL checkpointing, online backups, graceful shutdown, retention.
- **SQLite contention:** one writer, short transactions, busy timeout, durable queued work.
- **Stale search:** transactional reindexing, affected-subtree refresh, rebuild command and tests.
- **Wi-Fi loss:** cached shell and integrations, clear mutation failures.
- **Camera/microphone restrictions:** HTTPS, permission guidance, manual fallback.
- **External outages/schema changes:** adapters, timeouts, caching, documented field allowlists, source dates.
- **AI hallucination:** schema, resolution, diff, confirmation, versions, idempotency, audit.
- **Wrong locations:** block ambiguous resolution and show complete paths.
- **Grocery expiry:** one item batch per distinct expiration/location.
- **Malicious uploads:** strict size/type/decode checks and randomized paths.
- **Internet exposure:** prefer LAN/VPN/Tailscale; TLS, strong login, throttling, authenticated QR routes.
- **Backup confidence:** retain database, photos, configuration, schema manifest, and test restores.
- **Power/thermal instability:** minimal OS, bounded work, suitable supply, optional heatsink, health checks.

Initial backup retention is seven daily and four weekly copies.

## 13. Development order

1. Record architecture decisions.
2. Create backend/frontend structure and configuration.
3. Add health API and static application serving.
4. Establish migrations and schema.
5. Add transaction helpers and SQLite settings.
6. Seed Unassigned, common units, and categories.
7. Implement local single-user mode and Home Assistant MQTT discovery.
8. Implement nested locations and cycle tests.
9. Implement item/category/tag CRUD and versions.
10. Implement events, quantity, move, archive/restore, and transaction tests.
11. Implement FTS generation, ranking, rebuild, and tests.
12. Build the mobile shell and local-first state handling.
13. Build search, detail, add/edit, quantity, and move screens.
14. Add photos and browser resizing.
15. Add dashboard.
16. Add QR generation, routing, and printing.
17. Add unified scanning and barcode decoding.
18. Add Open Food Facts, grocery review, cache, and location rules.
19. Implement the AI schema/validator before connecting a model.
20. Implement resolution, ambiguity, confirmation, idempotency, and auditing.
21. Connect and contract-test the first AI provider.
22. Add browser voice and optional STT proxy.
23. Add enrichment jobs, one provider, and review.
24. Add online backups, export, restore verification, systemd units, and deployment docs.
25. Test resources, recovery, search volume, and mobile browsers on the target board.
