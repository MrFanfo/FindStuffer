# Findstuff

Findstuff is a self-hosted, mobile-first inventory application for homes,
workshops, labs, collections, and groceries. It organizes items into nested
places, keeps quantity history and photos, scans barcodes and QR labels, and can
turn a rapid sequence of camera photos into reviewable AI item proposals.

The server is a small FastAPI application backed by SQLite. The installable PWA
is built with React and Vite. It runs on amd64, arm64, and arm/v7 Linux.

## Features

- Nested locations such as room → cabinet → drawer → shelf.
- Items, quantities, units, categories, tags, notes, dimensions, prices, lots,
  expiration dates, loans, projects, reservations, and maintenance records.
- Mobile camera capture, item/location QR labels, retail barcode lookup through
  Open Food Facts, and bulk put-away/consume workflows.
- An A4 QR label studio with 20–64 mm codes, compact-to-spacious sheet density,
  six label designs, and printable location names, full nested paths, or the
  last chosen number of path levels. Long paths wrap completely and pagination
  adapts to keep every printed level visible.
- Place-based **AI Scan**: take several photos quickly, let a vision model
  identify the objects in the background, then review the results in the
  **Inbox**, one suggestion at a time. Swipe, edit, approve, or reject each
  suggested Item. Captures are cropped and compressed before upload, and
  Settings reports monthly AI calls, tokens, failures, and image savings.
- A **Voice/AI Operations composer** in Capture turns one spoken or typed
  request into an ordered batch of Item, Category, and Place changes. Every
  operation uses the regular import preview and nothing is applied before
  confirmation; the resulting batch can be rolled back from Recent imports.
- An **Extra** hub with inventory analytics for stock health, value by
  currency, activity, top Categories and Places, and consumption.
- PWA offline capture keeps the latest inventory snapshot on the device and
  queues new Items, compressed photos, scanned codes, and quantity changes.
  Queued operations synchronize in order after the app reconnects or reopens.
- Full-text search, duplicate detection, low-stock shopping lists, and history.
- Human-friendly search with plural and synonym expansion, typo-tolerant fallback,
  configurable Item/Place aliases, and actionable no-result feedback.
- First-class PDF and image documents for receipts, invoices, manuals,
  certificates, and warranties, including optional local OCR-assisted serial
  and date extraction plus warranty-expiry notifications.
- Cursor-paginated inventory loading so large collections are not silently
  truncated while the initial and offline views remain fast.
- Separate Archive and permanent Delete actions, with an **Archived Items**
  manager in Settings for restoring Items or deleting them forever.
- A dedicated default-rules page for searching, filtering, inspecting, editing,
  enabling, disabling, and deleting automatic Place rules. Category and
  destination fields use searchable pickers.
- A Settings **Customization** section groups Place types and units of measure.
- Open Food Facts enrichment queue status showing exactly how many eligible
  barcode Items are still missing enrichment.
- JSON export/merge, ordered JSON operations, undoable imports, and complete
  ZIP Backups containing SQLite plus photos. Recent import history is capped at
  five entries.
- Gentle Undo after Item moves, archives, quantity changes, bulk edits, and AI
  approvals, plus a Setup health view for HTTPS, authentication, Backup, AI,
  MQTT, updates, storage, and app version.
- Review-first external enrichment with a JSON document that includes
  instructions for ChatGPT or another research agent.
- Optional ntfy, Home Assistant MQTT, speech-to-text, and MCP integration.

## Security model

Findstuff contains private inventory data and administrative actions. The
official Docker setup:

- binds only to `127.0.0.1`;
- provides an in-app sign-in session and HTTP Basic authentication for API
  clients;
- generates a random administrator password;
- runs the application as an unprivileged container user;
- installs a narrow host-side watcher for authenticated in-app updates; and
- recommends private HTTPS through Tailscale Serve.

Do not publish port 8000 directly to the internet. Basic credentials must not
be sent over untrusted plain HTTP. Tailscale Serve, a VPN, or a correctly
configured HTTPS reverse proxy should be the external boundary.

The health endpoint and the static sign-in page are intentionally
unauthenticated. All other `/api/v1/` endpoints require an administrator
session or HTTP Basic credentials in the standard Docker deployment. Home
Assistant receives data through MQTT; Findstuff does not expose a separate
Home Assistant REST endpoint.

## Quick start with Docker

### Requirements

- Linux on amd64, arm64, or arm/v7.
- Git.
- Docker Engine with Docker Compose v2. On Debian, Ubuntu, Raspberry Pi OS, and
  Armbian, the installer can install the distribution packages for you.

Clone and run the installer:

```bash
git clone https://github.com/MrFanfo/FindStuffer.git
cd FindStuffer
./install.sh
```

Use `./install.sh --yes` for a non-interactive Debian-family install.
The script:

1. verifies or installs Docker and Compose;
2. copies `.env.example` to the ignored `.env`;
3. generates a 10-character random alphanumeric administrator password;
4. creates `./data` with the current user's UID and GID;
5. installs a systemd path watcher for secure in-app updates when systemd is
   available;
6. pulls the published multi-architecture image;
7. starts the service; and
8. waits for the health check and prints the local URL and credentials.

The installer may ask for `sudo` to install Docker, write the two updater units,
and start services. It does not run the Findstuff container as root. On a Linux
distribution without systemd, add `--no-systemd-updater`; the app still works
and updates use `./update-docker.sh`.

The first image may not be available until the repository's Container workflow
has completed and the GHCR package has been made public.

Open `http://127.0.0.1:8000` on the server for an initial check. For phone use,
configure HTTPS next.

### Manual Compose setup

```bash
cp .env.example .env
chmod 600 .env
nano .env
sed -i "s/^FINDSTUFF_UID=.*/FINDSTUFF_UID=$(id -u)/" .env
sed -i "s/^FINDSTUFF_GID=.*/FINDSTUFF_GID=$(id -g)/" .env
mkdir -p data
chmod 750 data
docker compose up -d
docker compose ps
```

Replace `CHANGE_ME_10_CHARS_MIN` with at least 10 characters
before starting. Keep the default update channel for one-click updates:

```env
FINDSTUFF_IMAGE=ghcr.io/mrfanfo/findstuffer:latest
```

`latest` follows the newest successful tagged release build and lets the in-app
updater pull the next release. Advanced users can pin a versioned tag for
reproducible deployments, but must change that tag manually to upgrade.

### Build locally

To build the multi-stage image from the checkout instead of pulling GHCR:

```bash
cp .env.example .env
nano .env
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

The frontend is built in a Node stage. Node, npm, and compilers are absent from
the final Python runtime image. `npm ci` uses `package-lock.json`, while Docker
runtime Python packages are pinned in `backend/requirements.lock`.

## Private HTTPS with Tailscale Serve

Camera, microphone, and reliable PWA installation require a browser secure
context. Tailscale Serve is the simplest private HTTPS option.

1. Install Tailscale using its
   [official Linux instructions](https://tailscale.com/download/linux).
2. Join the server and phone to the same tailnet:

   ```bash
   sudo tailscale up
   ```

3. Keep Findstuff bound to loopback in `.env`:

   ```env
   FINDSTUFF_BIND_ADDRESS=127.0.0.1
   FINDSTUFF_PORT=8000
   ```

4. Publish the local service privately with persistent HTTPS:

   ```bash
   tailscale serve --bg http://127.0.0.1:8000
   tailscale serve status
   ```

5. Open the displayed `https://<device>.<tailnet>.ts.net` URL on the phone and
   sign in with the administrator credentials printed by the installer. The
   browser and installed PWA retain that signed session for up to 90 days, so
   ordinary refreshes and launches do not ask again.

Tailscale access-control rules still apply to Serve. Serve is tailnet-private;
do not substitute `tailscale funnel`, which is designed for public internet
access. To remove the configuration:

```bash
tailscale serve reset
```

See the current [Tailscale Serve documentation](https://tailscale.com/docs/features/tailscale-serve)
and [CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

## Configuration

### Where `.env` is and how to edit it

`.env` is a hidden text file in the root of the cloned repository, beside
`docker-compose.yml` and `install.sh`. It is not a global system file. For
example, if the repository was cloned into `/opt/FindStuffer`, its path is
`/opt/FindStuffer/.env`. The installer creates it on its first run and keeps an
existing file unchanged on later runs.

Go to the checkout and confirm the location:

```bash
cd /path/to/FindStuffer
pwd
ls -la .env docker-compose.yml
```

Create a recoverable copy, then edit with a terminal editor:

```bash
cp .env .env.before-edit
nano .env
```

In `nano`, use the arrow keys to move, `Ctrl+O` then Enter to save, and
`Ctrl+X` to exit. `vi .env` or another plain-text editor works too. Each
setting is one `NAME=value` line. Do not add spaces around `=`, and keep lines
beginning with `#` as comments.

Protect the file and apply the new values:

```bash
chmod 600 .env
docker compose config --quiet
docker compose up -d
docker compose ps
```

If the service does not become healthy, inspect `docker compose logs
--tail=100` and restore the previous configuration with `cp
.env.before-edit .env && docker compose up -d`. Never post `.env` in an issue
or chat: it contains the administrator password and may contain provider
credentials.

Most users only edit `.env` for the image version, listening address/port,
container UID/GID, HTTPS cookies, backup schedule, or updater switch. Configure
the administrator password, AI, and MQTT in the app where possible.

### Administrator authentication

```env
FINDSTUFF_REQUIRE_AUTH=true
FINDSTUFF_ADMIN_USERNAME=admin
FINDSTUFF_ADMIN_PASSWORD=a-long-random-secret
```

For orchestrators that mount secrets as files, set
`FINDSTUFF_ADMIN_PASSWORD_FILE` instead of the password value. If
`FINDSTUFF_REQUIRE_AUTH=true` but no password is available, protected requests
fail closed with HTTP 503.

The installer prints its generated username and password once. Afterwards,
use the app's sign-in page. A successful browser login creates an HTTP-only,
same-site session cookie valid for up to 90 days. API clients can continue to
send HTTP Basic credentials on every request.

Open **Manage → Security** to change the password: enter the current password,
enter and confirm a new password of at least 10 characters, then sign in again
with the new value. The password change invalidates existing sessions.

An in-app password change is stored write-only in `data/admin-password` with
mode `0600` and takes precedence over `FINDSTUFF_ADMIN_PASSWORD` in `.env`.
The password is never returned by the API and is excluded from JSON exports
and full backup ZIPs.

For emergency recovery, stop Findstuff, move the override out of the way,
change the password in `.env`, and start it again:

```bash
docker compose down
mv data/admin-password data/admin-password.disabled
nano .env
docker compose up -d
```

Keep `.env` mode `0600`; it is excluded from Git and Docker build contexts.

### AI parser and AI Scan

Configure AI without editing Docker files:

1. Sign in and open **Manage → Integrations**.
2. Enable **AI parser & vision**.
3. Enter an OpenAI-compatible chat-completions URL, for example
   `https://api.openai.com/v1/chat/completions`.
4. Enter the provider's exact model name and API key.
5. Select **Save AI settings**, then **Test connection**.

The connection result includes a **Details** action. Open it to inspect the
HTTP status, provider reply, and a bounded response preview when a provider is
misconfigured. Findstuff redacts keys, tokens, passwords, and secrets before
returning this diagnostic to the browser.

The model must accept image content for AI Scan. Provider-specific endpoint,
model, image-size, rate-limit, and billing rules still apply. Photos sent to AI
Scan leave your server and are processed under the provider's privacy terms.
Findstuff center-crops AI Scan captures to the visible square, caps them at
1280 pixels, compresses them before upload, and requests compact structured
results without verbose reasoning. Results still include a short description
and up to eight useful specifications.
The API key is write-only: the browser receives only whether a key is saved.
Leaving the field empty keeps the current key; **Remove key** explicitly
deletes it.

The AI integration card shows current-month provider calls, input/output
tokens, failures, image upload savings, and all-time calls. Provider-reported
token counts are used when available; otherwise Findstuff shows a text
estimate. Vision token accounting varies by provider. Retail barcode scanning
is not included because it uses local decoding, the local cache, and Open Food
Facts rather than the configured AI provider.

Legacy `FINDSTUFF_AI_ENDPOINT`, `FINDSTUFF_AI_API_KEY`, and
`FINDSTUFF_AI_MODEL` environment values are used only until configuration is
saved in the app. This supports unattended provisioning, but normal users do
not need them.

To use it:

1. Open **Places** and select the destination Place.
2. Tap **AI Scan**.
3. Take several photos in succession. Each capture is queued independently, so
   the camera remains ready while earlier photos are processed.
4. Open **More → AI Inbox**. The Inbox is a dedicated photo-first review page,
   separate from Settings.
5. Review the detected name, brand, model, description, specifications, links,
   confidence, and captured image.
6. Review one suggestion at a time. Edit its fields, swipe right to approve,
   swipe left to reject, or use the visible **Approve**, **Reject**, and
   **Edit** buttons.
7. Approve to create the Item in the original Place, retry a failed
   suggestion, or reject it. AI approvals offer a temporary Undo action.

AI results never become Items before approval.

### Voice/AI Operations composer

Open **Capture → Voice/AI**, dictate or type the complete outcome you want, and
select **Compose & preview**. A single request can add, modify, move, or archive
Items and can create or update Categories and Places. The configured model
returns ordered Findstuff operations; Findstuff then validates them against a
temporary copy of the current database and shows the real import preview.

Review every line before selecting **Apply operations**. The application uses
the same import engine as `docs/IMPORT_OPERATIONS.md`, records the changes as
one batch, and keeps that batch among the latest five entries in **Extra →
Settings & data → Recent imports**, where it can be rolled back.

### Offline PWA capture

After Findstuff has been opened online at least once, the installed PWA can
open its cached shell and latest inventory snapshot without a connection. New
Items, photos, barcode values, and quantity adjustments are saved in IndexedDB
on that device. An offline banner shows how many changes are waiting.

When connectivity returns—or the PWA is reopened online—Findstuff sends the
queue in creation order. Each operation has a persistent idempotency key, so a
retry cannot apply the same create or quantity change twice. Failed operations
remain visible under **Extra** for retry or discard. Unsynchronized data exists
only on the capture device, so do not clear its site data before synchronization.

### Analytics

Open **Extra → Analytics** for current inventory health, purchase and estimated
value separated by currency, activity over 30/90/365 days, top Categories and
Places, and the most-consumed Items. Analytics is calculated by the Findstuff
server from local inventory and history data; it is not sent to the AI provider.

### Speech-to-text

Browser dictation works where the browser supports it. An external multipart
speech-to-text service is optional:

```env
FINDSTUFF_STT_ENDPOINT=https://speech-provider.example/v1/audio/transcriptions
FINDSTUFF_STT_API_KEY=
FINDSTUFF_STT_MODEL=
```

### Notifications with ntfy

Configure low-stock and expiration alerts under **Manage → Notifications**.
Use a complete topic URL such as `https://ntfy.sh/a-long-private-topic` or a
protected topic on your own ntfy server. Findstuff does not return a saved ntfy
token to the browser.

Public HTTPS destinations are allowed by default. If your own ntfy server uses
a private LAN or tailnet address, explicitly opt in:

```env
FINDSTUFF_ALLOW_PRIVATE_INTEGRATION_URLS=true
```

Only do this when every administrator who can sign into Findstuff is trusted to
configure integrations. Restart with `docker compose up -d` after changing the
environment.

### Downloaded item photos

Remote image import follows redirects, validates image signatures, and limits
downloads to 5 MB. It also requires an exact trusted hostname:

```env
FINDSTUFF_EXTERNAL_IMAGE_HOSTS=images.openfoodfacts.org,static.example.com
```

Do not add wildcard or untrusted upload hosts. Camera uploads and normal local
photo uploads do not use this setting.

### Home Assistant MQTT

Findstuff uses MQTT discovery instead of a Home Assistant REST sensor:

1. Ensure Home Assistant has an MQTT broker and the MQTT integration is
   connected to it.
2. Create or choose broker credentials that Findstuff may use.
3. In Findstuff, open **Manage → Integrations → Home Assistant MQTT**.
4. Enter the broker hostname or IP reachable from the Findstuff container,
   port (normally `1883`), username, and password.
5. Keep `homeassistant` as the discovery prefix unless it was changed in Home
   Assistant. The default Findstuff base topic is `findstuff`.
6. Save, then select **Test connection**.

The publisher reloads immediately; no container restart is needed. Home
Assistant should discover a Findstuff device containing item, location,
low-stock, expiration, needs-details, and online sensors. If Home Assistant and
Findstuff run in separate containers, `localhost` means the Findstuff container
itself—use a LAN address, resolvable hostname, or shared Docker-network broker
name instead.

The MQTT password is write-only. Leaving it blank keeps the current password;
**Remove password** explicitly deletes it. Legacy `FINDSTUFF_MQTT_*`
environment values seed the form until settings are saved in the app.

### Backups

```env
FINDSTUFF_AUTO_BACKUP_ENABLED=true
FINDSTUFF_BACKUP_DIR=/app/data/backups
FINDSTUFF_BACKUP_KEEP=14
FINDSTUFF_BACKUP_CHECK_INTERVAL_SECONDS=3600
```

Automatic Backups use SQLite's online backup API. The **Backup & data** screen
shows when the last automatic Backup completed, how many are retained, and
whether the schedule is active. A Backup in the same host
data directory protects against application mistakes, not host/disk failure.
Download a full ZIP regularly or copy backups to another device.

## Export, import, and ChatGPT workflows

Open **Manage → Backup & data**.

### Inventory JSON export

**Download JSON export** produces `findstuff-export-v1`, containing the
inventory tables needed for a merge. It is suitable for moving structured data
between Findstuff instances.

To import:

1. Choose **Import JSON**.
2. Select a Findstuff export.
3. Inspect the dry-run counts, row details, and errors.
4. Select **Merge into this inventory** only after the preview is clean.
5. If necessary, use **Recent imports → Undo**. Findstuff retains the latest
   five import records and automatically removes older import history.

Imports merge rather than replace the live database. Keep an independent backup
before a large import.

### Full backup ZIP

**Download full backup ZIP** contains:

- `findstuff.sqlite3`;
- `photos/`; and
- `manifest.json`.

This is the disaster-recovery artifact. It contains private inventory, notes,
serial numbers, integration configuration, and photos; store and transmit it
accordingly. It deliberately excludes the AI API key and MQTT password, so
re-enter those two write-only secrets after a restore. Docker restore procedures are in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

To restore entirely in the app:

1. Open **Manage → Backup & data → Restore a full backup**.
2. Choose a Findstuff backup ZIP and confirm the replacement.
3. Findstuff validates the manifest, archive paths, compression limits, SQLite
   integrity, required tables, and referenced photo files before accepting it.
4. The container restarts and applies the replacement before opening any live
   database connections.
5. A copy of the replaced database and photos is retained automatically under
   `data/backups/pre-restore/`.
6. After the page reconnects, verify the restored inventory and re-enter the AI
   API key and MQTT password.

An invalid or unsafe ZIP is rejected without changing live data. If applying a
validated backup fails, Findstuff rolls back to the previous database and
photos and records the failure under `data/.restore/restore-status.json`.

### Ordered operations JSON

The built-in operations template is a chatbot-ready `findstuff-ops-v1` guide
for adding, moving, modifying, or archiving locations, categories, and items.
It includes all operation types plus the current category/location paths,
location kinds, and units. Give it to a chatbot with a plain-language request,
then import the returned JSON. Operations run in order, are dry-run previewed
before application, and the latest five tracked imports can be undone. The
complete workflow, prompt example, fields, matching rules, and safety limits are
documented in
[docs/IMPORT_OPERATIONS.md](docs/IMPORT_OPERATIONS.md).

### External enrichment with ChatGPT or another agent

This workflow researches missing product metadata without giving the agent
direct database access:

1. Open **Manage → External enrichment review**.
2. Select **Export request JSON**.
3. Upload the JSON to ChatGPT or another web/research agent.
4. Tell it: “Follow the instructions and response schema embedded in this
   document. Research each item, cite source URLs, and return only the response
   JSON.”
5. Download the returned JSON without reformatting it.
6. Select **Import response JSON** in Findstuff.
7. Review every proposed patch and accept or reject it.

The request schema is `findstuff.enrichment_request.v1`; the required response
schema is `findstuff.enrichment_response.v1`. The export includes its unique
`export_id`, item public IDs, weak fields, existing non-locked metadata, and
explicit response instructions. The importer rejects unsupported or protected
paths. Quantity, location, private notes, purchase data, and serial numbers are
not agent-writable. Price suggestions always require review.

Photos are represented by authenticated local URLs. A cloud ChatGPT session
cannot fetch a loopback or tailnet-only URL unless you separately provide the
image. Treat every enrichment export as personal data even though protected
inventory fields are omitted.

The exact schema and a response example are in
[docs/EXTERNAL_ENRICHMENT.md](docs/EXTERNAL_ENRICHMENT.md). A reusable agent
guide lives at `skills/findstuff-enrichment-agent/SKILL.md`.

## Updating from the app or host

The normal `./install.sh` setup enables **More → Software update**. The panel
compares the installed version with the latest published GitHub release.
Pressing **Install update**:

1. requires the normal administrator login;
2. writes only `data/update-request`;
3. wakes the root-owned `findstuff-update.path` systemd watcher;
4. resolves and pulls the configured published container image;
5. recreates the service from that image; and
6. waits for the unauthenticated health endpoint before reporting success.

The browser cannot choose a repository, branch, command, or filesystem path.
The container has no Docker socket and no host root access. Progress,
installed/latest versions, and the last 30 log lines appear in the Software
update panel. The updater never reads, fetches, merges, resets, or otherwise
changes the Git checkout, so development work and uncommitted tracked files do
not affect installed-app updates.

Check the host watcher:

```bash
systemctl status findstuff-update.path --no-pager
journalctl -u findstuff-update.service -n 100 --no-pager
```

You can perform exactly the same update directly from the checkout:

```bash
./update-docker.sh
```

An update stops if Docker cannot pull the configured image, Compose cannot
recreate the service, or the new container fails its health check. Application
data and the source checkout are untouched.

`latest` is the simplest channel and is required for automatic image upgrades
from the app. For controlled production releases, set a version in `.env`, for
example `FINDSTUFF_IMAGE=ghcr.io/mrfanfo/findstuffer:v1.7.3`; change that value
manually before running the updater. To roll back, restore the prior image tag and run
`docker compose up -d`. Download a backup before crossing versions.

To deliberately disable the app button:

```bash
sudo systemctl disable --now findstuff-update.path
```

Set `FINDSTUFF_SOFTWARE_UPDATE_ENABLED=false` in `.env`, then run
`docker compose up -d`.

## Data and container operations

Persistent data is bind-mounted from `./data`:

- `data/findstuff.sqlite3` is the SQLite database;
- `data/photos/` contains uploaded and captured photos;
- `data/ai-scans/` contains pending AI Scan captures;
- `data/admin-password` contains an in-app administrator password override
  with mode `0600`;
- `data/session-secret` signs browser sessions and has mode `0600`;
- `data/service-secrets.json` contains the write-only AI key and MQTT password
  with mode `0600`;
- `data/backups/` contains automatic local backups;
- `data/.restore/` contains only restore staging and the latest restore status;
- `data/backups/pre-restore/` contains automatic safety copies made before an
  in-app full restore; and
- updater request, status, and log files also live under `data/`.

The directory is ignored by Git and excluded from Docker builds.

Inventory JSON exports and full backup ZIPs exclude `data/admin-password`,
`data/session-secret`, and `data/service-secrets.json`. After restoring or
moving an installation, configure a new administrator password and re-enter
the AI API key and MQTT password under **Manage → Integrations**.

```bash
docker compose ps
docker compose logs -f --tail=100
docker compose restart
docker compose stop
docker compose down
```

`docker compose down` preserves `./data`. Do not delete or replace that
directory unless you deliberately intend to remove the inventory and already
have a tested backup.

Before copying data manually, stop the application:

```bash
docker compose stop
tar -C . -czf "findstuff-data-$(date +%F).tar.gz" data
docker compose start
```

The preferred live backup remains **Manage → Backup & data → Download full
backup ZIP**, because it uses SQLite's online backup API correctly.

To see the resolved configuration without printing secrets:

```bash
docker compose config --services
docker compose config --images
```

## Development

Backend:

```bash
python3 -m venv .venv
.venv/bin/pip install -e 'backend[dev]'
.venv/bin/uvicorn findstuff.app:app --app-dir backend --reload
```

Frontend:

```bash
cd frontend
npm ci
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8000`. Development leaves
`FINDSTUFF_REQUIRE_AUTH` false unless you explicitly enable it. Never use that
mode on an exposed interface.

Checks:

```bash
.venv/bin/ruff check backend
.venv/bin/pytest -q
npm --prefix frontend run typecheck
npm --prefix frontend run build
./scripts/local-check.sh
```

### MCP server

```bash
.venv/bin/findstuff mcp
```

Example client configuration after replacing `${HOME}` with an absolute path
supported by the client:

```json
{
  "mcpServers": {
    "findstuff": {
      "command": "/opt/findstuff/.venv/bin/findstuff",
      "args": ["mcp"],
      "env": {
        "FINDSTUFF_DATA_DIR": "/var/lib/findstuff",
        "FINDSTUFF_DATABASE_PATH": "/var/lib/findstuff/findstuff.sqlite3"
      }
    }
  }
}
```

The MCP server can mutate inventory. Run it only for trusted local clients and
point it at the intended database.

## Public repository hygiene

Never commit `.env`, data directories, SQLite files, photos, exports, backups,
Graphify output, local paths, credentials, or private network details.
`.gitignore` and `.dockerignore` cover the standard locations, but they do not
replace review. Before a release, run the test suite, inspect `git status`, and
scan both the current tree and Git history for secrets.

If sensitive data was ever committed, deleting it in a later commit is not
enough. Publish a clean squashed repository or rewrite all affected history,
then rotate any exposed credential.

## Contributing, security, and license

See [CONTRIBUTING.md](CONTRIBUTING.md) for development expectations and
[SECURITY.md](SECURITY.md) for private vulnerability reporting. Findstuff is
free software under the
[GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`). You
may use, modify, redistribute, and charge for copies, subject to the license's
strong copyleft and source-availability requirements—including its
network-interaction requirement for modified versions. Versions already
published under MIT remain available under their original license.
