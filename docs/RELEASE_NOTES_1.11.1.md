# Findstuff 1.11.1

Category selection for compatibility targets now uses the hierarchy picker, and
the AI operations template explains container items with worked examples. No
database changes: upgrading from 1.11.0 needs no migration.

## Compatibility

- Choose a target's category with the same hierarchy picker used when editing an
  item's category, replacing the flat drop-down. The current path is shown on the
  control, categories are browsed by drilling into the tree, and the grouping can
  be cleared in one action.
- Targets report `category_path` alongside the numeric `category`. Portable
  exports, the API and the AI template now carry the readable path, so the
  grouping no longer has to be resolved against the category list.

## AI operations template

- Add worked container examples: `fill_a_container` creates a container item and
  places stock inside it in one ordered batch, with
  `move_item_into_existing_container`, `take_item_out_of_its_container` and
  `move_container_with_everything_inside` covering the common edits. The existing
  containment rules described the constraints but never showed the operations.
- Replace the placeholder `container_item_id` example with the three accepted
  forms: an exported public ID, an unambiguous earlier batch name, and null to
  detach.
- Document `compatibility_target.category`, which accepts a category ID, path or
  name and only groups targets on the Compatibility list.

The template already listed every existing target under
`_available_compatibility_targets`; those entries now include the category and
its path.

## Validation

141 backend tests, 28 frontend tests and 22 desktop/mobile browser checks passed.
New coverage runs the generated `fill_a_container` example verbatim through a
real import and asserts the contained item inherits its container's place with no
direct location, and confirms the target editor opens the hierarchy picker and
applies the chosen category. TypeScript, unused-symbol, Ruff, frontend
architecture, bundle budget and public-repository checks passed.
