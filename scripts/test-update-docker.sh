#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

INSTALL="$TEST_ROOT/install"
FAKE_BIN="$TEST_ROOT/bin"
DOCKER_LOG="$TEST_ROOT/docker.log"

mkdir -p "$INSTALL"
cp "$PROJECT_ROOT/update-docker.sh" "$INSTALL/update-docker.sh"
printf 'services:\n  findstuff:\n    image: ghcr.io/mrfanfo/findstuffer:latest\n' \
  >"$INSTALL/docker-compose.yml"
printf 'FINDSTUFF_PORT=8000\n' >"$INSTALL/.env"
# A deployment directory deliberately has no Git checkout. Local files must
# never participate in a published-image update.
printf 'developer work in progress\n' >"$INSTALL/local-source-change"

mkdir -p "$FAKE_BIN"
cat >"$FAKE_BIN/docker" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$DOCKER_LOG"
if [[ "\$*" == "info" ]]; then
  exit 0
fi
if [[ "\$*" == "compose config --images" ]]; then
  printf '%s\n' 'ghcr.io/mrfanfo/findstuffer:latest'
fi
EOF
printf '#!/usr/bin/env bash\nprintf '"'"'{"status":"ok","version":"9.9.9"}'"'"'\n' >"$FAKE_BIN/curl"
chmod +x "$FAKE_BIN/docker" "$FAKE_BIN/curl"

PATH="$FAKE_BIN:$PATH" "$INSTALL/update-docker.sh"

test ! -e "$INSTALL/data/update-request"
grep -q '"status": "complete"' "$INSTALL/data/update-status.json"
grep -q '"version": "9.9.9"' "$INSTALL/data/update-status.json"
grep -q '^compose pull$' "$DOCKER_LOG"
grep -q '^compose up -d --remove-orphans$' "$DOCKER_LOG"
grep -q '^compose ps$' "$DOCKER_LOG"
echo "Updater integration test passed."
