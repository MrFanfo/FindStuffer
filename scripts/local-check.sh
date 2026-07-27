#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${FINDSTUFF_VENV:-$ROOT/.venv}"
DATA_DIR="${FINDSTUFF_DATA_DIR:-$ROOT/.local-data}"
HOST="${FINDSTUFF_HOST:-127.0.0.1}"
PORT="${FINDSTUFF_PORT:-8000}"
URL="http://$HOST:$PORT/"

usage() {
  cat <<'EOF'
Run Findstuff locally without a Banana Pi/Raspberry Pi.

Usage:
  ./scripts/local-check.sh

Environment overrides:
  FINDSTUFF_DATA_DIR   Local data folder, default: ./.local-data
  FINDSTUFF_HOST       Bind host, default: 127.0.0.1
  FINDSTUFF_PORT       Backend port, default: 8000

This script builds the production PWA, installs missing local dev
dependencies when needed, starts FastAPI, and stores test data outside
the Pi deployment paths.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command python3
require_command npm

if [[ ! -x "$VENV/bin/python" ]]; then
  echo "Creating local Python environment: $VENV"
  python3 -m venv "$VENV"
fi

if ! "$VENV/bin/python" -c 'import findstuff' >/dev/null 2>&1; then
  echo "Installing backend dependencies into $VENV"
  "$VENV/bin/pip" install --disable-pip-version-check --prefer-binary -e "$ROOT/backend[dev]"
fi

if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
  echo "Installing frontend dependencies"
  npm --prefix "$ROOT/frontend" install
fi

echo "Building production frontend"
npm --prefix "$ROOT/frontend" run build

mkdir -p "$DATA_DIR"
export FINDSTUFF_DATA_DIR="$DATA_DIR"
export FINDSTUFF_FRONTEND_DIST="$ROOT/frontend/dist"

echo
echo "Starting Findstuff locally."
echo "Open: $URL"
echo "Data: $DATA_DIR"
echo "Stop: Ctrl+C"
echo

exec "$VENV/bin/uvicorn" findstuff.app:app --app-dir "$ROOT/backend" --host "$HOST" --port "$PORT"
