# Findstuff 1.10.0

- Remove Recently viewed and Recently updated from Home and stop loading/tracking
  those lists.
- Hide empty item sections. Edit exposes only category-enabled sections, including
  new Documents and Related metadata switches, while preserving hidden data.
- Combine direct item links and compatibility under Related. Link physical machines
  to independent model targets; show their compatible/conditional parts, locations,
  inherited relationships and evidence. Targets survive selling or deleting stock.
- Compact import previews to one status-colored line per operation with inline
  Modify and Reject controls. Full validation and editing expand on demand.
- Correct entity-specific template descriptions and expose resolved effective
  category fields with local definitions and inheritance provenance.
- Simplify project quantity cards to Need, Have, Ordered and Still buy, with a
  detailed stock breakdown available on demand.
- Give mobile categories a full-width row with a compact inline action menu.
- Add documented, reversible Linux host configuration for findstuff.local access.

Migration 0020 adds optional physical-target links. Existing items, direct links
and compatibility records are preserved. Portable exports and import undo include
the new links. Download a fresh chatbot template to see the new optional field.


## Maker projects and physical containment

- Compact expandable BOM rows, optional requirements, clickable inventory photos,
  visible stock reservations on the item itself, project notes/links and PDF/image
  attachments. Build count scales BOM requirements while actual stock stays unchanged.
- Budget summaries show estimated total, actual paid, outstanding order value and
  estimated remaining purchases. Unpriced lines remain visible.
- Clone projects with a clean stock/order/spending ledger. Finish a ready project,
  optionally create inventory outputs, and retain an immutable completion snapshot.
  Completion releases reservations; it never silently consumes physical stock.
- Physical container items can hold nested inventory. Contents inherit effective
  locations, remain searchable and have independent stock counts. Location browsing
  shows top-level items; boxes show compact contents with add/move-in/move-out actions.
- Restore the category hierarchy as the main view; optionally hide empty branches.
  Consolidation is available on individual category pages.
- Full inventory records refresh automatically while online and after reconnecting.
  Existing caches remain usable if a download fails. Photos and documents still need
  a connection.
- Desktop workspaces use the available screen width with readable forms.

## Data and compatibility

Migration 0021 adds first-class containment, a nullable containing-item reference,
container capability and canonical direct location. The existing location index is
maintained as the effective location for compatibility. Migration 0022 adds project
build count/currency/links, optional and cost fields, files, outputs and snapshots.

The generated AI operations template now exports schema version 3, including all
new fields, resolved inherited category fields, containment rules and project
workflow semantics. Versions 1 and 2 remain accepted; versions 2 and 3 are atomic.
Download a fresh template after upgrading. File bytes require a full backup; a JSON
export carries metadata only. Back up before upgrading; rolling back the application
also requires restoring its matching pre-upgrade backup.

## Validation

138 backend tests, 28 frontend tests and 16 desktop/mobile browser checks passed.
Additional live checks cover project file upload, reserved inventory, adding stock
inside containers, completion/output creation, project accessibility and compact
mobile import controls. TypeScript, lint, architecture, bundle and updater checks
passed. Container publication also runs the backup/restore smoke test.
