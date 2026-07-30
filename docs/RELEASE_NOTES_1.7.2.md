# Findstuff 1.7.2

Findstuff 1.7.2 completes the frontend-root decomposition begun in 1.7.1.

## Highlights

- Move Places, Categories, location details, photo capture, and AI location
  scans into the Places feature.
- Move global search into a dedicated search feature.
- Move item details, documents, product data, maintenance, lots, reservations,
  relationships, and history into the Items feature.
- Move administration and its mapping, AI-review, and default-rule subviews
  into the Manage feature.
- Remove the obsolete duplicate Add form and dead root helpers.
- Reduce `frontend/src/App.tsx` from 7,327 to 1,272 lines (about 83%) while
  preserving app-level state, synchronization, actions, and routing there.

## Verification

- TypeScript passes both the normal project check and an additional
  no-unused-locals/no-unused-parameters check.
- Backend, component, browser, accessibility, and production-build results are
  recorded in the release workflow.
