# Deployment and recovery

The supported deployment for Linux laptops, servers, Raspberry Pi, and similar
boards is Docker Compose. The container image is published for amd64, arm64,
and arm/v7.

## One-command installation

```bash
git clone https://github.com/MrFanfo/FindStuffer.git
cd FindStuffer
./install.sh
```

On Debian, Ubuntu, Raspberry Pi OS, and Debian-derived Armbian, the installer
can install Docker Engine and Compose v2. Options:

```text
--yes                  accept missing package installation
--no-install-docker    require Docker to be preinstalled
--no-systemd-updater   skip the in-app update watcher
```

The generated `.env` and `data/` directory stay on the host and are excluded
from Git and the Docker build context. Compose binds to loopback by default and
runs the application with the installing user’s UID/GID, all Linux
capabilities dropped, and `no-new-privileges`.

## Deployment layout

```text
findstuff/
├── .env                 private runtime configuration
├── docker-compose.yml
├── data/
│   ├── findstuff.sqlite3
│   ├── photos/
│   ├── ai-scans/
│   ├── backups/
│   ├── admin-password      optional write-only password override
│   ├── session-secret      local browser-session signing secret
│   ├── update-status.json
│   └── update.log
└── update-docker.sh
```

The container receives only `./data:/app/data`. It does not receive the Docker
socket, the Git checkout, the host root filesystem, or host credentials.

## HTTPS and network exposure

The default supports localhost and trusted-LAN access without per-machine
configuration:

```env
FINDSTUFF_BIND_ADDRESS=0.0.0.0
FINDSTUFF_PORT=8000
FINDSTUFF_REQUIRE_AUTH=true
FINDSTUFF_SECURE_COOKIES=false
```

Use Tailscale Serve for private HTTPS:

```bash
tailscale serve --bg http://127.0.0.1:8000
```

`0.0.0.0` listens on every host network interface; it does not bypass a router
or firewall. Keep authentication enabled, use LAN HTTP only on a trusted
network, and do not port-forward the application's plain HTTP port or open it
in a public cloud firewall. Alternatively, configure a trusted HTTPS reverse
proxy or VPN. Set `FINDSTUFF_BIND_ADDRESS=127.0.0.1` for an intentionally
loopback-only deployment.

Leave `FINDSTUFF_SECURE_COOKIES=false` when supporting both LAN HTTP and HTTPS.
Findstuff automatically marks session cookies as secure for HTTPS requests;
forcing this setting to `true` makes browsers withhold the session cookie from
plain HTTP and therefore prevents LAN HTTP sign-in.

## In-app update mechanism

When systemd is active, `./install.sh` installs:

- `/etc/systemd/system/findstuff-update.path`; and
- `/etc/systemd/system/findstuff-update.service`.

The authenticated Update button writes `data/update-request`. The path unit
starts the one-shot service, which calls the installation’s
`update-docker.sh --from-app`. The script:

- locks against concurrent updates;
- ignores all request-file content;
- resolves the configured published container image;
- pulls and recreates the Compose service without invoking Git;
- verifies `/api/v1/health`; and
- writes a bounded status document and log for the UI.

This design keeps Docker/root access outside the web process. Manual updates
use the same script. The Git checkout may contain in-progress development
changes because it is never inspected or modified by an installed-app update:

```bash
./update-docker.sh
```

## Backup

The UI’s full backup ZIP is the preferred live backup. It contains a consistent
SQLite copy, photos, and a manifest. It deliberately excludes the administrator
password override, browser-session signing secret, write-only AI API key, and
MQTT password. Store it off the Findstuff host.

For a cold filesystem copy:

```bash
docker compose stop
tar -C . -czf "findstuff-data-$(date +%F).tar.gz" data
docker compose start
```

Do not copy only a live `findstuff.sqlite3` while ignoring its WAL/SHM files.

## Restore

The normal restore path is fully in-app:

1. Sign in to the target Findstuff installation.
2. Open **Manage → Backup & data → Restore a full backup**.
3. Select the ZIP, review the destructive confirmation, and continue.
4. Wait while the container restarts and the page reconnects.
5. Verify items and photos, then re-enter the write-only AI and MQTT secrets.

The app validates the archive and creates a safety copy under
`data/backups/pre-restore/` before replacing anything. Docker's
`restart: unless-stopped` brings the service back automatically.

The manual procedure below is the recovery path when the web interface is
unavailable.

For a full backup ZIP:

1. Keep the original archive unchanged.
2. Stop Findstuff: `docker compose stop`.
3. Move the current `data` directory to a dated safety name.
4. Create a new `data` directory owned by the UID/GID in `.env`.
5. Extract `findstuff.sqlite3` and `photos/` from the ZIP into it.
6. Start: `docker compose up -d`.
7. Re-enter the AI API key and MQTT password under **Manage → Integrations**.
8. Verify the health endpoint and inspect several items/photos.

Example ownership check:

```bash
grep '^FINDSTUFF_\\(UID\\|GID\\)=' .env
ls -ld data
```

Never overwrite the only copy of the live data during a restore. Keep the
pre-restore directory until the restored app has been tested.

## Troubleshooting

```bash
docker compose config --quiet
docker compose ps
docker compose logs --tail=200
curl -i http://127.0.0.1:8000/api/v1/health
systemctl status findstuff-update.path findstuff-update.service --no-pager
journalctl -u findstuff-update.service -n 100 --no-pager
```

Common causes:

- **401 in the browser:** use the username/password in `.env`.
- **503 authentication configuration error:** authentication is required but
  no administrator password is configured.
- **Permission denied under `/app/data`:** make `data/` ownership match
  `FINDSTUFF_UID:FINDSTUFF_GID`.
- **Update stays queued:** the path unit is not active or the checkout moved
  after installation; rerun `./install.sh`.
- **Update cannot pull an image:** confirm `FINDSTUFF_IMAGE` references a
  published GHCR tag/channel and that the host can reach the registry.
- **Camera unavailable:** use HTTPS or localhost; plain LAN HTTP is not a
  secure browser context.
- **Image unavailable:** wait for the repository Container workflow to publish
  the requested tag, or build locally with `docker-compose.build.yml`.
