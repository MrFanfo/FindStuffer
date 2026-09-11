# Findstuff 1.11.0

Compatibility targets and projects each get their own page, targets can be
grouped by category, and two navigation bugs are fixed.

## Fixes

- Stop the shopping list appearing for a moment on Home before disappearing.
  Home preferences rendered on optimistic defaults; Home now waits for the
  stored answer, so a disabled section never flashes into view.
- Stop "This screen could not open" appearing while moving between sections.
  A failed chunk request was answered with a synthesized error response that
  reached the dynamic import as an unparsable module, and React caches that
  rejection for the life of the page, so the section stayed broken until a
  manual reload. Chunk requests are now retried, fall back to a single reload
  that picks up the current index, and surface the error screen only if that
  also fails. The offline shell keeps chunks it fetches on demand and lets a
  genuine network failure reject rather than inventing a response.

## Compatibility

- Targets carry an optional inventory category. The list groups targets under
  it with uncategorised targets last, and search covers manufacturer and model
  as well as name and aliases. The category is presentation only: it never
  affects which items match a target, which relationships are inherited, or how
  candidates rank.
- Selecting a target opens its own page instead of expanding below the list,
  with its inventory, physical items and related projects. Related projects and
  family links navigate in place rather than reloading the application.

## Projects

- Selecting a project opens its own page instead of expanding below the list.
  The list shows each project's status and coverage as a full-width card.
- Projects are not categorised; requirements inside a project remain grouped by
  category as in 1.10.1.

## Interface

- Remove the oversized heading and description from Data, Backup & export,
  Import, More, Analytics, Inventory management and Settings. Each section keeps
  its short label, still exposed as a heading to screen readers.
- Remove the large "Categories" heading. Hiding empty branches is now a compact
  toggle beside the Places/Categories tabs instead of a full-width button.

## Data and compatibility

Migration 0023 adds a nullable target category referencing the existing category
hierarchy; deleting a category clears the grouping and leaves the target intact.
Existing targets, aliases, relationships and links are preserved, and no
1.10.1 data needs converting.

The generated AI operations template exposes the new optional
`compatibility_target.category` field, which accepts a category ID, path or
name. Portable JSON exports carry the grouping, and an import that references a
category missing from the file is rejected rather than silently dropped.
Download a fresh template after upgrading.

## Validation

140 backend tests, 28 frontend tests and 20 desktop/mobile browser checks
passed, including new coverage for target grouping, both detail pages and an
accessibility scan of the target page. TypeScript, unused-symbol, Ruff, frontend
architecture, bundle budget and public-repository checks passed.
