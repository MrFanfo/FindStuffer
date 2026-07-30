# Findstuff 1.7.3

Findstuff 1.7.3 fixes iPhone QR-label printing and adds enforceable frontend
architecture, loading-performance, and regression-quality boundaries.

## Highlights

- Prevent iOS/WebKit print pagination from splitting QR labels between sheets.
  Printed pages now use natural-height, explicit page boundaries with
  non-fragmentable rows and labels; the A4 preview remains unchanged.
- Add QR pagination unit coverage for complete rows and wrapped labels.
- Lazy-load Analytics, Manage, Places, Capture, Item Detail, administration
  tools, and the print dialog.
- Reduce the initial application JavaScript from roughly 606 KiB to 289 KiB;
  feature routes are emitted as independent chunks.
- Split Places into coordinator, hierarchy editors, and photo/AI capture
  sessions; split management tools into mapping, AI inbox, default rules, and
  system-information modules.
- Consolidate category, capability, expiration, activity, error, and photo
  helpers into shared domain modules.
- Enforce `App.tsx` and feature-file size limits, circular-import detection,
  bundle budgets, unused TypeScript checks, accessibility checks, and backend
  plus browser pagination regressions in CI.

## Verification

- Backend, frontend, browser, accessibility, production-build, bundle, and
  architecture checks are required before publication.
