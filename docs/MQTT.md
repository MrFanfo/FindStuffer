# MQTT and Home Assistant

Enable MQTT under Manage → Integrations. Findstuff publishes retained discovery
configuration under `homeassistant/sensor/findstuff/<key>/config` and an online
binary sensor under `homeassistant/binary_sensor/findstuff/online/config`.
Existing entity IDs remain stable. Prefixes are configurable.

The default data topics are `findstuff/state` (JSON), `findstuff/attributes`
(JSON), and `findstuff/status` (`online` or `offline`). Publication follows the
configured interval and occurs immediately after settings change. A last will
marks unexpected disconnects offline; graceful shutdown and reconfiguration
also publish offline. Test connection publishes discovery and data using a
separate client without changing the running publisher's availability.

| State key | Meaning |
| --- | --- |
| item_count | Active item records, including zero quantity |
| location_count | Active locations, including Unassigned |
| low_stock_count | Active items at or below their configured threshold |
| expiring_count | Dashboard count: active items/lots expiring within 14 days, including expired |
| needs_details_count | Active items in Unassigned |
| total_quantity | Sum of active quantities; mixed units are not physically comparable |
| container_count | Active items marked as containers |
| category_count | All categories |
| archived_count | Archived item records |
| photo_count | All stored photo records, including archived items |
| photo_storage_mb | Sum of recorded original photo sizes in decimal MB; excludes thumbnails |
| loans_out_count | Open lent loan records |
| borrowed_count | Open borrowed loan records |
| overdue_loans_count | Open loans in either direction due before today |
| shopping_list_count | Unchecked shopping entries |
| maintenance_due_count | Nonarchived tasks on active items due today or earlier |
| added_last_7_days | Active items created in the last rolling seven days |
| events_last_24h | Inventory events in the last rolling 24 hours |
| last_activity | Most recent inventory event timestamp in UTC; null on empty inventory |
| out_of_stock_count | Active items with zero quantity |
| expired_count | Active items with positive expired stock or a positive expired lot, counted once |
| uncategorized_count | Active items without a category |
| missing_photo_count | Active items without a stored photo |
| active_project_count | Planned or active projects |
| reserved_item_count | Distinct active items reserved by planned or active projects |
| document_count | All stored document records |
| lot_count | Positive-quantity lots belonging to active items |

Date-only expiry and due-date counts use the database's UTC day. The existing
expiring dashboard count retains the dashboard's local-day convention.
`state` also includes the app `version` and UTC `updated_at`.

`attributes.quantity_by_unit` maps each unit to its active quantity total, e.g.
`{"pcs": 12, "m": 2.5}`. Home Assistant attaches this to Total Quantity so that
pieces and metres can be used separately in templates and automations.
`attributes.recent_events` contains at most ten events with action, item name,
public item ID, and UTC timestamp, attached to Last Activity. Inventory names
therefore reach the configured broker; borrower names, credentials, document
contents, and filesystem paths are excluded.

Attribute selection follows the official
[Home Assistant MQTT sensor specification](https://www.home-assistant.io/integrations/sensor.mqtt/).
