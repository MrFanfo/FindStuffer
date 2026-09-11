#!/usr/bin/env bash
# Advertise this host as findstuff.local without changing its OS hostname.
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then
  echo "Run with sudo: sudo ./scripts/configure-local-hostname.sh" >&2
  exit 1
fi
python3 - <<'PY'
from pathlib import Path
import shutil

path = Path('/etc/avahi/avahi-daemon.conf')
if not path.is_file():
    raise SystemExit('Install avahi-daemon first; no configuration was changed.')
backup = path.with_name('avahi-daemon.conf.before-findstuff')
if not backup.exists():
    shutil.copy2(path, backup)
lines = path.read_text().splitlines()
section = ''
found = False
for index, line in enumerate(lines):
    if line.startswith('['):
        section = line
    if section == '[server]' and line.lstrip('#').startswith('host-name='):
        lines[index] = 'host-name=findstuff'
        found = True
if not found:
    lines.insert(lines.index('[server]') + 1, 'host-name=findstuff')
path.write_text('\n'.join(lines) + '\n')
print(f'Original configuration saved at {backup}')
PY
systemctl restart avahi-daemon
systemctl is-active avahi-daemon
printf '%s\n' 'Open http://findstuff.local:8000/ from a device on the same LAN.'
