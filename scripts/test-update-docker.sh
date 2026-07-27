#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

REMOTE="$TEST_ROOT/remote.git"
SEED="$TEST_ROOT/seed"
INSTALL="$TEST_ROOT/install"
FAKE_BIN="$TEST_ROOT/bin"

git init --bare --quiet "$REMOTE"
git clone --quiet "$REMOTE" "$SEED"
git -C "$SEED" config user.name "Findstuff updater test"
git -C "$SEED" config user.email "updater-test@example.invalid"
cp "$PROJECT_ROOT/update-docker.sh" "$SEED/update-docker.sh"
printf 'data/\n.env\n' >"$SEED/.gitignore"
printf 'services: {}\n' >"$SEED/docker-compose.yml"
git -C "$SEED" add .gitignore docker-compose.yml update-docker.sh
git -C "$SEED" commit --quiet -m "Initial deployment"
git -C "$SEED" push --quiet origin HEAD:main

git clone --quiet --branch main "$REMOTE" "$INSTALL"
printf 'FINDSTUFF_PORT=8000\n' >"$INSTALL/.env"

printf 'updated\n' >"$SEED/release-marker"
git -C "$SEED" add release-marker
git -C "$SEED" commit --quiet -m "Available update"
git -C "$SEED" push --quiet origin HEAD:main

mkdir -p "$FAKE_BIN"
printf '#!/usr/bin/env bash\nexit 0\n' >"$FAKE_BIN/docker"
printf '#!/usr/bin/env bash\nprintf '"'"'{"status":"ok","version":"9.9.9"}'"'"'\n' >"$FAKE_BIN/curl"
chmod +x "$FAKE_BIN/docker" "$FAKE_BIN/curl"

PATH="$FAKE_BIN:$PATH" "$INSTALL/update-docker.sh"

test -f "$INSTALL/release-marker"
test ! -e "$INSTALL/data/update-request"
grep -q '"status": "complete"' "$INSTALL/data/update-status.json"
grep -q '"version": "' "$INSTALL/data/update-status.json"
echo "Updater integration test passed."
