# Findstuff 1.19.0

Findstuff can now find manuals and product details online without an API key.
Update from the app's **Settings → Software update** panel after this release's
container image is published. The update applies migration `0026`, adding a
source URL to Item documents; existing documents and inventory are preserved.

## Find a manual

- Open an Item's **Details** tab and choose **Find a manual**. The Place and
  Category action menus offer a one-at-a-time review queue for their Items.
- Search by brand and model or name. Edit the search or paste a URL if needed.
- Inspect a result before saving. Attach a valid PDF (up to 20 MB) to the Item
  as a manual, or save a web guide as a link. A guide page can expose PDF links
  for inspection and attachment.
- Attached PDFs retain their original source URL and remain available from
  Findstuff even if the source page later disappears.

## Find details online

- Search product pages by brand and model or name. Inspect a page to see its
  product data before changing the Item.
- Select individual fields such as brand, model, description, barcode, weight,
  and dimensions. Existing fields start unchecked. Save the page's source link
  alongside the selected fields if desired.
- The review warns when the Item model does not appear in the page title or
  product data, or when the page has limited structured product metadata.
- Use the same workflow from Item, Place, or Category views. Skip any Item
  without changing it.

Online search uses DuckDuckGo's public HTML results, which can sometimes be
unavailable. Pasting a direct source URL remains available. The app validates
public download targets and redirects and limits page/PDF downloads. Product
information is only a suggestion: verify the source and exact model before
saving it.
