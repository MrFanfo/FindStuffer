# Findstuff 1.18.1

Photo search now shows a choice of photos and moves past broken image results
automatically. No database migration is needed when upgrading from 1.18.0.

## Photo search

- The photo finder shows four usable photos at a time by default. Click one to
  save it, choose **Next photos** for another page, or skip the item.
- Unreachable, unsupported, oversized, and unreadable image results are
  skipped while the finder looks for usable alternatives.
- Settings → Photo search lets you choose 1–8 photos per page. One photo keeps
  the single-photo view for slower connections.
- Photos download in parallel and are still compressed to WebP before display.
  More photos use more data and may take longer, depending on image hosts.
- The MCP server also offers a batch photo suggestion tool with the same
  fallback and pagination behavior. Restart the MCP connection after upgrading
  to discover it.

DuckDuckGo's public image results are an unofficial interface. If search
itself is unavailable, the finder offers a retry and manual upload remains
available.
