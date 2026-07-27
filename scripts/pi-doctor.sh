#!/usr/bin/env bash
set -u

failures=0
warn() { printf 'WARN: %s\n' "$*"; }
pass() { printf ' OK : %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*"; failures=$((failures + 1)); }

printf 'Findstuff board readiness check\n\n'

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  pass "OS: ${PRETTY_NAME:-unknown}"
else
  fail "/etc/os-release is missing"
fi

architecture="$(uname -m)"
case "$architecture" in
  armv7l|armv8l|aarch64|x86_64) pass "Architecture: $architecture" ;;
  *) warn "Untested architecture: $architecture" ;;
esac

memory_mb="$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)"
if (( memory_mb >= 450 )); then pass "RAM: ${memory_mb} MB"; else warn "Only ${memory_mb} MB RAM detected"; fi

available_mb="$(df -Pm / | awk 'NR==2 {print $4}')"
if (( available_mb >= 1500 )); then pass "Free root storage: ${available_mb} MB"; else fail "Less than 1.5 GB free storage"; fi

if timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -qx yes; then
  pass "Clock is synchronized"
else
  warn "Clock is not yet synchronized; HTTPS and package downloads may fail"
fi

if ip route | grep -q '^default '; then pass "Default network route exists"; else fail "No default network route"; fi
if getent hosts github.com >/dev/null 2>&1; then pass "DNS works"; else fail "DNS lookup failed"; fi

if command -v python3 >/dev/null 2>&1; then
  pass "$(python3 --version 2>&1)"
else
  warn "Python 3 is not installed yet; install.sh will add it"
fi

if [[ -c /dev/watchdog ]]; then pass "Hardware watchdog is available"; else warn "No /dev/watchdog detected"; fi

printf '\n'
if (( failures > 0 )); then
  printf '%d blocking readiness issue(s) found.\n' "$failures"
  exit 1
fi
printf 'Board looks ready for sudo ./install.sh\n'
