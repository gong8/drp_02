#!/usr/bin/env bash
# `pnpm phone` - view the app on a physical phone via Expo Go, against the local dev DB.
# Works on macOS and Linux. The phone and this machine must be on the same Wi-Fi, and this
# machine needs a real LAN IPv4 (Imperial-WPA hands one out - e.g. 172.26.x).
#
# macOS note: if you only get the CLAT fake (192.0.0.2/32) instead of a real IPv4, set
# System Settings > Wi-Fi > (network) Details > TCP/IP > 'Configure IPv6' to 'Link-local only'
# and reconnect, so macOS takes the IPv4 lease instead of going IPv6-only.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Detect the LAN IPv4 of the active default interface (override with LAN_IP=... pnpm phone).
if [ -z "${LAN_IP:-}" ]; then
  if [ "$(uname)" = "Darwin" ]; then
    IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
    IFACE="${IFACE:-en0}"
    # Skip the CLAT fake (192.0.0.2/32, netmask /32) - only macOS produces it.
    LAN_IP="$(ifconfig "$IFACE" 2>/dev/null | awk '/inet /{if ($4 != "0xffffffff") {print $2; exit}}')"
  else
    IFACE="$(ip route show default 2>/dev/null | awk '/default/{print $5; exit}')"
    LAN_IP="$(ip -4 -o addr show "${IFACE:-}" 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
    [ -z "$LAN_IP" ] && LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
fi

if [ -z "${LAN_IP:-}" ]; then
  echo "Could not find a LAN IPv4. Connect to Wi-Fi, or pass it: LAN_IP=172.26.x.y pnpm phone" >&2
  echo "(macOS only getting 192.0.0.2? See the header of this script for the IPv6 fix.)" >&2
  exit 1
fi

echo "This machine: $LAN_IP    API: http://$LAN_IP:3000    (phone must be on the same Wi-Fi)"
docker compose up -d

# API in the background (local .env -> local db), Expo in the foreground so it keeps the
# terminal and renders the QR. The trap stops the API when you quit Expo.
trap 'pkill -f "tsx watch src/index.ts" 2>/dev/null || true; [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true' EXIT INT TERM
( pnpm --filter @bethere/api dev 2>&1 | sed -u 's/^/[api] /' ) &
API_PID=$!
sleep 2

cd apps/mobile
EXPO_PUBLIC_API_URL="http://$LAN_IP:3000" pnpm exec expo start
