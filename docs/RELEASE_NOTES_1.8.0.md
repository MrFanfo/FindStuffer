# Findstuff 1.8.0

Findstuff 1.8.0 makes hierarchy names reusable and gives data protection and
inventory administration dedicated, task-focused workspaces.

## Improved hierarchy names

- Categories and Places can reuse the same name in different branches. For
  example, several parent Categories can each contain their own `Consumables`
  subcategory.
- Names remain unique among siblings, including at the root, and comparisons
  are case-insensitive.
- Imports accept repeated leaf names when their parent paths differ.
- Ambiguous bare Category names are rejected with guidance to use a full path
  or ID instead of silently selecting the wrong branch.
- AI Scan leaves an ambiguous Category unassigned for review rather than
  guessing.
- The upgrade migration preserves Category IDs and existing Item and Open Food
  Facts mapping references.

## New Extra workspaces

- **Data** is now a first-class Extra workspace with separate Backup & Export
  and Import sections.
- Backup status, full ZIP downloads, JSON exports, validated restore, import
  dry-runs, chatbot templates, and recent-import undo are quicker to reach and
  easier to understand.
- **Inventory management** is a new workspace for Lost Items, Archived Items,
  Projects & Reservations, and Borrowed & Lent records.
- Inventory-management sections include overview counts, quick navigation,
  clearer empty states, and task-focused forms and actions.
- **Settings** now contains configuration only; the moved data and inventory
  administration panels no longer compete with appearance, security,
  integrations, notifications, and system settings.
- Navigation documentation and AI operation feedback point to the new Data
  workspace.

## Verification

- Passed the complete backend test suite, including migration reference
  preservation, sibling uniqueness, cross-subtree duplicates, import previews,
  and ambiguous-reference handling.
- Passed strict TypeScript checks, frontend architecture checks, component and
  accessibility tests, Ruff, and the production frontend build.
