# Findstuff 1.10.1

Interface refinements across Projects, Compatibility, Places and Settings. No
backend, database or API changes: upgrading from 1.10.0 needs no migration and
1.10.0 data is used unchanged.

## Projects

- Group required items by category, with a heading and item count per group.
  Uncategorised requirements sort last.
- Rework requirement rows into a single expandable card. The collapsed summary
  carries the name, photo, unit, the Need/Have/Ordered/To buy totals and the
  coverage status; stock facts, notes and warnings expand on demand.
- Separate requirement actions into a stock row (Order remaining, Receive 1) and
  a management row (Edit quantities, Open item), with the rarer link, consume
  and undo controls behind More actions.
- Collect project controls under one Manage project disclosure holding project
  details, output creation, cloning, stock totals, notes, links, files,
  finished items and completion snapshots.
- Show build count as a read-only summary in the overview and move project
  status into the heading. Ready to build and Finish project surface only when
  the project is actually ready.
- Show unit stock totals on demand instead of always in the progress block.

## Compatibility

- Rebuild the workspace with a target overview, metadata chips, and separate
  Physical items, Related inventory and Related projects sections, each with its
  own count.
- Search targets by manufacturer and model as well as name and aliases.
- Add a placeholder and loading state for the detail pane, and empty states for
  targets, inventory and projects.
- Clear the previous target's detail when selecting a new one, and ignore a
  late-arriving Load more response that no longer matches the open target.

## Places

- Replace the inline Edit/Delete/Subtree/Print QR button strip on every tree row
  with a compact overflow menu, leaving more room for the place name and path.
- Move the place detail actions (Add Item, AI Scan, Add Place, Photos, Print QR,
  Put away here) into an overflow menu in the heading, replacing the separate
  bottom action bar.

## Settings

- Move the "Show shopping list on Home" toggle off Home and into
  Manage → Appearance → Home.
- Make App info respond to the settings search and group filter, so it is
  findable under "App info" and hidden when filtered out.

## Validation

138 backend tests, 28 frontend tests and the Playwright desktop/mobile browser
checks passed. TypeScript, unused-symbol, Ruff, frontend architecture, bundle
budget and public-repository checks passed.
