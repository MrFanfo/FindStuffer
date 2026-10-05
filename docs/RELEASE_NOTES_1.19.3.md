# Findstuff 1.19.3

The iPhone JSON import handoff now handles browsers that block automatic
clipboard reads. Instead of showing a browser permission error, Findstuff
opens and focuses the paste box with a clear instruction. Use iPhone's native
**Paste** action; Findstuff previews that JSON automatically. The existing
manual preview button remains available.

Import review rows now show the full item name and each warning or error reason
without opening **Modify**. For example, items missing a category explain
that an existing category may fit. These messages come from the same server
validation used before applying an import.

No database migration is needed. Update through **Settings → Software update**
after the tagged container image is published.
