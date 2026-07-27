# External metadata enrichment

Findstuff supports a review-first enrichment loop for food and non-food items:

```text
Export request JSON → external AI/search agent researches → import response JSON → review suggestions
```

The app never lets an external agent directly overwrite inventory truth such as quantity, location, personal notes, purchase info, or serial numbers.

## App workflow

In the app, open **More → External enrichment review**.

1. Click **Export request JSON**.
2. Give that file to an agent using the bundled skill at `skills/findstuff-enrichment-agent/SKILL.md`.
3. Import the returned JSON.
4. Review pending suggestions and accept or reject them.

Safe high-confidence suggestions on empty fields may be auto-accepted. Price suggestions are always review-first and are stored as flexible metadata, not purchase data.

## Response style

The response must use patch-style updates:

```json
{
  "schema_version": "findstuff.enrichment_response.v1",
  "export_id": "enx_example",
  "agent": {
    "name": "findstuff-enrichment-agent",
    "version": "1",
    "market": "IT/EU",
    "run_at": "2026-06-25T09:00:00Z"
  },
  "suggestions": [
    {
      "item_public_id": "itm_example",
      "patches": [
        {
          "op": "set",
          "path": "/metadata/market/estimated_price_italy",
          "value": {
            "amount": 8.5,
            "currency": "EUR",
            "condition": "new"
          },
          "value_type": "object",
          "confidence": 0.72,
          "sources": [
            {
              "url": "https://example.it/product",
              "label": "Italian retailer product page",
              "source_type": "retailer"
            }
          ],
          "uncertainty": "Retail prices vary by seller and shipping.",
          "rationale": "Matched by visible model name."
        }
      ]
    }
  ]
}
```

Useful flexible paths include `/metadata/electronics/*`, `/metadata/tools/*`, `/metadata/books/*`, `/metadata/groceries/*`, `/metadata/cables/*`, `/metadata/3d_printing/*`, `/metadata/plants/*`, `/metadata/generic/*`, and `/metadata/market/*`.

Do not use direct Google scraping as a source. Use final manufacturer, API, documentation, publisher, Open Food Facts, or reputable retailer URLs.
