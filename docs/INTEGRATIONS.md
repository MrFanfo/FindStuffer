# Optional integrations

Findstuff keeps all integrations optional. The inventory remains fully usable when the internet or an external provider is unavailable.

## ntfy notifications

Findstuff can send daily low-stock and expiration alerts through an ntfy topic.

1. Open **Manage → Notifications**.
2. Enter the complete topic URL, for example `https://ntfy.example.com/findstuff-alerts`.
3. Enter a bearer access token when the ntfy server requires one.
4. Choose the expiration warning window, enable notifications, and save.
5. Use **Send test notification** before relying on alerts.

The scheduled jobs evaluate inventory regularly. An item is sent at most once
per alert type per day, and failed deliveries are retried. The saved access
token is never returned to the browser after it is stored.

Treat an unprotected public ntfy topic name as a password: use a hard-to-guess topic, or preferably a protected topic on an ntfy account or self-hosted server. See the [ntfy publishing documentation](https://docs.ntfy.sh/publish/).

Public HTTPS topic URLs work by default. For a self-hosted ntfy server on a
private address, set this in `.env` and restart:

```bash
FINDSTUFF_ALLOW_PRIVATE_INTEGRATION_URLS=true
docker compose up -d
```

## Home Assistant MQTT discovery

Home Assistant integration is MQTT-only. Findstuff publishes retained
discovery definitions, availability, and a compact state payload.

1. Configure an MQTT broker in Home Assistant.
2. Create broker credentials for Findstuff.
3. Open **Manage → Integrations → Home Assistant MQTT** in Findstuff.
4. Enter the broker host, port, username, and password.
5. Keep `homeassistant` as the discovery prefix unless Home Assistant uses a
   custom prefix. Keep the default base topic and client ID for one Findstuff
   instance.
6. Save the settings and select **Test connection**.

The background publisher reloads immediately. Home Assistant should discover a
Findstuff device with sensors for items, locations, low stock, expiring items,
needs-details items, and online status.

Port `1883` is the usual unencrypted MQTT port. Keep broker traffic on a trusted
LAN, tailnet, or private Docker network. For a broker requiring TLS or client
certificates, place a TLS-capable MQTT proxy in front of it; this release does
not expose certificate fields in the app.

Do not use `localhost` unless the MQTT broker runs in the same container. For a
Home Assistant appliance on the LAN, use its reachable LAN address or hostname.
For Compose services on one Docker network, use the broker service name.

The password is never returned by the API. A blank password field preserves the
saved value, while **Remove password** clears it.

## AI and speech-to-text

The natural-language parser and AI Scan use an external OpenAI-compatible
chat-completions endpoint. Configure it under **Manage → Integrations**:

1. Enable AI.
2. Enter the complete chat-completions endpoint.
3. Enter a model that accepts text and image inputs.
4. Enter its API key, save, and run the connection test.

Optional external speech-to-text uses `FINDSTUFF_STT_ENDPOINT`, `FINDSTUFF_STT_API_KEY`, and `FINDSTUFF_STT_MODEL`. Browser dictation remains available when the browser supports it.

AI Scan captures require a model that supports image inputs. Each result is
stored as a proposal under **Manage → AI scan proposals** and requires explicit
approval before an inventory item is created.

The API key and MQTT password are stored in
`data/service-secrets.json` with owner-only permissions. They are write-only
through the application: responses expose only `api_key_set` or
`password_set`. Inventory JSON, enrichment exports, and backup ZIP files exclude
this secrets file. Re-enter both secrets after a restore.

The corresponding environment variables remain supported as first-run defaults
for automated deployments. Once a section is saved in the app, its editable
fields come from the app configuration. A secret saved or explicitly cleared
in the app overrides its environment fallback.

## Open Food Facts

Barcode lookup works without a secret. Results are cached locally with their source URL and attribution. If the network is unavailable, Findstuff can reuse a non-expired cached result and still permits manual item entry.
