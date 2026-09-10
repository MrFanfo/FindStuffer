# Findstuff 1.9.0 implementation report

The release combines the selected website review fixes with the requested
importer, project planning, category-field and compatibility features. The
complete operational reference is [Import operations](IMPORT_OPERATIONS.md);
new entity and inheritance rules are in
[Projects and structured inventory](PROJECTS_AND_METADATA.md).

## Website review

| Review point | Implemented behavior | Main implementation |
| --- | --- | --- |
| R1 | Durable capture IDs; atomic claim/write/receipt; retained item and attachment progress through retries | `offline.py`, `db.py`, `durableSave.ts`, `offline.ts` |
| R2 | Global server search, total matches, pagination, explicit offline coverage | `human_search.py`, `inventory_query.py`, `GlobalSearch.tsx` |
| R3 | Database filtering, formulas and sorting before pagination; complete counts | `inventory_query.py`, `inventory_formula.py`, `InventoryView.tsx` |
| R4 | Separate cached inventory entities; search cannot shrink the offline inventory; explicit full download | `offline.ts`, `OfflineDownload.tsx` |
| R5 | Precache lazy app dependencies, versioned service worker and explicit update activation; root/feature recovery boundaries | `sw-build.mjs`, `public/sw.js`, `ErrorBoundary.tsx` |
| R6 | Addressable routes, item/place/category links, filter URLs, Back/Forward and loaded-page/scroll restoration | `useNavigationHistory.ts`, `inventoryHistory.ts`, `App.tsx` |
| R8 | Shared modal keyboard containment, nested-dialog behavior, Escape, background inertness and focus return | `DialogManager.tsx` |
| R9 | Theme contrast tokens, chart semantics/data table, headings and keyboard access to scrollable saved views | `styles.css`, `AnalyticsView.tsx`, `InventoryView.tsx` |
| R10 | Independent optional loads, visible section failures and retries | `ItemDetail.tsx`, `ItemStructuredData.tsx`, `ManageView.tsx`, `DataView.tsx` |

Sign-in includes show/hide password, Caps Lock and recovery guidance. Home adds
recent items, pinned places, attention links and setup guidance; Shopping is
optional. Inventory offers compact cards, mobile filters, direct destination
selection, Archive and Undo. Item details prioritize quantity/place and use a
small empty-photo action. Categories offer used/favorite/domain views, full
search and consolidation preview. More/Settings group tools and configuration.
Analytics distinguishes inventory state from events and excludes imports by
default. Data exposes backup destination/recovery state and validates selected
ZIP contents before restore.

## Import requirements

The versioned executor supports atomic v2 batches, explicit legacy v1 partial
results, statuses/warnings, four duplicate policies, database and same-batch
collision simulation, exact ambiguity candidates, stable references,
dependency ordering, circular/unresolved dependency errors, persistent retry
receipts, operation provenance and atomic recent-import undo.

The identity policy permits canonical stock names in multiple places and
never fabricates suffixes. Explicit move/split/merge actions define whole and
partial quantity transfers. Field schemas and operational guidance document
number precision, zero, null versus omission, arrays, matching precedence,
case/whitespace rules, path separators, schema versions, unknown fields,
limits/timeouts and strict JSON. Preview rows support direct item editing,
complete JSON editing and rejection, with unsaved-draft and revalidation guards.

The backend template derives fields from actual API/import models and uses the
executor's policy and limit constants. It adds current category/place/item
identities, effective custom fields and values, compatibility relationships,
targets and projects, with conservative research, naming, category-reuse and
reference instructions. The template starts with no operations.

## New entities and persistence

- Project requirements distinguish need, explicit inventory allocation,
  outstanding purchases and physically acquired stock outside inventory.
  Coverage does not double count acquired stock moved into inventory. Planned
  requirements need no item; optional reservations share accounting with the
  existing reservation feature. Compatibility ranks available choices.
- Category definitions support eight typed fields, constraints, defaults,
  stable root IDs, inherited values and explicit nearest-child overrides.
  Renaming preserves identity; deactivation preserves values. Migration previews
  reject incompatible stored values and identify affected items.
- Compatibility targets have stable IDs, aliases, optional families and explicit
  item relationships. Nearest target relationships override ancestors; inherited,
  conditional, incompatible and unknown states remain distinct.
- Location/category subtree moves preserve item identities and quantities while
  updating paths. Cycles, sibling collisions and broken field ancestry fail.
- Migrations 0018/0019 add receipts, provenance and relational feature tables.
  Portable export/merge remaps stable references; full ZIP backups contain the
  complete database and media. Existing local metadata is retained on JSON merge.

The main backend additions are `operations_contract.py`, `import_protocol.py`,
`import_template.py`, `extension_template.py`, `extension_schemas.py`,
`extensions.py`, `extension_routes.py`, `projects.py`, `custom_fields.py`,
`compatibility.py`, `extension_exports.py`, `inventory_query.py`,
`inventory_formula.py`, `home.py`, `category_consolidation.py` and `units.py`.
Frontend additions are grouped under planning, data-tools, dashboard, places,
items, shell and shared components. The shipped `frontend/dist` assets are
rebuilt for native installs as well as the container release.

## Validation

- Backend: 123 tests passing, including the new importer, structured features,
  HTTP contract, complete inventory-query and ZIP-preview regressions.
- Frontend: 25 tests passing, including strict JSON, unsaved import proposals
  and loaded-page restoration; TypeScript and unused-code checks pass.
- Desktop/mobile Playwright suite: all 10 tests pass.
- Production browser checks use an isolated synthetic inventory. They exercise
  edited/rejected import proposals, project planning/acquisition, item property
  editing, inherited target relationships, compatibility links, child field
  overrides, required-field capture and browser Back with loaded pages/scroll.
- Live theme scans cover the existing eight workspaces and desktop/mobile
  Projects/Compatibility. Offline reload retains the wider cache after search,
  and first-time offline Capture opens successfully. Runtime-error checks pass.
- Final sign-in and narrow item-details scans pass in both themes. Nested
  dialogs contain focus and Escape closes only the top layer.
- Ruff, architecture/cycle checks, bundle budget, shell checks, Docker Compose
  validation and updater integration checks pass. Dependency audit reports zero
  vulnerabilities after compatible lockfile updates.
- Current publication-tree and public-main history checks pass. Local private
  branches are outside the public release history and are not publication inputs.

## Deliberate boundaries

Version 2 accepts at most 1,000 operations, 4 MiB and 32 JSON nesting levels;
large work is split into separately reviewed batches. Time limits are checked
between operations. Legacy v1 retains explicitly reported partial success.
Partial stock splits retain source media/lot metadata with a preview warning.
Field deletion is reversible deactivation; projects archive and requirements
cancel. Compatibility claims remain explicit and evidence-based, and do not
follow from category membership. New required definitions do not rewrite old
items. Projects complete manually. The recovery screen distinguishes creating
a backup from verifying recovery on another host.
