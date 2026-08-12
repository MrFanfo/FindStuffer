# Findstuff 1.8.1

Findstuff 1.8.1 makes data recovery clearer, streamlines the Extra workspaces,
and improves inventory readability and navigation—especially on phones.

## Data and recovery

- Automatic backup retention is capped at five for every installation, including
  existing deployments configured with a higher value.
- Data now lists automatic backups with their save time and size. Download a
  selected snapshot or create a fresh current-state backup.
- Recent imports and all Inventory Management work areas start collapsed.
- The chatbot operations template explicitly supports repeated category and
  Place names under different parents and uses full paths when names are ambiguous.

## Inventory experience

- Long Item names wrap cleanly on mobile instead of being cut off; brand is hidden
  by default to preserve space.
- Settings now includes server-saved choices for Item card photos, Places,
  categories, quantities, brands, and models.
- Category breadcrumbs in Item details are clickable at every hierarchy level.
- Categories can enable a new Fullness capability. Eligible Items store their own
  0–100% fullness value and expose a quick slider in Item details.
- Fullness is supported by the API, full export/import, operations imports, and
  chatbot instructions.

## Extra and Settings

- Settings now has the same clear back-to-Extra header as Data and Inventory
  Management.
- Repeated no-result search suggestions can be permanently dismissed without
  creating an alias.
- Data, Inventory Management, and Settings use clearer summaries, counts,
  collapsible content, and more responsive controls.

## Compatibility

The database migration is automatic. No deployment-specific configuration is
required, and existing Docker, localhost, LAN-IP, and Tailscale Serve access
patterns continue to work.
