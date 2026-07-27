# Open Food Facts category mappings

Findstuff retains the full Open Food Facts category hierarchy returned by barcode scans for
matching, but the mapping screen shows only the direct/deepest taxonomy categories. Existing
barcode cache entries are included automatically when the mapping screen is opened for the first
time.

## Review and assign in the app

1. Open **More / Settings**.
2. Select **Open Food Facts category mapping**.
3. Filter by **Automatic**, **Assigned**, or **Unmapped**.
4. Select the category shown in the **Our category** column.
5. Navigate the Findstuff category hierarchy and choose the destination category.
6. Use **See items** to review saved items associated with an OFF category.

An explicit assignment overrides automatic name matching. **Use automatic** removes only the
explicit override. It does not delete either category.

## Bulk export and import

1. Select **Export JSON** on the mapping screen.
2. Open `findstuff-off-category-mappings.json` in a text or JSON editor.
3. Use a value from `our_categories[].path` for each mapping's
   `assigned_category_path`. Paths must match exactly. Use `null` to remove an explicit override
   and return to automatic matching.
4. Save the JSON without changing its `format` value.
5. Select **Import mapping JSON** in Findstuff.
6. Review the validation results. Nothing changes during this preview.
7. Select **Apply import** when the preview contains no errors.

The import changes only Open Food Facts-to-Findstuff category assignments. It never creates,
renames, moves, or deletes Findstuff categories.

## Scan behavior

For a recognized product, Findstuff resolves explicit mappings first and automatic matches second.
If the resulting Findstuff category has a default location, the scan review is reduced to the
product name, resolved category, and location. Full item fields remain available under
**Review or change details**.

## Complete product data

**Look up data** downloads and stores the complete Open Food Facts product payload. Use
**Show all Open Food Facts data** to browse every returned field, including multilingual
ingredients, allergens, nutrition, packaging, scores, images, and future fields Findstuff does not
yet recognize. Use **Delete lookup boxes** to remove lookup-job and candidate history; the current
saved product data remains available.
