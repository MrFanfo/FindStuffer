# Findstuff 1.13.0

Findstuff now publishes a broader inventory summary to Home Assistant and keeps
unfinished work and saved inventory views across navigation and reloads.

- Expand MQTT from five to 27 sensors: stock, containers, categories, photos and
  storage, loans and overdue returns, shopping, maintenance, projects,
  reservations, documents, lots, recent additions and activity.
- Publish recent inventory events and quantities grouped by unit as attributes.
  Correct loan direction, timestamp comparisons, and decimal MB calculations.
  Connection tests no longer replace the running MQTT client; disabling or
  reconfiguring the publisher marks its previous availability offline.
- Share saved inventory views through the server, migrate existing browser views,
  preserve compatibility filters, and reject stale edits/deletes by revision.
- Persist quantity intentions before sending, reuse their receipts on retry, and
  serialize changes to the same item, including coordination across browser tabs
  where Web Locks are available.
- Restore capture, item, project, and requirement drafts on the same device.
- Preserve Places selections and project/target detail routes in browser history;
  project search results open the selected project directly.
- Use the available desktop width and keep item detail within laptop screens.
- Rebuild the bundled frontend for native installations.

This release includes the previously uncommitted application changes following
1.12.0. No database schema migration is required. Device drafts stay local;
saved inventory views are shared by users of the same Findstuff instance.

Validation: 146 backend tests, 30 frontend unit tests, and 28 desktop/mobile
browser cases passed. TypeScript, Ruff, architecture and bundle budgets,
production build, public-repository scan, Docker Compose validation, shell
checks, and updater integration test passed. npm audit reported no vulnerabilities.
