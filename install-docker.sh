#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ASSUME_YES=0
INSTALL_DOCKER=1
INSTALL_UPDATER=1

usage() {
  cat <<'EOF'
Install Findstuff with Docker Compose.

Usage: ./install.sh [--yes] [--no-install-docker] [--no-systemd-updater]

  --yes                  Install missing Debian packages without prompting.
  --no-install-docker    Fail instead of installing Docker when it is missing.
  --no-systemd-updater   Do not install the host watcher for in-app updates.
EOF
}

for argument in "$@"; do
  case "$argument" in
    --yes|-y) ASSUME_YES=1 ;;
    --no-install-docker) INSTALL_DOCKER=0 ;;
    --no-systemd-updater) INSTALL_UPDATER=0 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $argument" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ ! -f "$ROOT/docker-compose.yml" || ! -f "$ROOT/.env.example" ]]; then
  echo "Run this script from a complete Findstuff checkout." >&2
  exit 1
fi

as_root() {
  if [[ "$EUID" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "sudo is required to install or start Docker." >&2
    return 1
  fi
}

install_docker() {
  if [[ "$INSTALL_DOCKER" -ne 1 ]]; then
    echo "Docker with Compose v2 is required." >&2
    exit 1
  fi
  if [[ ! -f /etc/os-release ]]; then
    echo "Automatic Docker installation supports Debian-family Linux only." >&2
    exit 1
  fi
  # shellcheck disable=SC1091
  source /etc/os-release
  case "${ID:-} ${ID_LIKE:-}" in
    *debian*|*ubuntu*) ;;
    *) echo "Install Docker Engine and Compose v2, then rerun this script." >&2; exit 1 ;;
  esac
  if [[ "$ASSUME_YES" -ne 1 ]]; then
    read -r -p "Docker is missing. Install Debian's Docker packages now? [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]] || exit 1
  fi
  as_root apt-get update
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y \
    docker.io ca-certificates curl
  if apt-cache show docker-compose-v2 >/dev/null 2>&1; then
    as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-v2
  elif apt-cache show docker-compose-plugin >/dev/null 2>&1; then
    as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin
  else
    echo "Docker Compose v2 is unavailable from this distribution's repositories." >&2
    echo "Install the Compose plugin from Docker's official repository and rerun." >&2
    exit 1
  fi
  as_root systemctl enable --now docker
}

command -v docker >/dev/null 2>&1 || install_docker
docker compose version >/dev/null 2>&1 || install_docker

if ! command -v curl >/dev/null 2>&1; then
    if [[ -f /etc/os-release ]]; then
      # shellcheck disable=SC1091
      source /etc/os-release
    fi
    case "${ID:-} ${ID_LIKE:-}" in
      *debian*|*ubuntu*)
        as_root apt-get update
        as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y curl
        ;;
      *)
        echo "curl is required; install it and rerun this script." >&2
        exit 1
        ;;
    esac
fi

if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
elif as_root docker info >/dev/null 2>&1; then
  if [[ "$EUID" -eq 0 ]]; then DOCKER=(docker); else DOCKER=(sudo docker); fi
else
  echo "Docker is installed but its daemon is unavailable." >&2
  exit 1
fi

created_credentials=0
if [[ ! -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  password_material="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
  password="${password_material:0:10}"
  sed -i "s/^FINDSTUFF_ADMIN_PASSWORD=.*/FINDSTUFF_ADMIN_PASSWORD=${password}/" "$ROOT/.env"
  chmod 0600 "$ROOT/.env"
  created_credentials=1
  echo "Created .env with a random administrator password."
else
  echo "Keeping existing .env."
fi

set_env_value() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ROOT/.env"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ROOT/.env"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ROOT/.env"
  fi
}

if rg -q '^FINDSTUFF_ADMIN_PASSWORD=CHANGE_ME' "$ROOT/.env" 2>/dev/null \
  || grep -q '^FINDSTUFF_ADMIN_PASSWORD=CHANGE_ME' "$ROOT/.env" \
  || grep -q '^FINDSTUFF_ADMIN_PASSWORD=$' "$ROOT/.env"; then
  echo "Refusing to start with the example administrator password." >&2
  exit 1
fi

if [[ "$EUID" -eq 0 ]]; then
  runtime_uid=10001
  runtime_gid=10001
else
  runtime_uid="$(id -u)"
  runtime_gid="$(id -g)"
fi
set_env_value FINDSTUFF_UID "$runtime_uid"
set_env_value FINDSTUFF_GID "$runtime_gid"
mkdir -p "$ROOT/data"
if [[ "$EUID" -eq 0 ]]; then
  chown "$runtime_uid:$runtime_gid" "$ROOT/data"
fi
chmod 0750 "$ROOT/data"

install_systemd_updater() {
  if [[ "$INSTALL_UPDATER" -ne 1 ]]; then
    return
  fi
  if ! command -v systemctl >/dev/null 2>&1 || [[ ! -d /run/systemd/system ]]; then
    echo "systemd is not active; in-app updates stay disabled."
    echo "Use ./update-docker.sh on the host to update."
    return
  fi
  if [[ "$ROOT" == *$'\n'* || "$ROOT" == *' '* || "$ROOT" == *'"'* || "$ROOT" == *'%'* || "$ROOT" == *\\* ]]; then
    echo "The checkout path contains characters unsupported by the updater service." >&2
    echo "Move it to a simple path such as /opt/findstuff and rerun the installer." >&2
    return 1
  fi

  local service_temp path_temp
  service_temp="$(mktemp)"
  path_temp="$(mktemp)"
  trap 'rm -f "${service_temp:-}" "${path_temp:-}"' RETURN
  {
    printf '%s\n' \
      '[Unit]' \
      'Description=Update Findstuff from its published container image' \
      'After=docker.service network-online.target' \
      'Wants=docker.service network-online.target' \
      '' \
      '[Service]' \
      'Type=oneshot' \
      "WorkingDirectory=$ROOT" \
      "ExecStart=/bin/bash $ROOT/update-docker.sh --from-app" \
      'NoNewPrivileges=true' \
      'PrivateTmp=true' \
      'ProtectControlGroups=true' \
      'ProtectKernelModules=true' \
      'ProtectKernelTunables=true' \
      'RestrictSUIDSGID=true' \
      'LockPersonality=true' \
      'UMask=0077'
  } >"$service_temp"
  {
    printf '%s\n' \
      '[Unit]' \
      'Description=Watch for Findstuff in-app update requests' \
      '' \
      '[Path]' \
      "PathExists=$ROOT/data/update-request" \
      'Unit=findstuff-update.service' \
      '' \
      '[Install]' \
      'WantedBy=multi-user.target'
  } >"$path_temp"
  as_root install -m 0644 "$service_temp" /etc/systemd/system/findstuff-update.service
  as_root install -m 0644 "$path_temp" /etc/systemd/system/findstuff-update.path
  as_root systemctl daemon-reload
  as_root systemctl enable --now findstuff-update.path
  set_env_value FINDSTUFF_SOFTWARE_UPDATE_ENABLED true
  echo "Installed the secure host watcher for in-app updates."
}

set_env_value FINDSTUFF_SOFTWARE_UPDATE_ENABLED false
install_systemd_updater

cd "$ROOT"
"${DOCKER[@]}" compose config --quiet
"${DOCKER[@]}" compose pull
"${DOCKER[@]}" compose up -d --remove-orphans

port="$(sed -n 's/^FINDSTUFF_PORT=//p' "$ROOT/.env" | tail -n 1)"
port="${port:-8000}"
ready=0
for _ in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:${port}/api/v1/health" >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "$ready" -ne 1 ]]; then
  echo "Findstuff did not become healthy. Inspect: ${DOCKER[*]} compose logs --tail=100" >&2
  exit 1
fi

username="$(sed -n 's/^FINDSTUFF_ADMIN_USERNAME=//p' "$ROOT/.env" | tail -n 1)"
password="$(sed -n 's/^FINDSTUFF_ADMIN_PASSWORD=//p' "$ROOT/.env" | tail -n 1)"
echo
echo "Findstuff is healthy at http://127.0.0.1:${port}"
echo "Username: ${username:-admin}"
if [[ "$created_credentials" -eq 1 ]]; then
  echo "Password: $password"
else
  echo "Password: kept in the existing .env file (not printed)"
fi
if grep -q '^FINDSTUFF_SOFTWARE_UPDATE_ENABLED=true$' "$ROOT/.env"; then
  echo "In-app updates: enabled (systemd host watcher)"
else
  echo "In-app updates: manual; run ./update-docker.sh on this host"
fi
echo "Next: configure private HTTPS with Tailscale Serve as described in README.md."
