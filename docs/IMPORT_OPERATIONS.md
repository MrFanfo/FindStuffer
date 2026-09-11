# Import operations and the AI template

Open **More → Data → Chatbot operations template** to download the complete,
current contract. It comes from the backend validators and contains an empty
`operations` array, so the template itself creates nothing. Download a fresh
copy after changing categories, places, custom fields, targets or projects.

Give the template and your requested changes to your chatbot. Ask it to return
only the completed JSON object, without Markdown fences or commentary. The
contract includes current inventory identities and metadata; treat it as
inventory data when sharing it externally.

## Review and apply

1. Choose the returned JSON file in More → Data.
2. Inspect the summary, each operation's status, destination category/place,
   quantity, warnings and complete before/after details.
3. Edit item fields directly, edit any operation or exported row as JSON, or
   reject a line. Fix references to any rejected parent or other dependency.
4. Save or discard every row draft, then select **Review changes again**.
5. Select **Apply reviewed changes**. The importer revalidates against current
   database state when applying, so intervening changes can still block it.

Version 2 is atomic: any failed operation rolls back the entire batch. Preview
runs the same executor on a temporary database and never commits to inventory.
Warnings allow commit; failures do not. Recent imports retain five undo
snapshots; successful retry receipts persist beyond those snapshots.

## Envelope, retries and limits

```json
{
  "format": "findstuff-ops-v1",
  "schema_version": 2,
  "import_id": "unique-id-for-this-intended-batch",
  "duplicate_policy": "error",
  "ordering": "input",
  "operations": []
}
```

The format marker remains `findstuff-ops-v1`; `schema_version` selects behavior.
Unsupported versions are rejected. Explicit version 1 remains compatible with
the historical partial-success behavior: completed operations remain applied,
and results identify successful and failed operations. The UI promotes files
with no version to version 2 when first reviewed; older API clients omitting the
version retain legacy behavior. New templates always specify version 2.

Keep `import_id` unchanged on retries. Missing IDs are derived from a SHA-256
hash of semantic content. An identical retry returns the original result with
`replayed: true`, without repeating any changes. Reusing an ID for different
content fails. An undone receipt is marked `undone`; replay does not reapply it.
Use a new ID only for deliberately new work, such as another stock delivery.

Limits are 1,000 operations, 4 MiB of UTF-8 JSON and 32 levels of JSON nesting.
The executor checks a 30-second budget between operations; an execution-budget
failure rolls back version 2. The UI allows 45 seconds for import requests.
Split 5,000 operations into separately reviewed batches. These are bounded
synchronous jobs, without an asynchronous job queue; a single slow operation or
waiting for SQLite's write lock can exceed the between-operation budget.

JSON must have no comments, trailing commas, duplicate keys, NaN or Infinity.
Unknown operation, data and matching fields are rejected. Documented template
helpers (`_...`, `instructions`, `app_version`, `$defs`) are ignored. Do not
include them in the generated changes file unless needed for your own records.

## Stock identity and duplicate policies

Import add collisions compare active stock by:

`trimmed name + category + physical location + trimmed serial number`

Name and serial matching use SQLite NOCASE, which is ASCII case-insensitive.
Internal whitespace remains significant. A null category is a category value;
Unassigned is a real system place. Different serials distinguish physical assets.
Barcode describes a product and can be shared by stock at several places.

**The same canonical name and category at two different places is valid.**
Keep both named `PTFE Push-Fit Pneumatic Fittings`, for example, with quantity 3
in Box A and quantity 14 in Box B. Never append place names to bypass uniqueness.

| Policy | Exact item-add collision |
| --- | --- |
| `error` (default) | Reject and report the conflicting record. |
| `skip` | Validate the proposal, then leave existing stock unchanged. |
| `merge_quantity` | Add the proposed quantity (default 1); retain existing identity and metadata. Units must agree. |
| `replace` | Update only explicitly supplied fields on the existing record. Supplied quantity is absolute; omitted fields stay unchanged. |

Policies apply per batch, against both existing inventory and earlier successful
operations. They also govern move/split destination collisions, except that
`replace` is disallowed for transfers. Category/place adds reuse same-parent
identities. Explicit category metadata on add may update that category; use
`modify` to change an existing place.

Raw inventory exports preserve stock by `public_id`, including separately
identified historical records with identical composite fields. The database
retains those identities; it does not collapse records based on names. Manual
captures likewise retain their own request identity rather than silently
merging stock. Import duplicate policies are explicit decisions for operations.

## Matching, references and dependencies

Prefer item `public_id`, then database-local numeric `id`, then exact barcode
with category/place/serial qualifiers, then exact name with those qualifiers.
Every supplied qualifier must agree. A name alone is allowed only when unique.
Ambiguous matches list the candidates, including IDs, category, place and stock.

Categories resolve by numeric ID, full path, or an unambiguous leaf name.
Locations resolve by public ID, full path, or an unambiguous leaf name. Use one
reference alias for each field. Full paths use ` > ` as the separator. There is
no backslash escape for a literal `>` in a name: use an existing object's ID.
For newly created separator-containing names, create the structure first and
export its generated IDs before a second batch references them.

Repeated category/place names are valid under different immediate parents,
even within the same larger tree. Same-parent duplicates and cycles are
rejected. A room nested inside a box/drawer is unusual and produces a warning.

Default `ordering: "input"` runs the array in order. Create parents before
children, then fields/targets/projects before items and requirements using them.
Earlier same-batch creations can be referenced by their exact names/full paths.
Optional `ordering: "dependencies"` stably prioritizes structure additions and
retries missing references after dependencies become available. Results retain
original operation numbers and report `execution_order`. Unresolved or circular
chains fail; the chatbot should still return correctly ordered operations.

## Item operations and quantity

`add`, `modify`, `delete`, `move`, `split` and `merge` support items.
`delete item` archives it. Prefer a stable ID for any destructive or stock action.

- Quantities accept JSON numbers or decimal strings with at most three decimal
  places. Absolute quantities and thresholds are nonnegative; zero is legal.
- `add.quantity` is initial stock, defaulting to 1.
- `modify.quantity` replaces stock. `quantity_delta` is signed;
  `add_quantity` and `remove_quantity` are nonnegative amounts. Supply exactly
  one quantity instruction. Stock cannot become negative.
- Units are labels; changing a unit performs no numerical conversion.
- On modify, omitted fields remain unchanged. Null is accepted only as
  documented for the field. For item location, null/empty means Unassigned;
  null category clears it. Empty text clears optional text, and `[]` clears
  replacement collections such as tags, links and compatibility.
- `custom_fields` is a patch map: omitted keys remain unchanged, `{}` preserves
  existing values, and null is a value only for nullable definitions.

```json
{
  "op": "split",
  "type": "item",
  "match": {"public_id": "itm_REPLACE_WITH_REAL_ID"},
  "data": {"location": "Workshop > Box B", "quantity": 5}
}
```

`move` with no quantity moves the whole record and retains its public ID,
quantity and attachments when no destination collision exists. `split` requires
positive quantity strictly below source stock; `move.quantity` may equal all
stock. Partial transfers decrease source stock and create destination stock or
merge into an exact destination under `merge_quantity`.

Split copies item fields, tags, custom values and explicit compatibility.
Photos, documents, source lot metadata and other item relationships remain at
source; preview warns about this. A full transfer into existing destination
stock leaves the source record at zero. Full moves without collision retain
all data on the original record.

`merge` takes exactly one of `data.quantity` (a positive stock increment) or
`data.source` (another exact item match). Record merge requires equal name,
category, place, serial and unit. It transfers quantity, then zeros and archives
the source; metadata and attachments remain on their respective records.

## Hierarchy moves

Modify a location's `parent`/`parent_public_id` to move its entire subtree to
another root, drawer or container. All contained items keep their location IDs
and quantities; paths and search indexes update. Modify a category's
`parent`/`parent_id` to move its subtree in the same way. Null parent makes it a
root. Self/descendant moves and same-parent name collisions fail.

Use the parent selector when editing places/categories in the UI. Moving a
category cannot detach an explicit field override from its ancestor or create
unrelated inherited fields with the same key; adjust those definitions first.

## Projects, category fields and compatibility

These four explicit entity types support `add`, `modify`, and `delete`:

| Entity | Matching | Delete behavior |
| --- | --- | --- |
| `category_field` | Public ID or source category + key | Deactivate, retain values |
| `compatibility_target` | Public ID, canonical name or alias | Deactivate, retain relationships |
| `project` | Public ID or unambiguous name | Archive |
| `project_requirement` | Public ID or project + name | Cancel |

The generated template contains complete fields, enums, defaults, null behavior,
constraints, references, examples and current definitions for all four. See
[Projects and structured inventory](PROJECTS_AND_METADATA.md) for their exact
quantity and inheritance rules.

## Validation, audit and recovery

Each preview result has an operation number, action/status, validation status
(`valid`, `warning`, `failed`), message, before/after values and warnings.
Summary counts include created places/categories/items, moved items, merges,
replacements, skips and warnings. New entity changes are counted too.

Structured validation errors include `operation_index`, `error_code`, `field`
and `conflicting_item_id` when applicable. Collisions include the full conflicting
object and an earlier operation number if the collision arose within this
batch. Pydantic field errors distinguish missing values, type failures, invalid
enums and range failures. Semantic errors identify missing references, cycles,
ambiguity or a failed field-definition migration with affected item IDs.

Committed version 2 changes record import provenance for affected objects.
`GET /api/v1/items/{public_id}/import-provenance` returns recent item changes.
Undo is atomic and retains the retry receipt. Review undo carefully after
making subsequent edits to the same records; it restores the saved snapshots.

Portable JSON exports include the new relational tables and remap references
by stable identities when merged. Existing local metadata is retained and
missing relationships/values are filled in. Full ZIP backups include the whole
database, photos and documents. Data can validate a ZIP's integrity and media
references without restoring it; restore remains an explicit replacement action.

## Compact review and resolved category fields

Preview shows one compact row per operation, with a text status and green, yellow
or red indicator. Modify expands the complete validation details and editors;
Reject removes the proposal. Destinations remain visible in the row where space
allows and in expanded details. Saving a row invalidates the old preview; apply
requires revalidation of the amended file. Unsaved drafts still block apply.

For each exported category, `effective_custom_fields` is the ready-to-use set of
active fields after inheritance and nearest-child overrides. `defined_here`
contains definitions owned by that category, including inactive ones. Definitions
retain source category IDs, `source_category_path`, `inherited`, stable
`value_field_id`, defaults and constraints. The legacy `custom_fields` view is
retained for compatibility; new chatbot instructions should prefer the effective
array when constructing an item.

Item `compatibility_targets` links a physical machine to reusable abstract targets.
It does not mean the item is a compatible accessory. Use item `compatibility` for
“works with” claims. Both appear in the Related UI, along with direct item links.
A target's `linked_item_ids` is exported reference information, not an editable
target field. Change ownership links by modifying the physical item instead.

## Schema 3: containment and maker projects

Schema 3 retains atomic, retry-safe execution. Schema 2 remains accepted. The
exported template is generated from the same field validators and describes the
new project fields and workflow endpoints in full.

`is_container: true` enables physical contents. Use an item's `container_item_id`
with a stable public ID (preferred), internal numeric ID or unique exact name.
Create the container earlier in the same operations array. Supply either a direct
location or a container; contained items inherit effective location recursively.
`null` detaches to the current effective place unless another location is supplied;
omitting the field on modify preserves the assignment. Move/split accept a
container destination. A full-container move changes every descendant's effective
location without changing stock. Containers themselves cannot be split or merged.

Duplicate identity includes the immediate container (or direct place), canonical
name, category and serial. `match.container_item_id` disambiguates identical parts
in different boxes; null matches top-level items. Never append place names to item
names. Self-containment, cycles, inactive/noncontainer parents, and nesting beyond
32 levels are rejected. Empty containers before archiving or deleting them.

The item API returns `location_public_id` as the effective location for existing
clients; `direct_location_public_id` is null for contained items. `container_chain`
and `containment_path` explain the physical placement. Location contents omit
contained items; global search includes them and prioritizes direct name matches.

Project `multiplier`, `currency`, `links`, requirement `optional`,
`estimated_unit_cost_minor` and `actual_spent_minor` support add/modify and portable
exports. Required quantity is per build; other quantity and spending fields are
actual totals. See [maker workflow semantics](PROJECTS_AND_METADATA.md).
