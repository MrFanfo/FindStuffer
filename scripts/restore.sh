#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$EUID" -ne 0 ]]; then
  exec sudo bash "$0" "$@"
fi

if [[ "$#" -ne 1 || ! -f "$1/findstuff.sqlite3" || ! -f "$1/manifest.json" ]]; then
  echo "Usage: sudo ./scripts/restore.sh /path/to/backup/TIMESTAMP" >&2
  exit 2
fi

BACKUP_DIR="$(cd -- "$1" && pwd)"
DATA_DIR="${FINDSTUFF_DATA_DIR:-/var/lib/findstuff}"
SAFETY_DIR="$DATA_DIR/pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"

sqlite3 "$BACKUP_DIR/findstuff.sqlite3" 'PRAGMA quick_check;' | grep -qx ok || {
  echo "Backup database failed SQLite quick_check." >&2
  exit 1
}

read -r -p "Restore $BACKUP_DIR over the current inventory? Type RESTORE: " answer
[[ "$answer" == "RESTORE" ]] || { echo "Cancelled."; exit 1; }

systemctl stop findstuff.service
install -d -o findstuff -g findstuff -m 0750 "$SAFETY_DIR"
if [[ -f "$DATA_DIR/findstuff.sqlite3" ]]; then
  cp -a "$DATA_DIR/findstuff.sqlite3" "$SAFETY_DIR/"
fi
if [[ -d "$DATA_DIR/photos" ]]; then
  cp -a "$DATA_DIR/photos" "$SAFETY_DIR/"
fi
install -o findstuff -g findstuff -m 0640 "$BACKUP_DIR/findstuff.sqlite3" "$DATA_DIR/findstuff.sqlite3"
if [[ -d "$BACKUP_DIR/photos" ]]; then
  rm -rf "$DATA_DIR/photos"
  cp -a "$BACKUP_DIR/photos" "$DATA_DIR/photos"
  chown -R findstuff:findstuff "$DATA_DIR/photos"
fi
systemctl start findstuff.service
echo "Restore complete. Previous live data is in $SAFETY_DIR"
