# Findstuff 1.10.0 implementation status

All requested feature groups are implemented in the working tree. Release is not
published yet; production still runs 1.9.0. No user inventory was used for testing.

Implemented:
- Earlier Home/item section/Related/physical target/mobile/import/template fixes.
- Category hierarchy restored, hide-empty toggle, category detail consolidation.
- Automatic full offline record cache refresh on online/reconnect/visible tab,
  shared download promise and visible progress; retry preserves previous cache.
- Full desktop width and bounded Places hierarchy; mobile import controls fit.
- Compact project rows with photos and item links; reserved stock on real items;
  optional requirements, notes/links/files, budget, multiplier, clone, finish and
  outputs with retry IDs and immutable completion snapshots. No implicit consumption.
- Dedicated nested containment, effective/direct location, capability flag, contents
  UI with add/move in/out, search and location visibility, duplicate matching by
  container, same-batch imports, move/split, raw export and dependency-safe undo.
- Migrations 0020/0021/0022; schema 3 template with legacy schema 1/2 accepted.
- Release notes and API/import documentation, version files bumped to 1.10.0.

Validation so far:
- Final backend suite: 138 tests passed, including performance query budgets.
- Eight targeted containment/project workflow tests pass, including exports and
  undo with unordered rows, schema 3 rollback, project attachments/path confinement,
  completed project export snapshots and outputs.
- 28 frontend unit tests, unused TypeScript check, architecture checks passed.
- 16 desktop/mobile Playwright checks passed.
- Synthetic live UI: project upload, reserved item, add inside, finish + output pass.
- Live project accessibility passes after separating item link from disclosure.
- Mobile import Modify/Reject controls fit within 390px; screenshots inspected.

Remaining before release:
- Final lint, 28 frontend tests, build, bundle, architecture and public-repo scan pass.
  Live project accessibility/mobile preview checks pass; dependency audit pending.
- Commit/push main and v1.10.0; monitor CI/multiarch GHCR; publish GitHub release.
- Back up production, update local Docker, verify version/health and migrated data.

findstuff.local was fixed earlier; user confirmed it works from another PC.
Deferred per user: purchase/receive semantic commands, richer target revisions and
source evidence objects, phases/dependency/supplier planning.
