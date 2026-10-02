# Findstuff 1.18.0

Find product photos without an API key, review each result, and save only the
ones you accept. The Findstuff MCP server now covers the main inventory,
project, compatibility, custom-field, category, location, and photo workflows.
No database migration is needed when upgrading from 1.17.2.

## Find photos online

- Open an item and choose **Find photo online**. From a place or category,
  choose **Find photos online** to review its items that have no photo.
- Search uses the item's brand and name, or its name alone. It shows the first
  DuckDuckGo Images result and its source; you can accept it, see another
  result, or skip the item. Nothing is saved until you accept.
- The server checks the image URL and compresses the preview to WebP, at most
  900 px and 250 KB. The accepted preview is the exact image saved to the
  item. Search needs no LLM or API key.

DuckDuckGo's public image results are an unofficial interface. If it changes
or blocks a request, manual photo upload remains available.

## MCP inventory coverage

- Added photo upload, import, preview search, retrieval, and removal tools.
- Added tools for projects and requirements, compatibility targets, custom
  fields, categories, locations, item metadata, documents, loans, shopping,
  enrichment, QR labels, dashboards, and other everyday workflows.
- The detailed route audit is in `docs/MCP_COVERAGE.md`. Permanent item and
  tree deletion, credential changes, restore/import application, software
  updates, and external message controls remain outside the MCP tool set.
- Restart the MCP connection after upgrading so the client discovers the new
  tools.
