# Findstuff 1.9.0

Findstuff 1.9.0 adds project planning, inherited category properties and structured
compatibility, together with a substantially expanded AI import workflow and
reliability improvements across the application.

## Plan work and describe stock

- Projects distinguish required, allocated, purchased and physically acquired
  quantities, with progress, missing stock, optional reservations and quick actions.
- Convert acquired project stock into inventory without double counting.
- Define typed category properties with inherited fields, explicit child
  overrides, validation previews and preserved values after renaming/deactivation.
- Maintain compatibility targets, aliases and families; record explicit or
  conditional relationships and find compatible parts while planning projects.
- Move a place/category subtree between roots while preserving item identities.

## Review imports with confidence

- The complete chatbot template is generated from backend validators and exports
  current structures, field definitions, targets, projects and matching rules.
- Edit or reject individual proposals, review destination category/place and
  quantities, then revalidate the amended file before applying.
- Version 2 imports are atomic, detect database and same-batch collisions, and
  support error/skip/quantity-merge/replace policies with structured errors.
- Stock with the same canonical name/category can exist in different locations.
  Explicit move, split and merge operations support partial stock transfers.
- Persistent batch receipts prevent duplicate retries; provenance and recent
  import undo include the new entities. Portable exports include their relations.

## Everyday reliability and usability

- Search, filters, formula evaluation, sorting and counts run across inventory
  before pagination, including global search and compatibility filters.
- Offline capture uses durable operation IDs, retains attachment progress and
  avoids silently merging separate captures by name. Filtered searches no longer
  replace the offline dataset; cache coverage and full download are explicit.
- The service worker caches lazy application screens; error boundaries provide
  recovery instead of a blank page. App updates have an explicit activation flow.
- Addressable views, item/place/category links and browser navigation retain context.
- Dialogs contain keyboard focus, support Escape and restore focus. Contrast and
  chart semantics are improved in both themes.
- Home adds pinned places, recent items, setup guidance and attention links.
  Inventory has compact cards, mobile filters, direct Move and Archive with Undo.
- Categories add used/favorite views and reviewable consolidation. More and
  Settings group tools and configuration, with searchable settings.
- Sign-in adds password visibility, Caps Lock feedback and recovery guidance.
  Optional item-detail/settings failures have independent recovery paths.
- Analytics can exclude import events. Data shows backup recovery details and
  validates selected ZIP contents before an explicit restore decision.

## Upgrade and behavior notes

Database migrations run automatically. Download a full backup before upgrading.
Existing stock and optional-feature-free items remain valid. Download a fresh
chatbot template for the new schema.

Version 2 limits batches to 1,000 operations, 4 MiB and 32 JSON levels. Legacy
version 1 retains reported partial-success behavior; new templates use atomic
version 2. Split transfers copy item properties/tags/compatibility but leave
photos, documents and source lot metadata at source, with a preview warning.
Custom-field deletion is deactivation; project deletion is archival.

See [Import operations](IMPORT_OPERATIONS.md) and
[Projects and structured inventory](PROJECTS_AND_METADATA.md) for the complete
matching, quantity, inheritance, retry, undo and compatibility rules.
