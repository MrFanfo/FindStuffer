# Findstuff MCP coverage audit

Audited 2026-10-02 against the FastAPI route registry and the MCP tool catalog in this repository.
This is capability coverage, not a claim that every HTTP route has a tool with the same name.

## Summary

- 188 application API operations across 24 route groups.
- 164 MCP tools registered by the server.
- 163 operations covered directly, 3 covered with a behavior difference, 22 gaps.
- All project, requirement, compatibility, custom-field, category, location (except recursive delete), item (except permanent delete), photo, search, loan, shopping, enrichment, barcode, QR, and dashboard workflows have explicit MCP tools.

| Group | Covered | Partial | Gap |
| --- | ---: | ---: | ---: |
| administration | 7 | 0 | 7 |
| ai | 10 | 2 | 0 |
| authentication | 0 | 0 | 5 |
| barcodes | 3 | 0 | 0 |
| categories | 2 | 0 | 0 |
| dashboard | 6 | 0 | 0 |
| documents | 6 | 1 | 0 |
| enrichment | 13 | 0 | 0 |
| items | 25 | 0 | 1 |
| loans | 3 | 0 | 0 |
| locations | 6 | 0 | 1 |
| metadata | 24 | 0 | 1 |
| notifications | 0 | 0 | 2 |
| offline | 1 | 0 | 0 |
| photos | 6 | 0 | 0 |
| planning and metadata | 12 | 0 | 0 |
| preferences | 3 | 0 | 0 |
| projects | 6 | 0 | 0 |
| qr | 4 | 0 | 0 |
| search | 7 | 0 | 0 |
| settings | 12 | 0 | 5 |
| shopping | 4 | 0 | 0 |
| system | 2 | 0 | 0 |
| voice | 1 | 0 | 0 |

## Behavior differences

- Document upload stores the file; the web API also schedules automatic OCR. MCP exposes a separate `findstuff_extract_document` tool.
- AI scan creation and retry process the scan before returning; the web API returns immediately and processes it in the background.

## Remaining gaps and reason

- **Irreversible deletes (3):** permanent item deletion and recursive category/location deletion. Automatic approval review rejected adding these MCP tools because the broad parity request was not specific enough for those high-impact operations.
- **Administration (7):** password change, backup downloads, restore upload, import apply/undo, and software update request. A generic admin-authenticated adapter was rejected by automatic review for its broad impact; these operations remain absent.
- **Authentication (5):** login, logout, session status, current session, and media token. MCP uses a trusted local process rather than a browser session, so these browser-session endpoints have no MCP equivalent.
- **Integration and notification controls (7):** AI/MQTT/notification settings and tests, plus notification test/send. These can change credentials, external destinations, or send messages and remain absent.

## Route-by-route inventory

Covered means an explicit MCP tool or a combination of explicit tools provides the operation. Partial means the data/action is available but timing differs. Gap means no MCP equivalent is present.

### administration

| Method | API path | MCP coverage |
| --- | --- | --- |
| POST | `/api/v1/admin/password` | Gap |
| GET | `/api/v1/admin/export` | Covered |
| GET | `/api/v1/admin/backup` | Gap |
| GET | `/api/v1/admin/operations-template` | Covered |
| GET | `/api/v1/admin/backups` | Covered |
| GET | `/api/v1/admin/backups/{backup_id}` | Gap |
| GET | `/api/v1/admin/restore` | Covered |
| POST | `/api/v1/admin/restore` | Gap |
| POST | `/api/v1/admin/import-preview` | Covered |
| POST | `/api/v1/admin/import` | Gap |
| GET | `/api/v1/admin/imports` | Covered |
| POST | `/api/v1/admin/imports/{public_id}/undo` | Gap |
| GET | `/api/v1/admin/software-update` | Covered |
| POST | `/api/v1/admin/software-update` | Gap |

### ai

| Method | API path | MCP coverage |
| --- | --- | --- |
| POST | `/api/v1/commands/parse` | Covered |
| GET | `/api/v1/commands/{public_id}` | Covered |
| POST | `/api/v1/commands/{public_id}/confirm` | Covered |
| POST | `/api/v1/commands/{public_id}/reject` | Covered |
| POST | `/api/v1/ai-scans` | Partial |
| GET | `/api/v1/ai-scans` | Covered |
| GET | `/api/v1/ai-scans/{public_id}` | Covered |
| GET | `/api/v1/ai-scans/{public_id}/photo` | Covered |
| PATCH | `/api/v1/ai-scans/{public_id}` | Covered |
| POST | `/api/v1/ai-scans/{public_id}/approve` | Covered |
| POST | `/api/v1/ai-scans/{public_id}/reject` | Covered |
| POST | `/api/v1/ai-scans/{public_id}/retry` | Partial |

### authentication

| Method | API path | MCP coverage |
| --- | --- | --- |
| GET | `/api/v1/auth/status` | Gap |
| POST | `/api/v1/auth/login` | Gap |
| GET | `/api/v1/auth/media-token` | Gap |
| POST | `/api/v1/auth/logout` | Gap |
| GET | `/api/v1/auth/me` | Gap |

### barcodes

| Method | API path | MCP coverage |
| --- | --- | --- |
| GET | `/api/v1/barcodes/{code}/lookup` | Covered |
| POST | `/api/v1/barcodes/decode-image` | Covered |
| POST | `/api/v1/barcodes/{code}/refresh` | Covered |

### categories

| Method | API path | MCP coverage |
| --- | --- | --- |
| GET | `/api/v1/categories/consolidation-preview` | Covered |
| POST | `/api/v1/categories/consolidate` | Covered |

### dashboard

| Method | API path | MCP coverage |
| --- | --- | --- |
| GET | `/api/v1/dashboard` | Covered |
| GET | `/api/v1/attention` | Covered |
| GET | `/api/v1/analytics` | Covered |
| GET | `/api/v1/dashboard/low-stock` | Covered |
| GET | `/api/v1/dashboard/expiring` | Covered |
| GET | `/api/v1/dashboard/warranties` | Covered |

### documents

| Method | API path | MCP coverage |
| --- | --- | --- |
| GET | `/api/v1/items/{public_id}/documents` | Covered |
| POST | `/api/v1/items/{public_id}/documents` | Partial |
| GET | `/api/v1/documents/{public_id}/content` | Covered |
| PATCH | `/api/v1/documents/{public_id}` | Covered |
| POST | `/api/v1/documents/{public_id}/extract` | Covered |
| POST | `/api/v1/documents/{public_id}/apply-extraction` | Covered |
| DELETE | `/api/v1/documents/{public_id}` | Covered |

### enrichment

| Method | API path | MCP coverage |
| --- | --- | --- |
| POST | `/api/v1/items/{public_id}/enrichment-jobs` | Covered |
| GET | `/api/v1/items/{public_id}/enrichment` | Covered |
| GET | `/api/v1/items/{public_id}/enrichment/full` | Covered |
| DELETE | `/api/v1/items/{public_id}/enrichment` | Covered |
| POST | `/api/v1/enrichment/run` | Covered |
| POST | `/api/v1/enrichment/queue-missing` | Covered |
| GET | `/api/v1/enrichment/status` | Covered |
| POST | `/api/v1/enrichment/exports` | Covered |
| POST | `/api/v1/enrichment/imports` | Covered |
| GET | `/api/v1/enrichment/suggestions` | Covered |
| POST | `/api/v1/enrichment/suggestions/{public_id}/accept` | Covered |
| POST | `/api/v1/enrichment/suggestions/{public_id}/reject` | Covered |
| POST | `/api/v1/enrichment-candidates/{public_id}/apply` | Covered |

### items

| Method | API path | MCP coverage |
| --- | --- | --- |
| GET | `/api/v1/items` | Covered |
| GET | `/api/v1/items/query` | Covered |
| GET | `/api/v1/items/page` | Covered |
| POST | `/api/v1/items` | Covered |
| GET | `/api/v1/items/{public_id}` | Covered |
| GET | `/api/v1/items/{public_id}/detail` | Covered |
| POST | `/api/v1/items/{public_id}/relationships` | Covered |
| DELETE | `/api/v1/items/{public_id}/relationships/{relationship_public_id}` | Covered |
| PATCH | `/api/v1/items/{public_id}` | Covered |
| DELETE | `/api/v1/items/{public_id}` | Covered |
| DELETE | `/api/v1/items/{public_id}/permanent` | Gap |
| POST | `/api/v1/items/{public_id}/restore` | Covered |
| POST | `/api/v1/items/{public_id}/adjust-quantity` | Covered |
| POST | `/api/v1/items/{public_id}/move` | Covered |
| GET | `/api/v1/items/{public_id}/history` | Covered |
| GET | `/api/v1/items/{public_id}/lots` | Covered |
| POST | `/api/v1/items/{public_id}/lots` | Covered |
| PATCH | `/api/v1/items/{public_id}/lots/{lot_public_id}` | Covered |
| DELETE | `/api/v1/items/{public_id}/lots/{lot_public_id}` | Covered |
| GET | `/api/v1/items/{public_id}/maintenance` | Covered |
| POST | `/api/v1/items/{public_id}/maintenance` | Covered |
| POST | `/api/v1/items/{public_id}/maintenance/{task_public_id}/complete` | Covered |
| PUT | `/api/v1/items/{public_id}/tags` | Covered |
| PUT | `/api/v1/items/{public_id}/default-location` | Covered |
| GET | `/api/v1/items/{public_id}/duplicates` | Covered |
| GET | `/api/v1/items/{public_id}/import-provenance` | Covered |

### loans

| Method | API path | MCP coverage |
| --- | --- | --- |
| POST | `/api/v1/loans` | Covered |
| GET | `/api/v1/loans` | Covered |
| POST | `/api/v1/loans/{public_id}/return` | Covered |

### locations

| Method | API path | MCP coverage |
| --- | --- | --- |
| GET | `/api/v1/locations/tree` | Covered |
| POST | `/api/v1/locations` | Covered |
| GET | `/api/v1/locations/{public_id}` | Covered |
| GET | `/api/v1/locations/{public_id}/contents` | Covered |
| PATCH | `/api/v1/locations/{public_id}` | Covered |
| DELETE | `/api/v1/locations/{public_id}` | Covered |
| DELETE | `/api/v1/locations/{public_id}/tree` | Gap |

### metadata

| Method | API path | MCP coverage |
| --- | --- | --- |
| GET | `/api/v1/categories` | Covered |
| POST | `/api/v1/categories` | Covered |
| PATCH | `/api/v1/categories/{category_id}` | Covered |
| GET | `/api/v1/category-marks` | Covered |
| GET | `/api/v1/category-marks/{name}.svg` | Covered |
| PUT | `/api/v1/category-marks/{name}` | Covered |
| DELETE | `/api/v1/category-marks/{name}` | Covered |
| GET | `/api/v1/category-marks/export` | Covered |
| POST | `/api/v1/category-marks/import` | Covered |
| POST | `/api/v1/categories/icons/suggest` | Covered |
| GET | `/api/v1/categories/{category_id}/enrichment-export` | Covered |
| GET | `/api/v1/locations/{public_id}/enrichment-export` | Covered |
| GET | `/api/v1/categories/icons/export` | Covered |
| POST | `/api/v1/categories/icons/import` | Covered |
| DELETE | `/api/v1/categories/{category_id}` | Covered |
| GET | `/api/v1/categories/{category_id}/contents` | Covered |
| PUT | `/api/v1/categories/{category_id}/default-location` | Covered |
| DELETE | `/api/v1/categories/{category_id}/tree` | Gap |
| GET | `/api/v1/location-types` | Covered |
| POST | `/api/v1/location-types` | Covered |
| GET | `/api/v1/location-rules` | Covered |
| POST | `/api/v1/location-rules` | Covered |
| PATCH | `/api/v1/location-rules/{public_id}` | Covered |
| DELETE | `/api/v1/location-rules/{public_id}` | Covered |
| GET | `/api/v1/location-rules/suggest` | Covered |

### notifications

| Method | API path | MCP coverage |
| --- | --- | --- |
| POST | `/api/v1/notifications/test` | Gap |
| POST | `/api/v1/notifications/run` | Gap |

### offline

| Method | API path | MCP coverage |
| --- | --- | --- |
| POST | `/api/v1/offline/sync` | Covered |

### photos

| Method | API path | MCP coverage |
| --- | --- | --- |
| GET | `/api/v1/items/{public_id}/photo-suggestion` | Covered |
| GET | `/api/v1/items/{public_id}/photos` | Covered |
| POST | `/api/v1/items/{public_id}/photos` | Covered |
| POST | `/api/v1/items/{public_id}/photos/from-url` | Covered |
| GET | `/api/v1/photos/{public_id}/content` | Covered |
| DELETE | `/api/v1/photos/{public_id}` | Covered |

### planning and metadata

| Method | API path | MCP coverage |
| --- | --- | --- |
| GET | `/api/v1/category-fields` | Covered |
| GET | `/api/v1/compatibility-targets` | Covered |
| GET | `/api/v1/compatibility-targets/{public_id}` | Covered |
| GET | `/api/v1/projects/{public_id}` | Covered |
| GET | `/api/v1/projects/{public_id}/candidates` | Covered |
| GET | `/api/v1/items/{public_id}/extensions` | Covered |
| POST | `/api/v1/project-requirements/{public_id}/stock` | Covered |
| GET | `/api/v1/items/{public_id}/contents` | Covered |
| POST | `/api/v1/projects/{public_id}/actions` | Covered |
| POST | `/api/v1/projects/{public_id}/files` | Covered |
| GET | `/api/v1/project-files/{public_id}/content` | Covered |
| DELETE | `/api/v1/project-files/{public_id}` | Covered |

### preferences

| Method | API path | MCP coverage |
| --- | --- | --- |
| GET | `/api/v1/saved-views` | Covered |
| PUT | `/api/v1/saved-views/{public_id}` | Covered |
| DELETE | `/api/v1/saved-views/{public_id}` | Covered |

### projects

| Method | API path | MCP coverage |
| --- | --- | --- |
| POST | `/api/v1/projects` | Covered |
| GET | `/api/v1/projects` | Covered |
| PATCH | `/api/v1/projects/{public_id}` | Covered |
| DELETE | `/api/v1/projects/{public_id}` | Covered |
| POST | `/api/v1/projects/{public_id}/reservations` | Covered |
| DELETE | `/api/v1/projects/{public_id}/reservations/{item_public_id}` | Covered |

### qr

| Method | API path | MCP coverage |
| --- | --- | --- |
| GET | `/api/v1/qr/items/{public_id}.svg` | Covered |
| GET | `/api/v1/qr/locations/{public_id}.svg` | Covered |
| GET | `/api/v1/labels/items/{public_id}` | Covered |
| GET | `/api/v1/labels/locations/{public_id}` | Covered |

### search

| Method | API path | MCP coverage |
| --- | --- | --- |
| GET | `/api/v1/search` | Covered |
| GET | `/api/v1/search/aliases` | Covered |
| GET | `/api/v1/search/learning-candidates` | Covered |
| DELETE | `/api/v1/search/learning-candidates` | Covered |
| POST | `/api/v1/search/aliases` | Covered |
| DELETE | `/api/v1/search/aliases/{public_id}` | Covered |
| GET | `/api/v1/owned` | Covered |

### settings

| Method | API path | MCP coverage |
| --- | --- | --- |
| GET | `/api/v1/preferences` | Covered |
| PATCH | `/api/v1/preferences` | Covered |
| GET | `/api/v1/settings` | Covered |
| GET | `/api/v1/settings/units` | Covered |
| PUT | `/api/v1/settings/units` | Covered |
| PUT | `/api/v1/settings/category-data` | Covered |
| PUT | `/api/v1/settings/inventory-display` | Covered |
| GET | `/api/v1/settings/open-food-facts/category-mappings` | Covered |
| PUT | `/api/v1/settings/open-food-facts/category-mappings/{off_tag}` | Covered |
| GET | `/api/v1/settings/open-food-facts/category-mappings/{off_tag}/items` | Covered |
| GET | `/api/v1/settings/open-food-facts/category-mappings-export` | Covered |
| POST | `/api/v1/settings/open-food-facts/category-mappings-import` | Covered |
| PUT | `/api/v1/settings/ai` | Gap |
| POST | `/api/v1/settings/ai/test` | Gap |
| PUT | `/api/v1/settings/mqtt` | Gap |
| POST | `/api/v1/settings/mqtt/test` | Gap |
| PUT | `/api/v1/settings/notifications` | Gap |

### shopping

| Method | API path | MCP coverage |
| --- | --- | --- |
| GET | `/api/v1/shopping-list` | Covered |
| POST | `/api/v1/shopping-list` | Covered |
| POST | `/api/v1/shopping-list/generate-low-stock` | Covered |
| PATCH | `/api/v1/shopping-list/{public_id}` | Covered |

### system

| Method | API path | MCP coverage |
| --- | --- | --- |
| GET | `/api/v1/health` | Covered |
| GET | `/api/v1/bootstrap` | Covered |

### voice

| Method | API path | MCP coverage |
| --- | --- | --- |
| POST | `/api/v1/voice/transcribe` | Covered |
