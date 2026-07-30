# Findstuff 1.7.1

Findstuff 1.7.1 separates the largest frontend responsibilities into
feature-oriented modules and changes the license for this and future versions
to the GNU Affero General Public License v3.0 only.

## Highlights

- Move inventory formulas, saved views, filtering UI, and inventory-owned state
  out of the application root.
- Move capture sessions, barcode review, camera scanning, guided commands, and
  AI commands into a dedicated capture feature.
- Reuse a standalone hierarchy picker for Place and Category selection.
- Separate authentication, dashboard, shell, and print-queue views/dialogs.
- Reduce `frontend/src/App.tsx` from 7,327 to 4,562 lines while retaining the
  existing routing and orchestration boundary.
- License Findstuff 1.7.1 and later under `AGPL-3.0-only`, preserving freedom
  to use, modify, redistribute, and sell copies while requiring corresponding
  source under the license's distribution and network-interaction terms.

## License note

Versions that were already released under MIT remain usable under MIT. The new
license applies to version 1.7.1 and later. AGPLv3 is a strong-copyleft
free-software license.

## Verification

- Backend: 73 tests passed; Ruff clean.
- Frontend: 3 component tests passed; TypeScript and production build clean.
- Browser: 8 Playwright desktop/mobile scenarios passed, including automated
  accessibility checks.
