#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$ROOT/data"
REQUEST_PATH="$DATA_DIR/update-request"
STATUS_PATH="$DATA_DIR/update-status.json"
LOG_PATH="$DATA_DIR/update.log"
FROM_APP=0

if [[ "${1:-}" == "--from-app" ]]; then
  FROM_APP=1
elif [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: ./update-docker.sh [--from-app]"
  exit 0
elif [[ -n "${1:-}" ]]; then
  echo "Usage: ./update-docker.sh [--from-app]" >&2
  exit 2
fi

mkdir -p "$DATA_DIR"
touch "$LOG_PATH"
chmod 0644 "$LOG_PATH"

if command -v flock >/dev/null 2>&1; then
  exec 9>"$DATA_DIR/update.lock"
  if ! flock -n 9; then
    echo "Another Findstuff update is already running." >&2
    exit 1
  fi
fi

timestamp() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

write_status() {
  local state="$1"
  local message="$2"
  local version="${3:-}"
  local started_at="${UPDATE_STARTED_AT:-}"
  local completed_at=""
  if [[ "$state" == "complete" || "$state" == "failed" ]]; then
    completed_at="$(timestamp)"
  fi
  local temporary
  temporary="$(mktemp "$DATA_DIR/.update-status.XXXXXX")"
  printf '{\n  "status": "%s",\n  "message": "%s",\n  "requested_at": null,\n  "started_at": "%s",\n  "completed_at": %s,\n  "version": %s\n}\n' \
    "$state" "$message" "$started_at" \
    "$([[ -n "$completed_at" ]] && printf '"%s"' "$completed_at" || printf 'null')" \
    "$([[ -n "$version" ]] && printf '"%s"' "$version" || printf 'null')" \
    >"$temporary"
  chmod 0644 "$temporary"
  if [[ "$EUID" -eq 0 ]]; then
    chown --reference="$DATA_DIR" "$temporary" 2>/dev/null || true
  fi
  mv -f "$temporary" "$STATUS_PATH"
}

UPDATE_STARTED_AT="$(timestamp)"
update_succeeded=0
on_exit() {
  local result=$?
  if [[ "$update_succeeded" -ne 1 ]]; then
    write_status failed "Update failed. Review the updater log and retry." || true
  fi
  rm -f "$REQUEST_PATH"
  exit "$result"
}
trap on_exit EXIT

exec > >(tee -a "$LOG_PATH") 2>&1
echo
echo "[$UPDATE_STARTED_AT] Starting Findstuff update."
write_status running "Fetching the configured Git origin and refreshing containers."
rm -f "$REQUEST_PATH"

cd "$ROOT"
GIT=(git -c "safe.directory=$ROOT" -C "$ROOT")

if [[ ! -d "$ROOT/.git" ]]; then
  echo "This installation is not a Git checkout."
  exit 1
fi
if [[ -n "$("${GIT[@]}" status --porcelain --untracked-files=no)" ]]; then
  echo "Tracked files have local changes. Commit or restore them before updating."
  exit 1
fi
branch="$("${GIT[@]}" symbolic-ref --quiet --short HEAD)" || {
  echo "The checkout is detached. Switch to the release branch before updating."
  exit 1
}
"${GIT[@]}" remote get-url origin >/dev/null
"${GIT[@]}" fetch --prune origin "$branch"
"${GIT[@]}" merge --ff-only -- "origin/$branch"

if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
elif [[ "$EUID" -eq 0 ]] && docker info >/dev/null 2>&1; then
  DOCKER=(docker)
elif [[ "$FROM_APP" -ne 1 ]] && command -v sudo >/dev/null 2>&1 \
  && sudo docker info >/dev/null 2>&1; then
  DOCKER=(sudo docker)
else
  echo "Cannot access the Docker daemon." >&2
  exit 1
fi

"${DOCKER[@]}" compose pull
"${DOCKER[@]}" compose up -d --remove-orphans
"${DOCKER[@]}" compose ps

port="$(sed -n 's/^FINDSTUFF_PORT=//p' "$ROOT/.env" | tail -n 1)"
port="${port:-8000}"
ready=0
installed_version=""
for _ in $(seq 1 45); do
  health_response="$(curl --fail --silent "http://127.0.0.1:${port}/api/v1/health" || true)"
  if [[ -n "$health_response" ]]; then
    installed_version="$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' <<<"$health_response")"
    ready=1
    break
  fi
  sleep 2
done
if [[ "$ready" -ne 1 ]]; then
  echo "The updated container did not become healthy."
  exit 1
fi

write_status complete "Findstuff is up to date and healthy." "$installed_version"
update_succeeded=1
echo "[$(timestamp)] Findstuff update complete at version ${installed_version:-unknown}."
