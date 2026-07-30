# Findstuff 1.7.4

Findstuff 1.7.4 fixes in-app scanning of Findstuff QR labels when the label
uses a different valid deployment hostname, such as Tailnet HTTPS.

## Fixed

- Location QR labels scanned inside Findstuff now open the location instead of
  falling through to the new-item barcode workflow.
- Item and location QR parsing works across Tailnet, LAN, and installed-PWA
  origins while retaining the strict Findstuff root-link and public-ID format.
- Retail barcodes and unrelated web links continue through their existing
  barcode behavior.

## Verification

- Added parser coverage for Tailnet, item, location, add-location, retail
  barcode, and unrelated URL payloads.
- Added desktop and mobile Playwright coverage proving that a scanned Tailnet
  location QR navigates to its Place without creating an item review card.
