# Projects and structured inventory

Findstuff keeps six distinct concepts: category (what an item is), category
fields (its structured properties), compatibility (what it works with), project
(intended work), requirement (what that work needs), and inventory stock (what
physically exists at a place).

## Projects and requirements

Open **More → Projects**. Create a project, optionally choose compatibility
targets, and add requirements. A planned requirement can have no inventory item.
Linking an item does not allocate or consume stock; choose the quantity to use.
The stock picker ranks unconditional compatible items first and keeps unknown,
conditional and incompatible alternatives visible. It never links automatically.

| Quantity | Meaning |
| --- | --- |
| Required | Positive amount needed, up to three decimal places |
| Inventory allocation | Amount explicitly planned from one linked stock record |
| Inventory available | Allocation capped by physical stock after other project holds and earlier allocations in this project |
| Purchased | Outstanding order, not physically received |
| Acquired | Physically received for the project, held outside inventory |
| Missing | `max(required − available − acquired, 0)` |
| To buy | `max(missing − purchased, 0)` |

Required 10, available 3 and acquired 4 gives missing 3. Purchasing those three
reduces To buy to zero while Missing stays three until receipt. Quick actions
mark purchased/acquired, undo acquired, use one inventory unit, or open the full
quantity editor. The acquired quick action also reduces outstanding purchased
quantity. All requirement quantity updates assign absolute values.

**Add acquired stock to inventory** atomically decreases acquired quantity and
increases inventory stock plus the requirement's allocation by the same amount.
This preserves coverage and avoids double counting. Linked stock keeps its
place. An unlinked requirement creates a new item at the chosen place; required
custom fields must be supplied. The action uses a version check and persistent
request receipt so a lost response can be retried safely.

Reservations are optional and never consume physical inventory. Requirements
and existing reservation screens account for each other's holds. Unreserved
allocations are planning estimates which may be shared across projects, with a
warning. Within a project, earlier allocations are accounted for before later
lines. Falling physical stock can reduce availability and produces a warning.
Reservations for completed/archived projects stop holding stock.

Project progress averages capped coverage per active requirement line. Totals
are also grouped by unit instead of adding incompatible units. Cancelled lines
are excluded. Completion is manual; a requirement explicitly marked satisfied
must have no missing quantity. Unlinked planned lines remain valid and visible.
Project deletion archives it and keeps requirements/history.

## Category custom fields

Open **Categories → Custom fields** for a category. A field has a stable public
ID, semantic snake_case key, label, description, type, required/nullable flags,
default, enum choices, constraints, unit label, sort position and active state.
Values are stored relationally against item and stable root field IDs.

Supported types are string, text, integer, decimal, boolean, enum, date and URL.
Constraints cover numeric bounds, text length and decimal precision (up to nine
places, default six). URLs must use HTTP(S); dates use `YYYY-MM-DD`; enum values
match exactly. Defaults are validated. There is no regex execution, implicit
unit conversion, multi-select or arbitrary reference type.

Children inherit parent definitions. A child can add independent fields or
choose **Override here** for an inherited field. The nearest active definition
wins as a whole; it retains the root `value_field_id`, so values stay attached.
For Category 1 → Category 2 → Category 3, a definition on Category 1 applies to
all three until Category 3 explicitly overrides it. Category 2 keeps the parent
rule. The UI and template show source category, inheritance and override IDs.

An override must reference an ancestor definition and retain its semantic key.
Unrelated duplicate keys in an inheritance chain are rejected. Root key renames
propagate to overrides while preserving stable value identity. Definition
source category and override source are immutable; create a deliberate new
definition for a different property.

Definition edits simulate changes against existing affected values. Invalid
type/constraint migrations fail with item IDs; they do not silently coerce bad
values. Newly required fields do not rewrite existing items. Missing required
values must be supplied when adding items or editing their fields/category;
unrelated item edits continue to work. Defaults apply when an applicable value
is absent during those edits/creation. Explicit nullable null stays null.

Deleting a definition deactivates it. Values remain stored and visible, including
values retained from a previous category. Deactivating an override falls back to
the next active ancestor, subject to validation. There is no destructive purge
of field/value history in this release. Category deletion with attached field
definitions is blocked by relational integrity.

Item **Details → Properties and compatibility** provides typed field editors,
source labels, retained values and associated project links.

## Compatibility

Open **More → Compatibility** to maintain reusable targets, aliases and parent
families. Names and aliases are globally unique ignoring case; creation also
rejects spellings that differ from another target only in whitespace or hyphens.
Names are never silently rewritten. Manufacturer prefixes and semantic variants
require a deliberate alias, rather than guessing that two products are identical.

Explicit item relationships support compatible, incompatible, requires_adapter,
partial and unknown, with notes, an HTTP(S) source URL and adapter description.
A nearest explicit target relationship overrides ancestor/family relationships,
including explicit incompatible or unknown. Inheritance travels down families;
siblings do not imply one another. Category membership proves nothing about
compatibility. Cycles are rejected.

Target pages label inherited and explicit inventory relationships, show stock
and places, and link related projects. Inventory supports a compatibility filter
and searches such as `parts for Voron`. Project requirements can override a
project's target selection for candidate ranking. Conditional relationships are
not counted as unconditional compatible matches. Deactivation preserves links
and names, while inactive targets no longer supply active inheritance.

## AI and import behavior

`category_field`, `compatibility_target`, `project` and `project_requirement`
are explicit operation entities. Creation is never an undocumented side effect
of importing an item. Same-batch references, simulated preview, atomic apply,
undo and provenance use the normal operations executor. Requirements are unique
by project + trimmed case-insensitive name + category; prefer public IDs for
later changes, or project + unambiguous requirement name.

The exported template adds `_capabilities`, `_available_category_fields`,
per-category effective fields, `_available_compatibility_targets`,
`_available_projects`, shared field schemas and `_structured_metadata_rules`.
Operational instructions require existing category/field/target reuse,
conservative names, no invented technical values or IDs, and evidence for
specific compatibility claims. Keep built-in properties in their built-in fields.

See [Import operations](IMPORT_OPERATIONS.md) for stock identity, partial moves,
duplicate policies, errors, retry receipts, limits and legacy behavior.

## Implementation and migrations

Migration 0018 adds persistent import receipts and operation provenance.
Migration 0019 extends projects with notes and adds category definitions,
item-field values, compatibility targets/aliases/relationships, project
requirements and project/requirement target links. Foreign keys protect
references. Existing items need no rewrite and all features remain optional.

| Area | Main files |
| --- | --- |
| Shared models | `backend/findstuff/extension_schemas.py`, `schemas.py` |
| Field inheritance/validation | `custom_fields.py` |
| Compatibility | `compatibility.py` |
| Project calculations and acquisition | `projects.py` |
| Entity operations/read APIs | `extensions.py`, `extension_routes.py` |
| Import execution and contract | `import_protocol.py`, `operations_contract.py`, `import_template.py`, `extension_template.py`, `extended.py` |
| Portable merge | `extension_exports.py` |
| UI | `frontend/src/features/planning/`, `places/CategoryFieldsPanel.tsx`, `items/ItemStructuredData.tsx`, `data-tools/ImportReviewEditor.tsx` |

The accompanying regression tests cover quantity calculations, purchase versus
receipt, repeated updates, optional holds, linking and planned conversion,
inheritance/override identity, type failures, deactivation/renaming, target
aliases and overrides, complete compatibility filtering, same-batch creation,
invalid references, raw export/undo integrity, strict JSON, HTTP contracts and
unfinished preview edits. Browser checks additionally exercise the actual
project, item properties, target and import screens.
