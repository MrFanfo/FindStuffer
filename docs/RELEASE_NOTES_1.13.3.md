# Findstuff 1.13.3

"Check again" in the software update panel now asks GitHub for the latest
release every time you press it. No database changes: upgrading from 1.13.2
needs no migration.

## Update checks

Findstuff remembers the latest release for 5 minutes, so opening the panel does
not use up GitHub's limit of 60 anonymous requests per hour. "Check again" used
that same remembered answer, so a release published a moment earlier could still
show as "Up to date" for up to 5 minutes.

- Pressing **Check again** now skips the remembered answer and refreshes it.
- Opening the panel still uses the remembered answer.

## API

- `GET /api/v1/admin/software-update?refresh=true` bypasses the cached release check.
