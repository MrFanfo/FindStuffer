# Raspberry Pi and small-board setup

This guide installs Findstuff on a Raspberry Pi, Banana Pi, or similar
Debian-family Linux board. The supported public deployment is Docker Compose,
using the same `./install.sh` command as a laptop or server.

## Hardware and operating system

Recommended:

- Raspberry Pi Zero 2 W or newer, or an equivalent arm64/armv7 board;
- a reliable power supply;
- a 16 GB or larger high-endurance microSD card; and
- Raspberry Pi OS Lite, Debian, Ubuntu Server, or minimal Armbian.

Use a 64-bit image where the board supports it. A graphical desktop consumes
scarce memory and is unnecessary. The published container supports Linux
amd64, arm64, and arm/v7.

For Raspberry Pi, Raspberry Pi Imager can preconfigure the hostname, account,
Wi-Fi, timezone, and SSH key. For Armbian, finish its first-login account
creation before continuing.

## Prepare the board

Connect with SSH:

```bash
ssh YOUR_USER@findstuff.local
```

Update the OS and install Git:

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y git ca-certificates
sudo reboot
```

After reconnecting, clone Findstuff and run the universal installer:

```bash
git clone https://github.com/MrFanfo/FindStuffer.git
cd FindStuffer
./install.sh
```

Use `./install.sh --yes` to accept the installer’s Debian package installation
without a prompt. The installer:

- installs Docker Engine and Compose v2 if necessary;
- generates an ignored `.env` and a 10-character random alphanumeric
  administrator password;
- creates the persistent `./data` directory;
- pulls the image matching the board architecture;
- enables the host-side systemd watcher used by the app’s Update button;
- starts Findstuff on localhost and the board's LAN address at port `8000`; and
- waits for a successful health check.

Save the printed password in a password manager. You can change it later under
**Manage → Security**; the replacement must be at least 10 characters.

## Private HTTPS for a phone

Camera access and PWA installation need a secure browser context. Tailscale
Serve is the easiest private option:

1. Install Tailscale from its official Linux instructions.
2. Join the board and phone to the same tailnet.
3. Run:

   ```bash
   sudo tailscale up
   tailscale serve --bg http://127.0.0.1:8000
   tailscale serve status
   ```

4. Open the displayed `https://…ts.net` address on the phone and sign in. The
   browser and installed PWA retain a signed session for up to 90 days, so
   ordinary launches and refreshes do not ask for the password again.

Keep the default `FINDSTUFF_BIND_ADDRESS=0.0.0.0` to support localhost, trusted
LAN access, and the loopback Tailscale Serve target together. Tailscale Serve
is private to the tailnet; Tailscale Funnel is public and is not recommended
here. Do not port-forward port `8000` on the router.

## Verify and operate

```bash
curl http://127.0.0.1:8000/api/v1/health
docker compose ps
docker compose logs --tail=100
systemctl status findstuff-update.path --no-pager
```

Update from **Manage → Software update → Update Findstuff**, or run:

```bash
./update-docker.sh
```

The updater preserves `./data`, accepts only a fast-forward of the checkout’s
current branch from its existing `origin`, pulls the container, and waits for a
healthy restart.

## Backups and SD-card care

Automatic backups live under `data/backups`, but a backup on the same card does
not protect against card failure. Regularly download a full backup ZIP from
**Extra → Data → Backup & export** and copy it to another computer or disk.

Also:

- use a high-endurance card and stable power;
- shut down with `sudo poweroff`;
- avoid a large swap file on the SD card; zram is preferable;
- test one reboot and one restore before relying on the installation; and
- keep the OS and Docker packages patched.

First-run environment settings, in-app AI and MQTT configuration, AI Scan,
import/export, updates, and recovery are documented in the project
[README](../README.md).
