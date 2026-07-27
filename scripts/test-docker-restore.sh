#!/usr/bin/env bash
set -Eeuo pipefail

IMAGE="${FINDSTUFF_TEST_IMAGE:-ghcr.io/mrfanfo/findstuffer:latest}"
CONTAINER_NAME="findstuff-restore-smoke-$$"
HOST_PORT="$((20000 + ($$ % 20000)))"
WORK_DIR="$(mktemp -d)"
DATA_DIR="${WORK_DIR}/data"
BASE_URL="http://127.0.0.1:${HOST_PORT}"
AUTH="restore-test:restore-test-password"

cleanup() {
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  docker run --rm --user 0 -v "${WORK_DIR}:/cleanup" \
    "${IMAGE}" chmod -R a+rwX /cleanup >/dev/null 2>&1 || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

mkdir -p "${DATA_DIR}"
chmod 0777 "${DATA_DIR}"

docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  -p "127.0.0.1:${HOST_PORT}:8000" \
  -v "${DATA_DIR}:/app/data" \
  -e FINDSTUFF_REQUIRE_AUTH=true \
  -e FINDSTUFF_ADMIN_USERNAME=restore-test \
  -e FINDSTUFF_ADMIN_PASSWORD=restore-test-password \
  -e FINDSTUFF_AUTO_BACKUP_ENABLED=false \
  "${IMAGE}" >/dev/null

for _ in $(seq 1 90); do
  if curl --fail --silent "${BASE_URL}/api/v1/health" >/dev/null; then
    break
  fi
  sleep 1
done
curl --fail --silent "${BASE_URL}/api/v1/health" >/dev/null

curl --fail --silent --user "${AUTH}" \
  -H "Content-Type: application/json" \
  -d '{"name":"Included in backup","quantity":"1","unit":"pcs"}' \
  "${BASE_URL}/api/v1/items" >/dev/null

curl --fail --silent --user "${AUTH}" \
  "${BASE_URL}/api/v1/admin/backup" \
  -o "${WORK_DIR}/backup.zip"

curl --fail --silent --user "${AUTH}" \
  -H "Content-Type: application/json" \
  -d '{"name":"Must disappear after restore","quantity":"1","unit":"pcs"}' \
  "${BASE_URL}/api/v1/items" >/dev/null

curl --fail --silent --user "${AUTH}" \
  -H "Content-Type: application/zip" \
  --data-binary "@${WORK_DIR}/backup.zip" \
  "${BASE_URL}/api/v1/admin/restore?filename=findstuff-backup.zip" \
  -o "${WORK_DIR}/restore-response.json"

for _ in $(seq 1 120); do
  if curl --fail --silent --user "${AUTH}" \
    "${BASE_URL}/api/v1/admin/restore" \
    -o "${WORK_DIR}/restore-status.json" 2>/dev/null \
    && python3 -c '
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    raise SystemExit(0 if json.load(handle).get("status") == "complete" else 1)
' "${WORK_DIR}/restore-status.json"; then
    break
  fi
  sleep 1
done

curl --fail --silent --user "${AUTH}" \
  "${BASE_URL}/api/v1/dashboard" \
  -o "${WORK_DIR}/dashboard.json"

python3 -c '
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    dashboard = json.load(handle)
if dashboard.get("item_count") != 1:
    raise SystemExit(f"Expected one restored item, got {dashboard.get('item_count')}")
' "${WORK_DIR}/dashboard.json"

test -f "${DATA_DIR}/.restore/restore-status.json"
test -d "${DATA_DIR}/backups/pre-restore"
echo "Docker full-backup restore smoke test passed."
