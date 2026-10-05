# Findstuff 1.19.2

**Extra → Data → Import** now accepts JSON pasted from the clipboard or into a
text box. Both paths use the existing strict parser, server validation, review,
and explicit apply step. Invalid JSON clears any earlier preview.

On iPhone, a Share Sheet shortcut can copy a JSON file from ChatGPT and open
the Findstuff import screen. Instructions and the correct URL for the current
installation are shown under **Share from ChatGPT on iPhone**. iOS does not
currently offer installed web apps as direct Share Sheet targets, so the
shortcut is required and the user taps **Paste JSON from clipboard** after
Findstuff opens. Safari may open instead of the installed PWA.

No database migration is needed. Update through **Settings → Software update**
after the tagged container image is published.
